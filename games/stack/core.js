// 탑 쌓기 — 순수 로직 (DOM 없음, node test.js로 검증 가능)
// computeDrop: 아래 블록(prev) 위로 움직이던 블록(active)을 떨어뜨렸을 때 결과를 계산.
//   prev/active = { x:왼쪽px, w:너비px }
//   반환: { miss } | { perfect, x, w, overhang } | { x, w, overhang }
//     overhang = 깎여 떨어지는 조각 { x, w } 또는 null
(function (root) {
  'use strict';

  function computeDrop(prev, active, perfectTol) {
    var tol = perfectTol || 0;
    var aL = active.x, aR = active.x + active.w;
    var pL = prev.x, pR = prev.x + prev.w;
    var ovL = Math.max(aL, pL), ovR = Math.min(aR, pR);
    var ov = ovR - ovL;
    if (ov <= 0) return { miss: true };
    // 완벽 정렬: 왼쪽 모서리 오차가 tol 이내 → 너비 보존(깎임 없음)
    if (Math.abs(aL - pL) <= tol) {
      return { miss: false, perfect: true, x: pL, w: prev.w, overhang: null };
    }
    var overhang = null;
    if (aL < ovL) overhang = { x: aL, w: ovL - aL };        // 왼쪽으로 삐져나옴
    else if (aR > ovR) overhang = { x: ovR, w: aR - ovR };  // 오른쪽으로 삐져나옴
    return { miss: false, perfect: false, x: ovL, w: ov, overhang: overhang };
  }

  // 층 인덱스 → 파스텔 단색 HSL (색상은 천천히 도는 무지개, 채도·명도는 차분하게 고정)
  function hueFor(i) { return (200 + i * 9) % 360; }
  function colorFor(i) { return 'hsl(' + hueFor(i) + ',46%,63%)'; }

  // 층 구간별 재질 티어 — 탑이 오를수록 재료가 진화한다 (오브젝트 서사)
  var TIERS = [
    { at: 0,  name: '목재',     base: '#c9a06a', alt: '#c2965e', line: 'rgba(120,84,40,.32)',  kind: 'wood' },
    { at: 10, name: '벽돌',     base: '#cf8a70', alt: '#c78066', line: 'rgba(130,60,40,.30)',  kind: 'brick' },
    { at: 20, name: '석재',     base: '#a8b2ba', alt: '#9fa9b2', line: 'rgba(70,85,95,.28)',   kind: 'stone' },
    { at: 30, name: '강철',     base: '#9fb6c6', alt: '#95adbe', line: 'rgba(60,90,110,.30)',  kind: 'steel' },
    { at: 40, name: '황금',     base: '#e2bc62', alt: '#dcb254', line: 'rgba(150,110,30,.32)', kind: 'gold' },
    { at: 50, name: '크리스탈', base: '#b9a7e0', alt: '#af9cd9', line: 'rgba(110,90,160,.32)', kind: 'crystal' }
  ];
  function tierIdx(i) { var t = 0; for (var k = 0; k < TIERS.length; k++) if (i >= TIERS[k].at) t = k; return t; }
  function tierFor(i) { return TIERS[tierIdx(i)]; }
  function nextTierAt(i) { var t = tierIdx(i); return t < TIERS.length - 1 ? TIERS[t + 1] : null; }

  var api = { computeDrop: computeDrop, hueFor: hueFor, colorFor: colorFor, TIERS: TIERS, tierIdx: tierIdx, tierFor: tierFor, nextTierAt: nextTierAt };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StackCore = api;
})(typeof self !== 'undefined' ? self : this);
