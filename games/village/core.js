// 오순도순 마을 — 순수 로직 (DOM 없음, `node test.js`로 검증)
// 코지 타일 배치: 고정 격자(GRID×GRID)의 빈 칸에 집/숲/연못/꽃밭/밭을 놓는다. 이웃이 어울리면
// 행복(점수)이 오르고, 자연에 둘러싸인 집에는 동물 주민이 이사 온다. 격자가 다 차면 끝 —
// 그때 모은 행복이 리더보드 기록. 시간제한·방치 패널티 없음. 끝이 보장되는 퍼즐.
(function (root) {
  'use strict';

  // 타일 종류. order = 렌더/통계 순서. 이름은 한국어(연출용).
  var TYPES = ['house', 'forest', 'pond', 'flower', 'field'];
  var NAME = { house: '집', forest: '숲', pond: '연못', flower: '꽃밭', field: '밭' };
  var NATURE = { forest: 1, pond: 1, flower: 1, field: 1 }; // 집이 좋아하는 '자연'

  var CFG = {
    GRID: 7,          // 격자 한 변 (7×7=49칸). 다 채우면 게임 종료.
    HOME_NATURE: 3    // 집이 동물 주민을 맞으려면 필요한 자연 이웃 수
  };

  // 가방(bag): 종류별 가중치. 무한히 뽑되 가뭄을 줄이려 가중 셔플백 사용.
  var WEIGHT = { house: 32, forest: 22, flower: 16, pond: 15, field: 15 };

  function key(x, y) { return x + ',' + y; }
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  // board: Map(key → {x,y,type,villager}). 한 타일의 점수를 4이웃으로 계산.
  function neighborCounts(board, x, y) {
    var c = { house: 0, forest: 0, pond: 0, flower: 0, field: 0, total: 0, nature: 0 };
    for (var i = 0; i < DIRS.length; i++) {
      var t = board.get(key(x + DIRS[i][0], y + DIRS[i][1]));
      if (!t) continue;
      c[t.type]++; c.total++;
      if (NATURE[t.type]) c.nature++;
    }
    return c;
  }

  // 한 타일이 자리에서 만들어내는 행복 점수(이웃 기반). 숫자를 가려도 "무엇 옆에 두면 좋은가"가
  // 플레이로 드러나게 단순·일관 규칙.
  function tileScore(type, c) {
    switch (type) {
      case 'house':
        // 집: 자연에 둘러싸일수록 아늑(+2/자연), 꽃밭이 붙으면 정원 보너스, 이웃집과는 소소한 동네 정.
        var s = 1 + 2 * c.nature + (c.flower > 0 ? 2 : 0) + Math.min(c.house, 2);
        if (isHome(c)) s += 6; // 동물 주민이 입주한 집 — 큰 보너스
        return s;
      case 'forest':
        return 1 + 2 * c.forest + c.pond;            // 숲은 뭉칠수록, 물가일수록 좋다
      case 'pond':
        return 1 + 2 * c.forest + 2 * c.pond + c.house; // 물은 이어지고(강) 숲·집을 좋아함
      case 'flower':
        return 1 + c.house + c.forest;               // 꽃밭은 집·숲 곁에서 화사
      case 'field':
        return 1 + 2 * c.house + c.field;            // 밭은 집 근처(농가)·서로 이어질 때
      default:
        return 1;
    }
  }

  // 집이 '입주 가능한 보금자리'인가 — 자연 이웃이 충분히 둘러쌌을 때(CFG.HOME_NATURE).
  function isHome(c) { return c.nature >= CFG.HOME_NATURE; }

  // 격자 안의 빈 칸이면 둘 수 있다 (고정 GRID×GRID). 인접 제약 없음 — 어디에 둘지가 곧 실력.
  function inBounds(x, y) { return x >= 0 && y >= 0 && x < CFG.GRID && y < CFG.GRID; }
  function isPlaceable(board, x, y) { return inBounds(x, y) && !board.has(key(x, y)); }
  function isFull(board) { return board.size >= CFG.GRID * CFG.GRID; }
  function cellsLeft(board) { return CFG.GRID * CFG.GRID - board.size; }

  // 타일 한 칸이 동물 주민 입주 상태인지(집 + 자연2+).
  function tileIsHome(board, t) {
    return t.type === 'house' && isHome(neighborCounts(board, t.x, t.y));
  }

  // 배치 적용. board를 직접 변경하고 결과(델타 점수 / 새 주민 / 영향 칸)를 반환.
  // 점수는 "해당 칸 + 4이웃"의 (이후 합 − 이전 합)으로 산정 → 이웃 집이 자연을 얻어 입주하는
  // 연쇄도 자연히 반영된다.
  function place(board, x, y, type) {
    var affected = [{ x: x, y: y }];
    for (var i = 0; i < DIRS.length; i++) {
      var nx = x + DIRS[i][0], ny = y + DIRS[i][1];
      if (board.has(key(nx, ny))) affected.push({ x: nx, y: ny });
    }
    // 이전 점수 합 + 이전 입주 집 집합
    var before = 0, wasHome = {};
    for (var a = 0; a < affected.length; a++) {
      var p = affected[a], t0 = board.get(key(p.x, p.y));
      if (!t0) continue;
      before += tileScore(t0.type, neighborCounts(board, p.x, p.y));
      if (tileIsHome(board, t0)) wasHome[key(p.x, p.y)] = true;
    }
    // 새 타일 삽입
    var tile = { x: x, y: y, type: type, villager: false };
    board.set(key(x, y), tile);
    // 이후 점수 합 + 새 입주 집 판정
    var after = 0, newlyHome = [];
    for (var b = 0; b < affected.length; b++) {
      var q = affected[b], t1 = board.get(key(q.x, q.y));
      if (!t1) continue;
      after += tileScore(t1.type, neighborCounts(board, q.x, q.y));
      var home = tileIsHome(board, t1);
      t1.villager = home;
      if (home && !wasHome[key(q.x, q.y)]) newlyHome.push({ x: q.x, y: q.y });
    }
    var gain = Math.max(0, after - before);
    return { gain: gain, newlyHome: newlyHome, affected: affected, tile: tile };
  }

  // 가중 셔플백 — rng()는 0..1. 가방이 비면 가중치대로 다시 채운다.
  function makeBag(rng) {
    rng = rng || Math.random;
    var pool = [];
    function refill() {
      for (var t in WEIGHT) { for (var i = 0; i < WEIGHT[t]; i++) pool.push(t); }
    }
    return function next() {
      if (!pool.length) refill();
      var i = Math.floor(rng() * pool.length);
      return pool.splice(i, 1)[0];
    };
  }

  // 큰 숫자 축약(점수 표기): 1,240 같은 천단위 콤마.
  function formatNum(n) {
    n = Math.floor(Number(n) || 0);
    return n.toLocaleString('en-US');
  }

  var api = {
    TYPES: TYPES, NAME: NAME, NATURE: NATURE, DIRS: DIRS, CFG: CFG,
    get GRID() { return CFG.GRID; },
    key: key, inBounds: inBounds, neighborCounts: neighborCounts, tileScore: tileScore, isHome: isHome,
    isPlaceable: isPlaceable, isFull: isFull, cellsLeft: cellsLeft,
    tileIsHome: tileIsHome, place: place, makeBag: makeBag, formatNum: formatNum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VillageCore = api;
})(typeof self !== 'undefined' ? self : this);
