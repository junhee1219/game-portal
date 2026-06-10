// 리듬 타일 핵심 로직 테스트 — node games/tiles/test.js
const { judgeTap, nextLane, LANES } = require('./core.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) pass++; else { fail++; console.error('FAIL', name, '\n  got ', g, '\n  want', w); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL', name); } }

const rows = [{ lane: 2 }, { lane: 0 }, { lane: 3 }, { lane: 1 }];

// 1) pending 행 레인과 일치 → hit
eq('정답 탭', judgeTap(rows, 0, 2), { hit: true, wrong: false });
eq('정답 탭(다음행)', judgeTap(rows, 1, 0), { hit: true, wrong: false });

// 2) 빈 칸(다른 레인) 탭 → wrong
eq('오답 탭', judgeTap(rows, 0, 1), { hit: false, wrong: true });
eq('오답 탭2', judgeTap(rows, 2, 0), { hit: false, wrong: true });

// 3) pending 범위 밖 → wrong (방어)
eq('pending 음수', judgeTap(rows, -1, 2), { hit: false, wrong: true });
eq('pending 초과', judgeTap(rows, 99, 2), { hit: false, wrong: true });

// 4) nextLane: 항상 0..LANES-1
for (let i = 0; i < 200; i++) {
  const l = nextLane((i) % 4, (i + 1) % 4);
  if (l < 0 || l >= LANES) { fail++; console.error('FAIL nextLane 범위', l); break; }
}
pass++;

// 5) nextLane: 같은 레인 3연속 방지 (prev==prev2==후보면 회피)
ok('3연속 회피', nextLane(1, 1, 0.30) !== 1);  // rnd 0.30*4=1.2→1, prev=prev2=1 → 회피
ok('정상 통과', nextLane(2, 0, 0.30) === 1);   // prev≠prev2 → 회피 안 함, 1 그대로

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
