"""게임 포털 진입점.

원칙:
- games/ 아래 게임 원본은 절대 수정하지 않는다 (~/game 스냅샷 그대로).
  계측 스크립트는 서빙 시점에 HTML 응답에 주입한다.
- DB가 없어도 포털과 게임은 정상 동작한다.
"""
import html
import json
import logging
import mimetypes
import re
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, Response

from app import database, games
from app.config import settings
from app.database import init_db
from app.routers.api import router as api_router
from app.routers.auth import router as auth_router
from app.routers.friends import router as friends_router
from app.routers.state import router as state_router
from app.routers.users import router as users_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
GAMES_DIR = BASE_DIR / "games"
PORTAL_DIR = BASE_DIR / "portal"

# 게임 원본은 공유 링크·OG 태그에 단독 배포처(github.io)를 하드코딩한다.
# 포털로 서빙될 땐 그 origin이 틀리므로(친구가 mini-game.kr에서 했는데 공유는 github.io로 감)
# 서빙 시점에 포털 origin으로 재작성한다. 원본은 손대지 않는다(sw.js NOOP 대체와 동일 원칙).
# github 슬러그(cube-game)와 포털 경로(/cube)가 다를 수 있어, 슬러그를 game id로 치환한다:
#   https://junhee1219.github.io/cube-game/share/x.html → {base}/cube/share/x.html
_GITHUB_HOST_RE = re.compile(r"https?://junhee1219\.github\.io/[A-Za-z0-9._-]+")


def _rewrite_share_urls(text: str, game: str, base: str) -> str:
    """게임 원본에 박힌 github.io 배포처 URL을 포털 origin/경로로 재작성."""
    return _GITHUB_HOST_RE.sub(f"{base}/{game}", text)


def _inject_snippet(game: str) -> str:
    """게임 HTML에 주입할 계측 스크립트 태그. 점수/상태 config를 같은 자리에 동기 주입한다.

    portal.js는 Storage.prototype.setItem을 래핑해 자동 점수 캡처 + 상태 push를 하므로,
    config를 fetch로 받으면 응답 전 첫 쓰기가 후킹 전에 유실된다(race).
    서버는 주입 시점에 game을 알고 있으니 data-* 속성으로 동기 전달한다.
    """
    g = games.games_by_id().get(game)
    attrs = f'data-game="{html.escape(game)}"'
    if g and g.get("score_key"):
        attrs += f' data-score-key="{html.escape(g["score_key"])}"'
        attrs += f' data-score-metric="{html.escape(g.get("score_metric", "best"))}"'
    if g and g.get("state_keys"):
        # 상태 sync manifest (키별 merge 방식 + init_cache) — JSON을 속성에 동기 전달
        state_json = json.dumps(g["state_keys"], ensure_ascii=False, separators=(",", ":"))
        attrs += f' data-state-keys="{html.escape(state_json, quote=True)}"'
    return f'<script src="/portal.js" {attrs}></script>'

