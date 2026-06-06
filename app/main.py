"""게임 포털 진입점.

원칙:
- games/ 아래 게임 원본은 절대 수정하지 않는다 (~/game 스냅샷 그대로).
  계측 스크립트는 서빙 시점에 HTML 응답에 주입한다.
- DB가 없어도 포털과 게임은 정상 동작한다.
"""
import logging
import mimetypes
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from app.database import init_db
from app.routers.api import router as api_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
GAMES_DIR = BASE_DIR / "games"
PORTAL_DIR = BASE_DIR / "portal"

GAMES = {
    "cube": {
        "title": "Cube Snake",
        "tagline": "3D 큐브 표면을 기어다니는 스네이크. 모서리를 넘으면 세상이 돌아간다.",
    },
    "gateway": {
        "title": "라면집 사장님",
        "tagline": "세 줄로 밀려드는 손님, 서빙은 한 줄씩. 줄이 터지면 가게도 끝.",
    },
    "vase": {
        "title": "물병 정렬",
        "tagline": "알록달록 물을 옮겨 담는 퍼즐. 봇보다 적게 움직이면 별 셋.",
    },
}

# 서빙 시점에 게임 HTML에 주입하는 계측 스크립트 태그
INJECT_SNIPPET = '<script src="/portal.js" data-game="{game}"></script>'

# 게임이 갖고 있던 sw.js를 대체하는 무력화 SW —
# 설치 즉시 기존 캐시를 비우고 스스로 등록 해제한다 (stale cache 방지)
NOOP_SW = (
    "self.addEventListener('install',()=>self.skipWaiting());\n"
    "self.addEventListener('activate',e=>{e.waitUntil(\n"
    "  caches.keys().then(ks=>Promise.all(ks.map(k=>caches.delete(k))))\n"
    "    .then(()=>self.registration.unregister())\n"
    ");});\n"
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield


app = FastAPI(title="game-portal", lifespan=lifespan)
app.include_router(api_router)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/", response_class=HTMLResponse)
async def portal_index():
    return (PORTAL_DIR / "index.html").read_text(encoding="utf-8")


@app.get("/portal.js")
async def portal_js():
    return Response((PORTAL_DIR / "portal.js").read_bytes(), media_type="text/javascript")


@app.get("/portal.css")
async def portal_css():
    return Response((PORTAL_DIR / "portal.css").read_bytes(), media_type="text/css")


def _safe_game_file(game: str, path: str) -> Path:
    """게임 디렉토리 밖을 벗어나는 경로 차단."""
    game_dir = (GAMES_DIR / game).resolve()
    target = (game_dir / path).resolve()
    if not str(target).startswith(str(game_dir)):
        raise HTTPException(status_code=404)
    return target


@app.get("/{game}")
async def game_root_redirect(game: str):
    """상대경로 자산이 깨지지 않도록 /vase → /vase/ 로 정규화."""
    if game not in GAMES:
        raise HTTPException(status_code=404)
    return RedirectResponse(url=f"/{game}/", status_code=308)


@app.get("/{game}/{path:path}")
async def serve_game(game: str, path: str = ""):
    if game not in GAMES:
        raise HTTPException(status_code=404)

    # 게임 자체 sw.js는 무력화 버전으로 대체 (원본 파일은 그대로 둔다)
    if path == "sw.js":
        return Response(NOOP_SW, media_type="text/javascript")

    if path in ("", "index.html"):
        target = _safe_game_file(game, "index.html")
    else:
        target = _safe_game_file(game, path)

    if target.is_dir():
        target = target / "index.html"
    if not target.is_file():
        raise HTTPException(status_code=404)

    # HTML에는 계측 스크립트 주입
    if target.suffix == ".html":
        html = target.read_text(encoding="utf-8")
        snippet = INJECT_SNIPPET.format(game=game)
        if "</body>" in html:
            html = html.replace("</body>", f"{snippet}\n</body>", 1)
        else:
            html += snippet
        return HTMLResponse(html)

    media_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    return FileResponse(target, media_type=media_type)
