// 탑 쌓기 핵심 로직 테스트 — node games/stack/test.js
const { computeDrop, hueFor } = require('./core.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error('FAIL', name, '\n  got ', g, '\n  want', w); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL', name); } }

// 1) 완전 빗나감 → miss
eq('완전 오른쪽 빗나감', computeDrop({ x: 0, w: 50 }, { x: 60, w: 50 }, 5), { miss: true });
eq('완전 왼쪽 빗나감', computeDrop({ x: 100, w: 50 }, { x: 0, w: 50 }, 5), { miss: true });
eq('딱 붙어 0겹침', computeDrop({ x: 0, w: 50 }, { x: 50, w: 50 }, 5), { miss: true });

// 2) 완벽 정렬 (오차 <= tol) → 너비 보존, overhang 없음
eq('완벽(정확)', computeDrop({ x: 30, w: 50 }, { x: 30, w: 50 }, 5), { miss: false, perfect: true, x: 30, w: 50, overhang: null });
eq('완벽(오차 4<=5)', computeDrop({ x: 30, w: 50 }, { x: 34, w: 50 }, 5), { miss: false, perfect: true, x: 30, w: 50, overhang: null });

// 3) 오른쪽으로 살짝 어긋남 → 왼겹침 유지 + 오른쪽 overhang
eq('오른쪽 어긋남', computeDrop({ x: 30, w: 50 }, { x: 50, w: 50 }, 5),
  { miss: false, perfect: false, x: 50, w: 30, overhang: { x: 80, w: 20 } });

// 4) 왼쪽으로 어긋남 → 오른겹침 유지 + 왼쪽 overhang
eq('왼쪽 어긋남', computeDrop({ x: 50, w: 50 }, { x: 30, w: 50 }, 5),
  { miss: false, perfect: false, x: 50, w: 30, overhang: { x: 30, w: 20 } });

// 5) 겹친 너비는 항상 양수이고 prev/active 범위 안
const r = computeDrop({ x: 40, w: 60 }, { x: 70, w: 60 }, 5);
ok('겹침 너비>0', !r.miss && r.w > 0);
ok('겹침 시작 >= prev.x', r.x >= 40);
ok('overhang 너비 = active 일부', r.overhang && r.overhang.w === 30);

// 6) hueFor 결정성 + 범위
ok('hueFor 범위', hueFor(0) >= 0 && hueFor(0) < 360 && hueFor(100) >= 0 && hueFor(100) < 360);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
