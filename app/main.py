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
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    Response,
)
from starlette.exceptions import HTTPException as StarletteHTTPException

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
    if g and g.get("defer_share"):
        # 점수 키가 플레이 중 갱신되는 게임 — 공유 제안을 게임오버 시점으로 미룬다(portal.js).
        attrs += ' data-defer-share="1"'
    if g and g.get("state_keys"):
        # 상태 sync manifest (키별 merge 방식 + init_cache) — JSON을 속성에 동기 전달
        state_json = json.dumps(g["state_keys"], ensure_ascii=False, separators=(",", ":"))
        attrs += f' data-state-keys="{html.escape(state_json, quote=True)}"'
    return f'<script src="/portal.js" {attrs}></script>'


# 공통 헤더의 홈 아이콘 (Phosphor house-fill 인라인 — 이모지 금지)
_SHELL_HOME_SVG = (
    '<svg viewBox="0 0 256 256" aria-hidden="true"><path fill="currentColor" '
    'd="M218.83,103.77l-80-75.48a1.14,1.14,0,0,1-.11-.11,16,16,0,0,0-21.53,0l-.11.11L37.17,'
    '103.77A16,16,0,0,0,32,115.55V208a16,16,0,0,0,16,16H96a16,16,0,0,0,16-16V160h32v48a16,16,'
    '0,0,0,16,16h48a16,16,0,0,0,16-16V115.55A16,16,0,0,0,218.83,103.77Z"/></svg>'
)


def _inject_game_shell(page: str, game: str) -> str:
    """게임 메인 HTML에 공통 Game Shell을 주입한다(원본 무수정 — 서빙 시점).

    - <head>에 game-shell.css 링크
    - <body>에 data-shell-mode 속성(게임별 games.json 선언)
    - <body> 바로 안에 공통 헤더([홈][제목]) 주입 — 홈 버튼 위치·동선 일괄 통일
    홈 버튼 클릭(이탈 확인 모달)은 portal.js가 data-gp-home에 연결한다.
    """
    g = games.games_by_id().get(game) or {}
    mode = g.get("shell_mode", "panel")
    title = g.get("title", game)
    if "/game-shell.css" not in page and "<head>" in page:
        page = page.replace("<head>", '<head><link rel="stylesheet" href="/game-shell.css">', 1)
    # data-shell-mode 속성을 <body> 여는 태그에 추가(기존 속성 보존)
    page = re.sub(r"<body\b", f'<body data-shell-mode="{html.escape(mode)}"', page, count=1)
    header = (
        '<header class="gp-shell-header">'
        '<button type="button" class="gp-shell-home" data-gp-home aria-label="홈으로">'
        f"{_SHELL_HOME_SVG}</button>"
        f'<div class="gp-shell-title">{html.escape(title)}</div>'
        "</header>"
    )
    # 헤더는 <body ...> 여는 태그 바로 뒤(첫 자식)로 — flex column의 맨 위 행
    page = re.sub(r"<body[^>]*>", lambda m: m.group(0) + header, page, count=1)
    return page

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


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    """404는 브라우저(HTML) 요청에 한해 스타일 페이지로. 그 외(API JSON·401 등)는 기본 동작 유지."""
    if exc.status_code == 404 and "text/html" in request.headers.get("accept", ""):
        page = (PORTAL_DIR / "404.html").read_text(encoding="utf-8")  # HTML 즉시 반영(no-cache)
        return HTMLResponse(page, status_code=404, headers={"Cache-Control": "no-cache"})
    return JSONResponse(
        {"detail": exc.detail},
        status_code=exc.status_code,
        headers=getattr(exc, "headers", None),
    )


@app.get("/health")
async def health():
    return {"ok": True}


def _dot_html(g: dict) -> str:
    """아이콘 코너 신호 점 — NEW(초록) 우선, 아니면 HOT(코랄). iOS '새 앱' 점 느낌."""
    if g.get("new"):
        return '<span class="dot new" aria-hidden="true"></span>'
    if g.get("hot"):
        return '<span class="dot hot" aria-hidden="true"></span>'
    return ""


