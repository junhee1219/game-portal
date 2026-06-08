// 솔버 스트레스 테스트 — 고난도 구성에서 generateLevel이 실제로 풀고
// par를 돌려주는지 vs 완화 폴백(쉬운 판)으로 떨어지는지 측정.
// node stress.js
const C = require('./core.js');

function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// 임의 F/N/E 구성으로 풀 수 있는 판을 직접 시도 (trySolvable 재현)
function attempt(F, N, E, numColors, rng, nodeBudget) {
  // fillColors: 팔레트 round-robin
  const colorList = [];
  for (let c = 0; c < numColors; c++) colorList.push(c);
  for (let i = colorList.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [colorList[i], colorList[j]] = [colorList[j], colorList[i]];
  }
  const fillColors = [];
  for (let k = 0; k < F; k++) fillColors.push(colorList[k % numColors]);
  const sizes = Array(N).fill(C.CAP);
  let shed = C.CAP * (N - F);
  while (shed > 0) {
    const i = (rng() * N) | 0;
    if (sizes[i] > 1) { sizes[i]--; shed--; }
  }
  for (let e = 0; e < E; e++) sizes.push(0);
  const tubes = C.generateBoard(fillColors, sizes, rng);
  const t0 = process.hrtime.bigint();
  const r = C.solve(tubes, nodeBudget);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return { solved: r.solved, exhausted: r.exhausted, nodes: r.nodes, ms, par: r.solved ? r.moves.length : null };
}

// 24회 재시도 안에 한 번이라도 풀리면 성공(=generateLevel이 그 구성으로 판 제공)
// 한 번도 안 풀리면 폴백(쉬운 판)으로 추락
function band(label, F, N, E, numColors, nodeBudget, trials) {
  let ok = 0, totalTriesToFirst = 0, totalMs = 0, parSum = 0, worstMs = 0;
  for (let trial = 0; trial < trials; trial++) {
    const rng = lcg(0x9e37 + trial * 7919);
    let got = false;
    for (let k = 0; k < 24; k++) {
      const a = attempt(F, N, E, numColors, rng, nodeBudget);
      totalMs += a.ms; worstMs = Math.max(worstMs, a.ms);
      if (a.solved) { got = true; totalTriesToFirst += (k + 1); parSum += a.par; break; }
    }
    if (got) ok++;
  }
  const rate = (ok / trials * 100).toFixed(0);
  const avgPar = ok ? (parSum / ok).toFixed(0) : '-';
  const avgTries = ok ? (totalTriesToFirst / ok).toFixed(1) : '-';
  console.log(
    `${label.padEnd(34)} solv=${rate}% tries→${avgTries} par~${avgPar} ` +
    `avgMs=${(totalMs / (trials)).toFixed(0)} worstMs=${worstMs.toFixed(0)}`
  );
}

console.log('=== 현재 곡선 끝(Lv29+) 및 그 이상 구성 ===');
console.log('형식: [F색슬롯, N물병, E빈병] 색수, 노드예산 / solv=24회내 풀린비율\n');

const B = 80000; // 현재 nodeBudget
const T = 12;    // 구성당 시도 수

console.log('-- 현행 천장 (참고) --');
band('Lv29  [14,16,0] c8  free8', 14, 16, 0, 8, B, T);

console.log('\n-- 슬랙 축소 (색수 8 고정) --');
band('[15,16,0] c8 free4', 15, 16, 0, 8, B, T);
band('[16,16,0] c8 free0', 16, 16, 0, 8, B, T);
band('[15,16,1] c8 free8(+1빈)', 15, 16, 1, 8, B, T);

console.log('\n-- 병 수 확대 (slack 8 유지: N-F=2) --');
band('[16,18,0] c8 free8', 16, 18, 0, 8, B, T);
band('[18,20,0] c8 free8', 18, 20, 0, 8, B, T);
band('[20,22,0] c8 free8', 20, 22, 0, 8, B, T);

console.log('\n-- 색 팔레트 확대 (진짜 새 색) --');
band('[10,12,0] c10 free8', 10, 12, 0, 10, B, T);
band('[12,14,0] c12 free8', 12, 14, 0, 12, B, T);
band('[14,16,0] c12 free8', 14, 16, 0, 12, B, T);
band('[16,18,0] c12 free8', 16, 18, 0, 12, B, T);
band('[18,20,0] c12 free8', 18, 20, 0, 12, B, T);

console.log('\n-- 큰 노드예산(300k)으로 동일 구성 재시도 --');
band('[18,20,0] c12 free8 B300k', 18, 20, 0, 12, 300000, T);
band('[20,22,0] c8  free8 B300k', 20, 22, 0, 8, 300000, T);
band('[16,16,0] c8  free0 B300k', 16, 16, 0, 8, 300000, T);

console.log('\n-- 최난도 조합 (slack4 + 다병 + 다색) --');
band('[19,20,0] c12 free4', 19, 20, 0, 12, 300000, 16);
band('[17,18,0] c10 free4', 17, 18, 0, 10, 300000, 16);
band('[21,22,0] c12 free4', 21, 22, 0, 12, 300000, 16);
