// VASE 로직 테스트 — node test.js
// 핵심 보증: 생성된 판은 반드시 풀 수 있고, 솔버가 돌려준 풀이를 그대로 재생하면 실제로 이긴다.
const C = require('./core.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ FAIL:', msg); }
}

// 재현 가능한 시드 RNG (LCG)
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// ── 기본 규칙 ──
console.log('• 기본 규칙');
{
  const tubes = [[0, 0, 1], [1], [], [2, 2, 2, 2], [0]];
  ok(C.topColor(tubes[0]) === 1, 'topColor');
  ok(C.topCount([0, 1, 1, 1]) === 3, 'topCount 연속');
  ok(C.topCount([]) === 0, 'topCount 빈 병');
  ok(C.canPour(tubes, 0, 1) === true, '같은 색 위에 붓기 가능');
  ok(C.canPour(tubes, 0, 2) === true, '빈 병에 붓기 가능');
  ok(C.canPour(tubes, 4, 0) === false, '다른 색 위에 못 부음');
  ok(C.canPour(tubes, 0, 3) === false, '꽉 찬 병에 못 부음');
  ok(C.canPour(tubes, 2, 0) === false, '빈 병에서 못 부음');
  ok(C.canPour(tubes, 0, 0) === false, '자기 자신에 못 부음');
  ok(C.isComplete([2, 2, 2, 2]) === true, 'isComplete 완성');
  ok(C.isComplete([2, 2, 2]) === false, 'isComplete 미달');
  ok(C.isWin([[1, 1, 1, 1], []]) === true, 'isWin');
  ok(C.isWin([[1, 1, 1, 0], []]) === false, 'isWin 미완');
}

// ── applyPour 정합성 ──
console.log('• applyPour');
{
  const tubes = [[0, 1, 1], [1, 1], []];
  const next = C.applyPour(tubes, 0, 1); // 위의 1 두 칸 중 2칸만 옮길 공간
  ok(next[0].join() === '0', '소스에서 부은 만큼 빠짐');
  ok(next[1].join() === '1,1,1,1', '대상에 채워짐');
  ok(tubes[0].length === 3, '원본 불변');
}

// ── 솔버: 자명한 판 ──
console.log('• 솔버 (자명한 판)');
{
  const tubes = [[0, 0, 1, 1], [1, 1, 0, 0], [], []];
  const r = C.solve(tubes, 1000);
  ok(r.solved, '자명한 판 풀림');
  // 풀이를 재생해서 정말 이기는지
  let st = tubes;
  for (const [f, t] of r.moves) {
    ok(C.canPour(st, f, t), `재생 중 유효한 수 (${f}→${t})`);
    st = C.applyPour(st, f, t);
  }
  ok(C.isWin(st), '풀이 재생 → 승리');
}

// ── 솔버: 못 푸는 판은 솔버도 포기해야 ──
console.log('• 솔버 (불가능한 판)');
{
  // 빈 병 없이 서로 잠긴 형태 — 어떤 수도 없음
  const tubes = [[0, 1, 0, 1], [1, 0, 1, 0]];
  const r = C.solve(tubes, 10000);
  ok(!r.solved, '불가능한 판은 안 풀림');
  ok(!r.exhausted, '예산 고갈이 아니라 탐색 완료로 끝남');
}

// ── 생성기: 본게임 규격(8색 12병) 풀이 보장 ──
console.log('• 생성기 풀이 보장 (8색+4빈병 × 30판)');
{
  const rng = lcg(20260606);
  let solvedAll = true, parMin = Infinity, parMax = 0, nodesMax = 0;
  for (let i = 0; i < 30; i++) {
    const { tubes, par, solverMoves } = C.generateSolvableBoard(8, 4, { rng, nodeBudget: 80000 });
    if (!solverMoves) { solvedAll = false; continue; }
    // 풀이 재생 검증
    let st = tubes;
    for (const [f, t] of solverMoves) {
      if (!C.canPour(st, f, t)) { solvedAll = false; break; }
      st = C.applyPour(st, f, t);
    }
    if (!C.isWin(st)) solvedAll = false;
    parMin = Math.min(parMin, par); parMax = Math.max(parMax, par);
    ok(par >= C.countSegments(tubes) - 8, `par(${par})는 이론 하한 이상`);
  }
  ok(solvedAll, '30판 모두 풀이 보장 + 재생 검증');
  console.log(`  par 범위: ${parMin}~${parMax}`);
}

// ── 솔버 속도(예산) 체감 확인 ──
console.log('• 생성 속도');
{
  const rng = lcg(42);
  const t0 = Date.now();
  for (let i = 0; i < 10; i++) C.generateSolvableBoard(8, 4, { rng });
  const ms = Date.now() - t0;
  console.log(`  10판 생성+검증: ${ms}ms (판당 ${(ms / 10).toFixed(0)}ms)`);
  ok(ms / 10 < 1500, '판당 평균 1.5초 미만');
}

