// 무지개 잇기 — core.js 검증 (node test.js)
// 생성된 모든 레벨이 (1)풀 수 있고 (2)정답이 보드를 빈칸 없이 채우는지 확인.
const C = require('./core.js');

let fail = 0;
function ok(cond, msg) { if (!cond) { console.error('  ✗ ' + msg); fail++; } }

// 1) 결정성: 같은 레벨은 같은 보드
for (const lv of [1, 5, 12, 30]) {
  const a = JSON.stringify(C.genLevel(lv));
  const b = JSON.stringify(C.genLevel(lv));
  ok(a === b, `레벨 ${lv} 결정적 생성`);
}

// 2) 1~80 레벨 전부 유효(전칸 덮음 + 인접 단순경로 + 구슬 색당 2개)
let minColors = 99, maxColors = 0, minSize = 99, maxSize = 0;
for (let lv = 1; lv <= 80; lv++) {
  const L = C.genLevel(lv);
  ok(C.validate(L), `레벨 ${lv} 유효(정답이 보드를 가득 채움)`);
  ok(L.pairs.length === L.colors, `레벨 ${lv} 색 수 일치`);
  // 모든 구슬 좌표가 보드 안
  for (const p of L.pairs) {
    ok(p.a.x >= 0 && p.a.x < L.w && p.a.y >= 0 && p.a.y < L.h, `레벨 ${lv} 구슬 a 범위`);
    ok(p.b.x >= 0 && p.b.x < L.w && p.b.y >= 0 && p.b.y < L.h, `레벨 ${lv} 구슬 b 범위`);
  }
  minColors = Math.min(minColors, L.colors); maxColors = Math.max(maxColors, L.colors);
  minSize = Math.min(minSize, L.w); maxSize = Math.max(maxSize, L.w);
}

// 3) 색 수는 팔레트 안(<=8)
ok(maxColors <= C.PALETTE.length, `색 수 <= 팔레트(${C.PALETTE.length})`);

console.log(`보드 ${minSize}~${maxSize}, 색 ${minColors}~${maxColors}`);
console.log(fail === 0 ? 'PASS — 모든 레벨 검증 통과' : `FAIL — ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
