// 리듬 타일 — 순수 로직 (DOM 없음, node test.js로 검증)
// 4개 레인. rows[i] = { lane, hit }. pending = 가장 아래(먼저 처리할) 미탭 행.
// judgeTap: 탭한 레인이 pending 행의 레인과 같으면 hit, 다르면 wrong(=게임오버).
(function (root) {
  'use strict';
  var LANES = 4;

  function judgeTap(rows, pending, lane) {
    if (pending < 0 || pending >= rows.length) return { hit: false, wrong: true };
    if (rows[pending].lane === lane) return { hit: true, wrong: false };
    return { hit: false, wrong: true };
  }

  // 다음 행 레인 생성 — 같은 레인 3연속은 피해 난이도/단조로움 완화.
  function nextLane(prevLane, prevPrevLane, rnd) {
    var r = (rnd == null ? Math.random() : rnd);
    var l = Math.floor(r * LANES) % LANES;
    if (l === prevLane && prevLane === prevPrevLane) l = (l + 1) % LANES;
    return l;
  }

  var api = { judgeTap: judgeTap, nextLane: nextLane, LANES: LANES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TilesCore = api;
})(typeof self !== 'undefined' ? self : this);
