// 무지개 잇기 — 순수 로직 (DOM 없음, node test.js로 검증 가능)
// 같은 색 구슬 두 개를 선으로 이어 보드를 가득 채우는 Flow 류 퍼즐.
//
// 레벨 생성은 "항상 풀 수 있고, 정답이 보드를 빈칸 없이 채우는" 것이 보장돼야 한다.
// 방법: ① backbite 알고리즘으로 격자 전체를 덮는 해밀턴 경로 1개를 무작위로 만든다.
//        ② 그 경로를 K개의 연속 구간으로 자른다. 각 구간이 한 색의 정답 경로가 되고,
//           구간의 양 끝 칸이 그 색의 두 구슬(endpoint)이 된다.
//        구간들은 한 경로를 자른 것이라 칸이 겹치지 않고(교차 없음) 모든 칸을 덮는다 → 항상 정답 존재.
// 레벨 번호로 seed → 같은 레벨은 어느 기기에서나 같은 보드.
(function (root) {
  'use strict';

  // ── 결정적 RNG (mulberry32) ──
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 레벨 → 보드 크기/색 수
  function levelSpec(level) {
    var size = Math.min(9, 5 + Math.floor((level - 1) / 3)); // 5,5,5,6,6,6,7,...→9
    var colors = Math.max(3, size - 1);                       // 5→4, 6→5, ... 9→8
    return { w: size, h: size, colors: colors };
  }

  // 격자 위 boustrophedon(뱀) 순서 → 자명한 해밀턴 경로
  function snakePath(w, h) {
    var path = [];
    for (var y = 0; y < h; y++) {
      if (y % 2 === 0) for (var x = 0; x < w; x++) path.push(y * w + x);
      else for (var x2 = w - 1; x2 >= 0; x2--) path.push(y * w + x2);
    }
    return path;
  }

  // backbite: 무작위 해밀턴 경로로 섞기. 항상 성공, 매 스텝 O(구간 길이).
  function backbite(w, h, rng, iters) {
    var path = snakePath(w, h);
    var N = w * h;
    var pos = new Int32Array(N);
    for (var i = 0; i < N; i++) pos[path[i]] = i;

    function neighbors(cell) {
      var x = cell % w, y = (cell - x) / w, r = [];
      if (x > 0) r.push(cell - 1);
      if (x < w - 1) r.push(cell + 1);
      if (y > 0) r.push(cell - w);
      if (y < h - 1) r.push(cell + w);
      return r;
    }
    function reverse(lo, hi) { // path[lo..hi] 뒤집기 + pos 갱신
      while (lo < hi) {
        var a = path[lo], b = path[hi];
        path[lo] = b; path[hi] = a; pos[b] = lo; pos[a] = hi;
        lo++; hi--;
      }
    }
    var T = iters || N * 12;
    for (var k = 0; k < T; k++) {
      var atTail = rng() < 0.5;
      var end = atTail ? path[N - 1] : path[0];
      var nbs = neighbors(end);
      var nb = nbs[(rng() * nbs.length) | 0];
      var j = pos[nb];
      if (atTail) {
        if (j >= N - 2) continue;       // 이미 꼬리의 이웃
        reverse(j + 1, N - 1);          // 꼬리쪽 접기 → 새 꼬리 = 옛 path[j+1]
      } else {
        if (j <= 1) continue;           // 이미 머리의 이웃
        reverse(0, j - 1);              // 머리쪽 접기 → 새 머리 = 옛 path[j-1]
      }
    }
    return path;
  }

  // 경로를 K개 연속 구간으로 자르기. 각 구간 길이 >= 2.
  function cutLengths(N, k, rng) {
    var base = Math.floor(N / k);
    var rem = N - base * k;
    var lens = [];
    for (var i = 0; i < k; i++) lens.push(base);
    // 나머지를 무작위 구간에 +1
    var idx = [];
    for (var a = 0; a < k; a++) idx.push(a);
    for (var s = idx.length - 1; s > 0; s--) { var t = (rng() * (s + 1)) | 0; var tmp = idx[s]; idx[s] = idx[t]; idx[t] = tmp; }
    for (var r = 0; r < rem; r++) lens[idx[r]]++;
    // 약간의 변주: 길이 흔들기 (>=2 유지)
    for (var p = 0; p < k * 2; p++) {
      var giver = (rng() * k) | 0, taker = (rng() * k) | 0;
      if (giver !== taker && lens[giver] > 2) { lens[giver]--; lens[taker]++; }
    }
    return lens;
  }

  // 레벨 생성 → { w, h, colors, pairs:[{ci, a:{x,y}, b:{x,y}}], solution:[[cell..]] }
  function genLevel(level) {
    var spec = levelSpec(level);
    var w = spec.w, h = spec.h, K = spec.colors, N = w * h;
    var rng = makeRng((level * 2654435761) >>> 0 ^ 0x9e3779b9);
    var path = backbite(w, h, rng, N * 12);
    var lens = cutLengths(N, K, rng);

    var pairs = [], solution = [], off = 0;
    for (var ci = 0; ci < K; ci++) {
      var seg = path.slice(off, off + lens[ci]);
      off += lens[ci];
      var a = seg[0], b = seg[seg.length - 1];
      pairs.push({
        ci: ci,
        a: { x: a % w, y: (a - a % w) / w },
        b: { x: b % w, y: (b - b % w) / w },
      });
      solution.push(seg.slice());
    }
    return { level: level, w: w, h: h, colors: K, pairs: pairs, solution: solution };
  }

  // 검증: 레벨이 (1)모든 칸을 덮고 (2)구슬이 색마다 정확히 2개이며 (3)정답 구간이
  //       인접 칸으로 이어지는 단순경로인지.
  function validate(lvl) {
    var w = lvl.w, h = lvl.h, N = w * h;
    var seen = new Array(N).fill(0);
    for (var s = 0; s < lvl.solution.length; s++) {
      var seg = lvl.solution[s];
      if (seg.length < 2) return false;
      for (var i = 0; i < seg.length; i++) {
        var c = seg[i];
        if (c < 0 || c >= N || seen[c]) return false;
        seen[c] = 1;
        if (i > 0) {
          var prev = seg[i - 1];
          var dx = Math.abs((c % w) - (prev % w));
          var dy = Math.abs(((c - c % w) / w) - ((prev - prev % w) / w));
          if (dx + dy !== 1) return false; // 인접하지 않음
        }
      }
    }
    for (var n = 0; n < N; n++) if (!seen[n]) return false; // 빈칸
    return true;
  }

  // 색 인덱스 → 캔디 톤 팔레트(채도·명도 차분, 검보라/네온 금지)
  var PALETTE = [
    { base: '#ff7a8a', rim: '#ffd2d8' }, // 딸기
    { base: '#ffb259', rim: '#ffe2bd' }, // 살구
    { base: '#ffd84d', rim: '#fff1b0' }, // 레몬
    { base: '#5fd08a', rim: '#c8f0d6' }, // 민트
    { base: '#4fcfd0', rim: '#c2f0f0' }, // 청록
    { base: '#6e9bff', rim: '#cad9ff' }, // 하늘
    { base: '#b18cff', rim: '#e2d6ff' }, // 라벤더
    { base: '#ff8fd0', rim: '#ffd4ee' }, // 분홍
  ];

  var api = {
    makeRng: makeRng, levelSpec: levelSpec, snakePath: snakePath,
    backbite: backbite, cutLengths: cutLengths, genLevel: genLevel,
    validate: validate, PALETTE: PALETTE,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlowCore = api;
})(typeof self !== 'undefined' ? self : this);