// ── 난이도 곡선: 튜토리얼(lv1-3) → 밴드 → 파라미터 무한 곡선(lv31+, 최대 22병/12색) ──
console.log('• 난이도 곡선 (levelConfig)');
{
  const rng = lcg(777);
  for (let lv = 1; lv <= 110; lv++) {
    const nc = C.colorsFor(lv);
    const { fillColors, sizes } = C.levelConfig(lv, nc, rng);
    const sum = sizes.reduce((a, b) => a + b, 0);
    ok(sum === fillColors.length * C.CAP, `lv${lv}: 유닛 합 = 색 슬롯×4`);
    ok(sizes.length <= 22, `lv${lv}: 병 최대 22개 (실제 ${sizes.length})`);
    ok(sizes.every((s) => s >= 0 && s <= C.CAP), `lv${lv}: 병 크기 0~CAP`);
    ok(fillColors.every((c) => c >= 0 && c < nc), `lv${lv}: 색 인덱스 유효(<${nc})`);
  }
  const cfg = (lv) => C.levelConfig(lv, C.colorsFor(lv), rng);
  const empt = (lv) => cfg(lv).sizes.filter((s) => s === 0).length;
  // 튜토리얼
  ok(cfg(1).sizes.length === 5 && empt(1) === 2, 'lv1: 튜토리얼 5병(빈 2)');
  ok(cfg(3).sizes.length === 7, 'lv3: 튜토리얼 끝(7병)');
  // 기존 밴드 유지
  ok(empt(9) === 1, 'lv9: 빈 병 1');
  ok(empt(11) === 0, 'lv11: 빈 병 0');
  ok(cfg(19).fillColors.length === 10, 'lv19: 더블 컬러 (슬롯 10)');
  ok(cfg(29).fillColors.length === 14 && cfg(29).sizes.length === 16, 'lv29: 16병 최대 밴드');
  // 파라미터 무한 곡선 (slack 8 = N-F=2 고정, 22병/12색 상한)
  ok(C.colorsFor(70) === 12 && cfg(70).sizes.length === 22, 'lv70: 22병 12색');
  ok(cfg(99).sizes.length === 22, 'lv99: 22병 상한 유지');
  ok(cfg(70).sizes.length - cfg(70).fillColors.length === 2, 'lv70: slack 2병(여유8) 고정');
}

// ── 무한 곡선 풀이 보장 + 폴백 미발생 (doc 검증 전략) ──
console.log('• 무한 곡선 풀이 보장 (lv 30/50/70/100)');
{
  for (const lv of [30, 50, 70, 100]) {
    const nc = C.colorsFor(lv);
    const expN = Math.min(22, 16 + Math.floor((lv - 30) / 6));
    for (let i = 0; i < 3; i++) {
      const rng = lcg(0x5151 + lv * 31 + i);
      const { tubes, par, solverMoves } = C.generateLevel(lv, nc, { rng });
      ok(!!solverMoves, `lv${lv}: 풀이 존재`);
      ok(tubes.length >= expN, `lv${lv}: 폴백 미발생(병 ${tubes.length}≥${expN})`);
      let st = tubes;
      for (const [f, t] of solverMoves) st = C.applyPour(st, f, t);
      ok(C.isWin(st), `lv${lv}: 풀이 재생 → 승리 (par ${par})`);
    }
  }
}

// ── 레벨 생성: 전 난이도 밴드에서 풀이 보장 ──
console.log('• 레벨 생성 풀이 보장 (lv 1/9/17/19/23/29 × 5판)');
{
  const rng = lcg(99);
  for (const lv of [1, 9, 17, 19, 23, 29]) {
    for (let i = 0; i < 5; i++) {
      const { tubes, par, solverMoves } = C.generateLevel(lv, 8, { rng });
      ok(!!solverMoves, `lv${lv}: 풀이 존재`);
      ok(tubes.length <= 16, `lv${lv}: 병 16개 이하`);
      let st = tubes;
      for (const [f, t] of solverMoves) {
        if (!C.canPour(st, f, t)) { ok(false, `lv${lv}: 풀이 재생 중 무효한 수`); break; }
        st = C.applyPour(st, f, t);
      }
      ok(C.isWin(st), `lv${lv}: 풀이 재생 → 승리 (par ${par}, 병 ${tubes.length}개)`);
    }
  }
}

// ── 별점 ──
console.log('• 별점');
{
  ok(C.starsFor(30, 30) === 3, 'par 동률 → 3★');
  ok(C.starsFor(29, 30) === 3, 'par 미만 → 3★');
  ok(C.starsFor(45, 30) === 2, 'par×1.5 이내 → 2★');
  ok(C.starsFor(46, 30) === 1, '그 이상 → 1★');
}

console.log(`\n결과: ${pass} 통과, ${fail} 실패`);
process.exit(fail ? 1 : 0);