def _ft_cell(g: dict) -> str:
    """폴더 타일 안의 큰 아이콘 미리보기(클릭 X — 타일 전체가 폴더 열기 버튼)."""
    gid = html.escape(g["id"])
    return (
        f'<span class="ft-cell">'
        f'<img src="/{gid}/icon-192.png" alt="" loading="lazy">'
        f'{_dot_html(g)}</span>'
    )


def _fs_app(g: dict) -> str:
    """열린 폴더 시트 안의 앱(아이콘 + 이름, 바로 실행 링크)."""
    gid = html.escape(g["id"])
    title = html.escape(g.get("title", gid))
    return (
        f'<a class="fs-app" href="/{gid}/">'
        f'<span class="fs-ic"><img src="/{gid}/icon-192.png" alt="" loading="lazy">{_dot_html(g)}</span>'
        f'<span class="fs-nm">{title}</span></a>'
    )


def _render_cards() -> str:
    """홈 게임 목록을 iOS 홈 화면 '폴더' UI로 서버 렌더.

    카테고리 = 폴더. 폴더 타일(네모) 전체가 하나의 버튼 = 탭하면 폴더 시트가 열린다.
    타일 안 아이콘은 미리보기일 뿐(클릭 안 먹음) — 앞 3개는 크게, 나머지는 우하단 클러스터.
    게임 실행은 열린 폴더 시트 안에서. 클라 fetch는 OG/초기 페인트에 안 잡히므로 서버 렌더.
    """
    folders = []
    sheets = []
    for cat, glist in games.home_games_by_category():
        cid = html.escape(cat["id"])
        ctitle = html.escape(cat["title"])
        big = glist[:3]
        rest = glist[3:]
        cells = "".join(_ft_cell(g) for g in big)
        if rest:
            tinies = "".join(
                f'<img src="/{html.escape(g["id"])}/icon-192.png" alt="" loading="lazy">'
                for g in rest[:4]
            )
            cells += f'<span class="ft-more">{tinies}</span>'
        folders.append(
            f'<div class="folder">'
            f'<button class="folder-tile" type="button" data-folder="{cid}" '
            f'aria-label="{ctitle} 폴더 열기">{cells}</button>'
            f'<button class="folder-name" type="button" data-folder="{cid}">{ctitle}</button>'
            f'</div>'
        )
        apps = "".join(_fs_app(g) for g in glist)
        sheets.append(
            f'<div class="folder-sheet" id="fs-{cid}" hidden>'
            f'<div class="fs-panel" role="dialog" aria-modal="true" aria-label="{ctitle}">'
            f'<h2 class="fs-title">{ctitle}</h2>'
            f'<div class="fs-grid">{apps}</div>'
            f'</div></div>'
        )
    return f'<div class="library">{"".join(folders)}</div>' + "".join(sheets)


def _render_lab_cards() -> str:
    """/lab 실험실 게임 카드. 홈 카드와 동일 톤 + '실험실' 표식. lab 게임 0개면 빈 상태 안내."""
    labs = games.lab_games()
    if not labs:
        return (
            '<p class="lab-empty">아직 실험 중인 게임이 없습니다. '
            'games.json 엔트리에 <code>"lab": true</code>를 넣으면 여기에 뜹니다.</p>'
        )
    cards = []
    for g in labs:
        gid = html.escape(g["id"])
        title = html.escape(g.get("title", gid))
        desc = html.escape(g.get("tagline", ""))
        cards.append(
            f'<a class="card is-lab" href="/{gid}/">'
            f'<img src="/{gid}/icon-192.png" alt="" width="64" height="64" loading="lazy">'
            f'<span class="meta"><span class="name">{title}'
            f'<span class="hot lab">실험실</span></span>'
            f'<span class="desc">{desc}</span></span>'
            f'<span class="go" aria-hidden="true">&rarr;</span></a>'
        )
    return "\n".join(cards)


