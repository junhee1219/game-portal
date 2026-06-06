// VASE — 순수 게임 로직 (브라우저 + node test.js 공용, DOM 의존 없음)
// 판 생성은 랜덤 셔플 그대로 두되, 한정 솔버로 "풀 수 있는 판"인지 확인하고
// 막힌 판이면 다시 섞는다. 솔버가 찾은 풀이 길이가 별점 기준(par)이 된다.
const VaseCore = (() => {
  const CAP = 4; // 병 하나의 용량(층 수)

  // ── 기본 규칙 ──
  const topColor = (t) => (t.length ? t[t.length - 1] : null);

  function topCount(t) {
    if (!t.length) return 0;
    const c = t[t.length - 1];
    let n = 0;
    for (let i = t.length - 1; i >= 0 && t[i] === c; i--) n++;
    return n;
  }

  function canPour(tubes, f, to) {
    if (f === to) return false;
    const a = tubes[f], b = tubes[to];
    if (!a || !b) return false;
    if (!a.length) return false;
    if (b.length >= CAP) return false;
    if (!b.length) return true;
    return topColor(a) === topColor(b);
  }

  const pourAmount = (tubes, f, to) =>
    Math.min(topCount(tubes[f]), CAP - tubes[to].length);

  // 새 상태를 돌려준다 (원본 불변)
  function applyPour(tubes, f, to) {
    const n = pourAmount(tubes, f, to);
    const next = tubes.map((t, i) => (i === f || i === to ? t.slice() : t));
    for (let i = 0; i < n; i++) next[to].push(next[f].pop());
    return next;
  }

  const isComplete = (t) => t.length === CAP && t.every((c) => c === t[0]);
  const isWin = (tubes) => tubes.every((t) => t.length === 0 || isComplete(t));

  // ── 판 생성 ──
  // fillColors: "가득 병 분량"의 색 목록 (중복 가능 — 같은 색 두 병 분량 = 더블 컬러)
  // sizes: 병별 유닛 수 배열 (0 = 빈 병). 합은 fillColors.length*CAP 이어야 한다.
  function generateBoard(fillColors, sizes, rng) {
    rng = rng || Math.random;
    // 완전 랜덤 셔플 대신 "런" 단위로 풀을 만든다:
    // 같은 색 2칸(가끔 3칸) 덩어리가 자연스럽게 섞여 손맛이 좋아진다
    const remain = {};
    let total = 0;
    for (const c of fillColors) { remain[c] = (remain[c] || 0) + CAP; total += CAP; }
    const pool = [];
    while (pool.length < total) {
      // 남은 유닛 수 가중 랜덤으로 색 선택 (마지막에 한 색만 몰리는 것 방지)
      let r = rng() * (total - pool.length);
      let c = null;
      for (const k in remain) {
        if (remain[k] <= 0) continue;
        r -= remain[k];
        if (r <= 0) { c = k; break; }
      }
      if (c === null) for (const k in remain) if (remain[k] > 0) { c = k; break; }
      let run = 1 + (rng() < 0.45 ? 1 : 0) + (rng() < 0.1 ? 1 : 0); // 1~3칸, 2칸이 자주
      run = Math.min(run, remain[c]);
      for (let i = 0; i < run; i++) pool.push(Number(c));
      remain[c] -= run;
    }
    const tubes = [];
    let p = 0;
    for (const s of sizes) { tubes.push(pool.slice(p, p + s)); p += s; }
    return tubes;
  }

  // 고전 구성: 꽉 찬 병 numColors개 + 빈 병 empties개
  function sizesFor(numColors, empties) {
    const sizes = Array(numColors).fill(CAP);
    for (let e = 0; e < empties; e++) sizes.push(0);
    return sizes;
  }

  // ── 난이도 곡선 ──
  // 레벨이 오를수록 빈 병이 줄고(4→0), 그다음엔 색 슬롯을 늘려(더블 컬러)
  // 판 자체가 커진다. 병은 최대 16개.
  // 밴드 = [F(색 슬롯 수, 중복 허용), N(물 든 병 수), E(빈 병 수)] — 2레벨마다 한 단계
  const BANDS = [
    [8, 8, 4],   // lv1-2   입문: 12병, 여유 16
    [8, 8, 3],   // lv3-4
    [8, 8, 2],   // lv5-6
    [8, 10, 1],  // lv7-8   부분 충전 병 등장
    [8, 9, 1],   // lv9-10
    [8, 12, 0],  // lv11-12 빈 병 제로
    [8, 11, 0],  // lv13-14
    [8, 10, 0],  // lv15-16
    [8, 9, 0],   // lv17-18 타이트: 여유 4
    [10, 10, 2], // lv19-20 더블 컬러 등장 (40유닛)
    [10, 12, 0], // lv21-22
    [12, 12, 2], // lv23-24 48유닛, 14병
    [12, 14, 0], // lv25-26
    [14, 14, 2], // lv27-28 56유닛, 16병
    [14, 16, 0], // lv29+   최대: 16병 전부 부분 충전, 여유 8
  ];
  function levelConfig(level, numColors, rng) {
    rng = rng || Math.random;
    const [F, N, E] = BANDS[Math.min(BANDS.length - 1, ((level - 1) / 2) | 0)];
    // 색 슬롯: 팔레트를 섞은 뒤 라운드로빈 — F가 8을 넘으면 일부 색이 두 병 분량
    const colorList = [];
    for (let c = 0; c < numColors; c++) colorList.push(c);
    for (let i = colorList.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [colorList[i], colorList[j]] = [colorList[j], colorList[i]];
    }
    const fillColors = [];
    for (let k = 0; k < F; k++) fillColors.push(colorList[k % numColors]);
    // N개 병에 F*CAP 유닛 배분: 전부 4에서 시작해 랜덤 감소 → 부분 충전 병
    const sizes = Array(N).fill(CAP);
    let shed = CAP * (N - F);
    while (shed > 0) {
      const i = (rng() * N) | 0;
      if (sizes[i] > 1) { sizes[i]--; shed--; }
    }
    for (let e = 0; e < E; e++) sizes.push(0);
    return { fillColors, sizes };
  }

  // ── 솔버 (그리디 정렬 DFS + 정규화 방문 집합, 노드 예산 한정) ──
  // 병 순서는 의미가 없으므로 정렬해서 같은 상태로 본다 → 탐색 공간 급감
  const canon = (tubes) => tubes.map((t) => t.join(',')).sort().join('|');

  // 유망한 수부터 시도: 병 완성 > 같은 색 위에 붓기 > 병 비우기 > 빈 병은 최후
  // jitterRng를 주면 동점 근처 순서가 살짝 섞임 → 랜덤 재시작용
  function legalMoves(tubes, jitterRng) {
    const moves = [];
    let firstEmpty = -1;
    for (let i = 0; i < tubes.length; i++) {
      if (!tubes[i].length && firstEmpty < 0) firstEmpty = i;
    }
    for (let f = 0; f < tubes.length; f++) {
      const a = tubes[f];
      if (!a.length || isComplete(a)) continue;
      const aTop = topCount(a);
      const aUniform = aTop === a.length; // 병 전체가 한 색
      for (let t = 0; t < tubes.length; t++) {
        if (!canPour(tubes, f, t)) continue;
        if (!tubes[t].length) {
          if (aUniform) continue;       // 한 색짜리를 빈 병에 → 무의미
          if (t !== firstEmpty) continue; // 빈 병끼리는 대칭 → 첫 빈 병만
        }
        let score = 0;
        const n = pourAmount(tubes, f, t);
        if (tubes[t].length) {
          score += 2; // 같은 색 위에 붓기
          if (tubes[t].length + n === CAP && topCount(tubes[t]) === tubes[t].length && n === aTop) score += 3; // 완성 가능성
        } else {
          score -= 1; // 빈 병은 최후의 수단
        }
        if (n === a.length) score += 1; // 병이 완전히 비워짐
        if (jitterRng) score += jitterRng() * 0.9;
        moves.push({ f, t, score });
      }
    }
    moves.sort((x, y) => y.score - x.score);
    return moves;
  }

  // 반환: { solved, moves: [[f,t],...], nodes, exhausted }
  function solve(start, nodeBudget, jitterRng) {
    nodeBudget = nodeBudget || 80000;
    const visited = new Set([canon(start)]);
    const path = [];
    let nodes = 0;
    let exhausted = false;

    function dfs(state) {
      if (isWin(state)) return true;
      if (++nodes > nodeBudget) { exhausted = true; return false; }
      for (const { f, t } of legalMoves(state, jitterRng)) {
        const next = applyPour(state, f, t);
        const key = canon(next);
        if (visited.has(key)) continue;
        visited.add(key);
        path.push([f, t]);
        if (dfs(next)) return true;
        if (exhausted) return false;
        path.pop();
      }
      return false;
    }

    const solved = dfs(start);
    return { solved, moves: solved ? path.slice() : null, nodes, exhausted };
  }

  // 이론적 하한: 모든 색 덩어리(세그먼트)를 색당 하나로 합치는 데 필요한 최소 이동
  function countSegments(tubes) {
    let seg = 0;
    for (const t of tubes) {
      for (let i = 0; i < t.length; i++) if (i === 0 || t[i] !== t[i - 1]) seg++;
    }
    return seg;
  }

  // 주어진 구성으로 풀 수 있는 판을 찾는다 (성공 시 par = 최단 발견 풀이 길이)
  function trySolvable(fillColors, sizes, rng, nodeBudget, restarts) {
    const tubes = generateBoard(fillColors, sizes, rng);
    const r = solve(tubes, nodeBudget);
    if (!r.solved) return null;
    let best = r.moves;
    for (let k = 1; k < restarts; k++) {
      // 랜덤 재시작으로 더 짧은 풀이를 찾아 par를 타이트하게
      const r2 = solve(tubes, nodeBudget, rng);
      if (r2.solved && r2.moves.length < best.length) best = r2.moves;
    }
    return { tubes, par: best.length, solverMoves: best };
  }

  // 풀 수 있는 판 + par(별점 기준) 생성 (고전 구성: 꽉 찬 병 + 빈 병)
  function generateSolvableBoard(numColors, empties, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const maxTries = opts.maxTries || 12;
    const nodeBudget = opts.nodeBudget || 80000;
    const restarts = opts.restarts || 4;
    const fillColors = [];
    for (let c = 0; c < numColors; c++) fillColors.push(c);
    for (let i = 0; i < maxTries; i++) {
      const found = trySolvable(fillColors, sizesFor(numColors, empties), rng, nodeBudget, restarts);
      if (found) return found;
    }
    // 도달 거의 불가: 빈 병 하나 더 주고 재시도
    return generateSolvableBoard(numColors, empties + 1, opts);
  }

  // 레벨 난이도 곡선을 적용한 판 생성.
  // 타이트한 구성(여유 4칸)은 랜덤 셔플이 못 푸는 판일 수 있으므로
  // 여러 번 다시 섞고, 그래도 안 되면 빈 병을 하나씩 추가해 완화한다.
  function generateLevel(level, numColors, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const maxTries = opts.maxTries || 24;
    const nodeBudget = opts.nodeBudget || 80000;
    const restarts = opts.restarts || 4;
    for (let relax = 0; relax <= 2; relax++) {
      for (let t = 0; t < maxTries; t++) {
        const { fillColors, sizes } = levelConfig(level, numColors, rng);
        for (let e = 0; e < relax; e++) sizes.push(0);
        const found = trySolvable(fillColors, sizes, rng, nodeBudget, restarts);
        if (found) return found;
      }
    }
    // 최후의 안전망: 고전 구성
    return generateSolvableBoard(numColors, 4, opts);
  }

  // ── 별점 ──
  // 3★: 솔버(봇)와 같거나 더 적은 이동 / 2★: par×1.5 이내 / 1★: 클리어
  function starsFor(moves, par) {
    if (moves <= par) return 3;
    if (moves <= Math.ceil(par * 1.5)) return 2;
    return 1;
  }

  return {
    CAP, topColor, topCount, canPour, pourAmount, applyPour,
    isComplete, isWin, generateBoard, sizesFor, levelConfig,
    generateSolvableBoard, generateLevel,
    solve, legalMoves, canon, countSegments, starsFor,
  };
})();

if (typeof module !== 'undefined') module.exports = VaseCore;
if (typeof window !== 'undefined') window.VaseCore = VaseCore;
