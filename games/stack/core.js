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

  var api = { computeDrop: computeDrop, hueFor: hueFor, colorFor: colorFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.StackCore = api;
})(typeof self !== 'undefined' ? self : this);