def _home_jsonld() -> str:
    """홈 구조화 데이터(JSON-LD) — WebSite + 게임 ItemList. 레지스트리에서 동적 생성."""
    canonical = settings.base_url.rstrip("/")
    website = {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "미니게임",
        "alternateName": "mini-game.kr",
        "url": f"{canonical}/",
        "description": "설치·가입 없이 브라우저에서 바로 즐기는 무료 미니게임 모음",
        "inLanguage": "ko",
    }
    items = [
        {
            "@type": "ListItem",
            "position": i + 1,
            "item": {
                "@type": "VideoGame",
                "name": g.get("title", g["id"]),
                "url": f"{canonical}/{g['id']}/",
                "image": f"{canonical}/{g['id']}/icon-192.png",
                "description": g.get("tagline", ""),
                "playMode": "SinglePlayer",
                "applicationCategory": "Game",
                "operatingSystem": "Web",
                "isAccessibleForFree": True,
                "inLanguage": "ko",
            },
        }
        for i, g in enumerate(games.home_games())
    ]
    itemlist = {"@context": "https://schema.org", "@type": "ItemList", "itemListElement": items}
    return (
        f'<script type="application/ld+json">{json.dumps(website, ensure_ascii=False)}</script>'
        f'<script type="application/ld+json">{json.dumps(itemlist, ensure_ascii=False)}</script>'
    )


@app.get("/", response_class=HTMLResponse)
async def portal_index(request: Request):
    page = (PORTAL_DIR / "index.html").read_text(encoding="utf-8")
    base = str(request.base_url).rstrip("/")
    canonical = settings.base_url.rstrip("/")  # canonical 호스트는 고정 도메인
    head_extra = f'<link rel="canonical" href="{canonical}/">{_verification_meta()}{_home_jsonld()}'
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


@app.get("/game-shell.css")
async def game_shell_css():
    """게임 공통 레이아웃(헤더/푸터/safe-area/중앙정렬). serve_game이 게임 <head>에 주입."""
    return Response(
        (PORTAL_DIR / "game-shell.css").read_bytes(),
        media_type="text/css",
        headers={"Cache-Control": "public, max-age=600"},
    )


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
        "Disallow: /lab\n"
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
    # lab(실험실) 게임은 색인 제외 — 프로토타입 URL이 검색에 노출되면 안 됨
    urls += [f"{base}/{g['id']}/" for g in games.home_games()]
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


@app.get("/lab", response_class=HTMLResponse)
async def lab_page():
    """실험실(noindex). lab 프로토타입 게임만 목록. 홈/sitemap/rank엔 안 뜨지만 서빙·계측은 정상."""
    page = (PORTAL_DIR / "lab.html").read_text(encoding="utf-8")
    page = page.replace("{{CARDS}}", _render_lab_cards())
    return HTMLResponse(page, headers={"Cache-Control": "no-cache"})


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
            g = games.games_by_id().get(game)
            seo = f'<link rel="canonical" href="{canonical}/{html.escape(game)}/">'
            # description이 이미 있으면 중복 주입 금지 — 없는 게임만 tagline으로 채운다
            if 'name="description"' not in page:
                tagline = (g or {}).get("tagline") or (g or {}).get("title", game)
                seo += f'<meta name="description" content="{html.escape(tagline)}">'
            # 구조화 데이터(VideoGame) — 일반 검색어 노출용
            jsonld = {
                "@context": "https://schema.org",
                "@type": "VideoGame",
                "name": (g or {}).get("title", game),
                "url": f"{canonical}/{game}/",
                "image": f"{canonical}/{game}/icon-192.png",
                "description": (g or {}).get("tagline", ""),
                "playMode": "SinglePlayer",
                "applicationCategory": "Game",
                "operatingSystem": "Web",
                "isAccessibleForFree": True,
                "inLanguage": "ko",
            }
            seo += f'<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>'
            page = page.replace("<head>", f"<head>{seo}", 1)
            # <title>에 브랜드/키워드 접미사 — 게임 원본 무수정, 서빙 시점 치환
            if "</title>" in page and "미니게임" not in page.split("</title>")[0]:
                page = page.replace("</title>", " | 미니게임 - 무료 웹게임</title>", 1)
            # 공통 Game Shell(헤더/레이아웃) 주입 — 게임 메인 페이지에만
            page = _inject_game_shell(page, game)
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