# 게임이 갖고 있던 sw.js를 대체하는 무력화 SW —
# 설치 즉시 게임 캐시를 비우고 스스로 등록 해제한다 (stale cache 방지).
# ★단 'portal-' 접두 캐시는 보존 — caches.delete는 origin 전역이라, 안 그러면
#   게임 한 번 방문에 포털 SW 캐시까지 날아가 포털 SW가 silent no-op이 된다.
NOOP_SW = (
    "self.addEventListener('install',()=>self.skipWaiting());\n"
    "self.addEventListener('activate',e=>{e.waitUntil(\n"
    "  caches.keys().then(ks=>Promise.all(ks.filter(k=>k.indexOf('portal-')!==0).map(k=>caches.delete(k))))\n"
    "    .then(()=>self.registration.unregister())\n"
    ");});\n"
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    yield


app = FastAPI(title="game-portal", lifespan=lifespan)
app.include_router(api_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(state_router)
app.include_router(friends_router)


@app.get("/health")
async def health():
    return {"ok": True}


def _render_cards() -> str:
    """index.html의 게임 카드 목록을 레지스트리로 서버사이드 렌더.

    클라 fetch 카드는 OG 프리뷰/초기 페인트에 안 잡히므로 서버에서 박는다.
    """
    cards = []
    for g in games.load_games():
        gid = html.escape(g["id"])
        title = html.escape(g.get("title", gid))
        desc = html.escape(g.get("tagline", ""))
        cards.append(
            f'<a class="card" href="/{gid}/">'
            f'<img src="/{gid}/icon-192.png" alt="" width="64" height="64" loading="lazy">'
            f'<span class="meta"><span class="name">{title}</span>'
            f'<span class="desc">{desc}</span></span>'
            f'<span class="go" aria-hidden="true">&rarr;</span></a>'
        )
    return "\n".join(cards)


@app.get("/", response_class=HTMLResponse)
async def portal_index(request: Request):
    page = (PORTAL_DIR / "index.html").read_text(encoding="utf-8")
    base = str(request.base_url).rstrip("/")
    canonical = settings.base_url.rstrip("/")  # canonical 호스트는 고정 도메인
    head_extra = f'<link rel="canonical" href="{canonical}/">{_verification_meta()}'
    page = (
        page.replace("{{BASE}}", base)
        .replace("{{CARDS}}", _render_cards())
        .replace("{{HEAD_EXTRA}}", head_extra)
    )
    return HTMLResponse(page, headers={"Cache-Control": "no-cache"})


@app.get("/og.png")
async def portal_og():
    return FileResponse(PORTAL_DIR / "og.png", media_type="image/png")


@app.get("/favicon.ico")
async def favicon():
    return FileResponse(PORTAL_DIR / "icons" / "portal-192.png", media_type="image/png")


_ICON_DIR = (PORTAL_DIR / "icons").resolve()


@app.get("/icons/{name}")
async def portal_icon(name: str):
    """포털 PWA 아이콘 (portal-192/512/180/maskable)."""
    target = (_ICON_DIR / name).resolve()
    if not str(target).startswith(str(_ICON_DIR)) or not target.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(
        target, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"}
    )


_FONTS_DIR = (PORTAL_DIR / "fonts").resolve()


@app.get("/fonts/{name}")
async def portal_font(name: str):
    """self-host 폰트(Pretendard woff2). 오프라인 PWA — 외부 CDN 의존 없음."""
    target = (_FONTS_DIR / name).resolve()
    if not str(target).startswith(str(_FONTS_DIR)) or not target.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(
        target,
        media_type="font/woff2",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/api/support")
async def support_links():
    """후원 링크(토스/카카오뱅크). 서버 .env에 설정된 것만 노출. 둘 다 비면 빈 객체 → 버튼 숨김."""
    out = {}
    if settings.support_toss_url:
        out["toss"] = settings.support_toss_url
    if settings.support_kakaobank_url:
        out["kakaobank"] = settings.support_kakaobank_url
    return out


@app.get("/manifest.webmanifest")
async def manifest(request: Request):
    """포털 PWA manifest. scope '/'로 게임별 manifest(scope /{game}/)와 분리."""
    data = {
        "id": "/",
        "name": "미니게임",
        "short_name": "미니게임",
        "description": "여러 미니게임 모음. 기록 세우고 친구랑 겨뤄보세요.",
        "start_url": "/?src=pwa",
        "scope": "/",
        "display": "standalone",
        "orientation": "portrait",
        "background_color": "#101014",
        "theme_color": "#101014",
        "icons": [
            {"src": "/icons/portal-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "/icons/portal-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "/icons/portal-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }
    return Response(
        json.dumps(data, ensure_ascii=False),
        media_type="application/manifest+json",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/sw.js")
async def service_worker():
    """포털 서비스 워커. 게임 prefix를 passthrough 정규식에 주입 (게임 추가 시 자동 반영)."""
    sw = (PORTAL_DIR / "sw.js").read_text(encoding="utf-8")
    game_re = "|".join(sorted(games.playable_ids())) or "__none__"
    sw = sw.replace("{{GAME_RE}}", game_re)
    return Response(
        sw, media_type="text/javascript", headers={"Cache-Control": "no-cache"}
    )


@app.get("/portal.js")
async def portal_js():
    return Response((PORTAL_DIR / "portal.js").read_bytes(), media_type="text/javascript")


@app.get("/portal.css")
async def portal_css():
    return Response((PORTAL_DIR / "portal.css").read_bytes(), media_type="text/css")


@app.get("/account-widget.js")
async def account_widget_js():
    return Response(
        (PORTAL_DIR / "account-widget.js").read_bytes(), media_type="text/javascript"
    )


def _verification_meta() -> str:
    """검색엔진 소유확인 메타태그. 코드가 있을 때만 박는다 (빈 content 금지)."""
    tags = []
    if settings.google_site_verification:
        tags.append(
            f'<meta name="google-site-verification" content="{html.escape(settings.google_site_verification)}">'
        )
    if settings.naver_site_verification:
        tags.append(
            f'<meta name="naver-site-verification" content="{html.escape(settings.naver_site_verification)}">'
        )
    return "".join(tags)


@app.get("/robots.txt")
async def robots_txt():
    """크롤러 가이드. 공개 페이지는 색인 허용, 계정/동적 페이지는 차단. sitemap 위치 명시."""
    base = settings.base_url.rstrip("/")
    body = (
        "User-agent: *\n"
        "Allow: /\n"
        # 계정/운영/동적(무한 생성) 경로는 색인 낭비 — 차단
        "Disallow: /account\n"
        "Disallow: /dash\n"
        "Disallow: /onboard\n"
        "Disallow: /follow/\n"
        "Disallow: /s/\n"
        "Disallow: /api/\n"
        f"\nSitemap: {base}/sitemap.xml\n"
    )
    return Response(body, media_type="text/plain")


@app.get("/sitemap.xml")
async def sitemap_xml():
    """색인 대상 URL 목록. canonical과 바이트 일치(트레일링 슬래시 포함)시켜야 한다.

    호스트는 settings.base_url(canonical 도메인) 고정 — request.base_url(직접 IP/http일 수 있음) 금지.
    """
    base = settings.base_url.rstrip("/")
    urls = [f"{base}/", f"{base}/rank"]
    urls += [f"{base}/{gid}/" for gid in games.playable_ids()]
    items = "".join(f"<url><loc>{html.escape(u)}</loc></url>" for u in urls)
    body = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{items}</urlset>"
    )
    return Response(body, media_type="application/xml")


@app.get("/rank", response_class=HTMLResponse)
async def rank_page():
    return (PORTAL_DIR / "rank.html").read_text(encoding="utf-8")


@app.get("/dash", response_class=HTMLResponse)
async def dash_page():
    """운영 지표 대시보드 (noindex). 어느 게임이 사는지 보는 곳."""
    return (PORTAL_DIR / "dash.html").read_text(encoding="utf-8")


@app.get("/account", response_class=HTMLResponse)
async def account_page():
    """가입/로그인 화면 (vanilla JS)."""
    return HTMLResponse(
        (PORTAL_DIR / "account.html").read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/onboard", response_class=HTMLResponse)
async def onboard_page():
    """카카오 신규 가입 닉네임 선택 화면 (nickname_set=0일 때 콜백이 보냄)."""
    return HTMLResponse(
        (PORTAL_DIR / "onboard.html").read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/follow/{user_id}", response_class=HTMLResponse)
async def follow_page(user_id: str):
    """친구 추가 동선 페이지 (로그인 분기/가입 next). 실제 follow는 JS가 /api/follow 호출."""
    return HTMLResponse(
        (PORTAL_DIR / "follow.html").read_text(encoding="utf-8"),
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/s/{score_id}", response_class=HTMLResponse)
async def share_page(score_id: int, request: Request):
    """점수 공유 페이지 — 카톡 미리보기용 OG 태그를 점수별로 렌더."""
    if database.async_session is None:
        return RedirectResponse(url="/", status_code=302)
    from app.models import Score, User

    games_map = games.games_by_id()
    async with database.async_session() as db:
        score = await db.get(Score, score_id)
        if score is None or score.game not in games_map:
            return RedirectResponse(url="/", status_code=302)
        # 닉네임 노출 우선순위: 기록 소유 user.nickname > score 시점 닉 (login_id/user_id는 비노출)
        nick = None
        if score.user_id:
            owner = await db.get(User, score.user_id)
            nick = owner.nickname if owner else None
        nick = nick or score.nickname

    info = games_map[score.game]
    base = str(request.base_url).rstrip("/")
    record = f"{score.score:,}"
    base_title = f"{info['title']} — {record}{info['unit']}"
    og_title = f"{nick}님의 {base_title}" if nick else base_title
    # 닉네임은 사용자 입력 — <title>/<meta content>에 raw로 박으면 저장형 XSS.
    # 나머지 값(게임 제목·점수)도 함께 escape해 일관 처리 (출처 무관 안전).
    og_title = html.escape(og_title)
    page = (PORTAL_DIR / "share.html").read_text(encoding="utf-8")
    for key, value in {
        "{{TITLE}}": og_title,
        "{{OG_TITLE}}": og_title,
        "{{OG_DESC}}": "내 기록 깰 수 있어?",
        "{{OG_IMAGE}}": f"{base}/{score.game}/og/main.png",
        "{{GAME}}": score.game,
        "{{GAME_TITLE}}": info["title"],
        "{{SCORE}}": record,
        "{{UNIT}}": info["unit"],
    }.items():
        page = page.replace(key, value)
    return HTMLResponse(page)


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
    if game not in games.playable_ids():
        raise HTTPException(status_code=404)
    return RedirectResponse(url=f"/{game}/", status_code=308)


@app.get("/{game}/{path:path}")
async def serve_game(request: Request, game: str, path: str = ""):
    if game not in games.playable_ids():
        raise HTTPException(status_code=404)

    base = str(request.base_url).rstrip("/")

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

    # HTML에는 계측 스크립트 주입. 캐시 금지 — 게임 업데이트 즉시 반영
    if target.suffix == ".html":
        page = _rewrite_share_urls(target.read_text(encoding="utf-8"), game, base)
        # 게임 진입 페이지(index)에는 SEO 메타 주입 — 원본은 무수정, 서빙 시점에만.
        # canonical 호스트는 고정 도메인(settings.base_url), 트레일링 슬래시는 sitemap과 일치.
        if path in ("", "index.html") and "<head>" in page:
            canonical = settings.base_url.rstrip("/")
            seo = f'<link rel="canonical" href="{canonical}/{html.escape(game)}/">'
            # description이 이미 있으면 중복 주입 금지 — 없는 게임만 tagline으로 채운다
            if 'name="description"' not in page:
                g = games.games_by_id().get(game)
                tagline = (g or {}).get("tagline") or (g or {}).get("title", game)
                seo += f'<meta name="description" content="{html.escape(tagline)}">'
            page = page.replace("<head>", f"<head>{seo}", 1)
        snippet = _inject_snippet(game)
        if "</body>" in page:
            page = page.replace("</body>", f"{snippet}\n</body>", 1)
        else:
            page += snippet
        return HTMLResponse(page, headers={"Cache-Control": "no-cache"})

    # JS 에셋은 공유 URL(SITE 상수)을 담을 수 있어 재작성 후 서빙
    if target.suffix == ".js":
        js = _rewrite_share_urls(target.read_text(encoding="utf-8"), game, base)
        return Response(
            js,
            media_type="text/javascript",
            headers={"Cache-Control": "public, max-age=600"},
        )

    media_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
    # 에셋은 짧게만 캐시 (10분) — 교체 후 "반영 안 됨" 혼란 방지
    return FileResponse(
        target, media_type=media_type, headers={"Cache-Control": "public, max-age=600"}
    )
