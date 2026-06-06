// 토폴로지 엔진 불변식 테스트 (node test.js)
const E = require('./engine');
const { N, S, step, turnLeft, turnRight, neg, eq, key, cellOf, posOf, allCells, neighbors, glowDirection } = E;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.error('FAIL:', msg); }
}

// 1. 커버리지: 표면 셀이 정확히 6*N*N개이고 모두 cellOf로 역변환 가능
{
  const cells = allCells();
  const keys = new Set(cells.map(key));
  assert(keys.size === 6 * N * N, `cell count ${keys.size} != ${6 * N * N}`);
  for (const p of cells) {
    const c = cellOf(p);
    assert(c !== null, `cellOf null for ${key(p)}`);
    assert(eq(posOf(c.face, c.r, c.c), p), `roundtrip mismatch ${key(p)}`);
  }
}

// 2. 벨트 루프: 아무 셀에서나 직진 4N스텝이면 정확히 원위치 (pos, d, n 모두)
{
  const starts = [
    { pos: posOf('front', 3, 5), d: [1, 0, 0], n: [0, 0, 1] },
    { pos: posOf('front', 3, 5), d: [0, -1, 0], n: [0, 0, 1] },
    { pos: posOf('top', 0, 0), d: [0, 0, 1], n: [0, -1, 0] },
    { pos: posOf('left', 5, 2), d: [0, 1, 0], n: [-1, 0, 0] },
    { pos: posOf('back', 4, 4), d: [-1, 0, 0], n: [0, 0, -1] },
  ];
  for (const s0 of starts) {
    let s = { ...s0 };
    for (let i = 0; i < 4 * N; i++) s = step(s.pos, s.d, s.n);
    assert(eq(s.pos, s0.pos) && eq(s.d, s0.d) && eq(s.n, s0.n),
      `belt loop broken from ${key(s0.pos)} d=${key(s0.d)}`);
  }
}

// 3. 가역성: 전진 후 방향 뒤집고 전진하면 원래 셀로 복귀
{
  for (const p of allCells()) {
    const c = cellOf(p);
    const f = E.FACES[c.face];
    for (const d of [f.u, neg(f.u), f.v, neg(f.v)]) {
      const s1 = step(p, d, f.n);
      const s2 = step(s1.pos, neg(s1.d), s1.n);
      assert(eq(s2.pos, p), `not reversible from ${key(p)} d=${key(d)}`);
    }
  }
}

// 4. 모든 스텝 결과가 유효한 표면 셀
{
  for (const p of allCells()) {
    const c = cellOf(p);
    const f = E.FACES[c.face];
    for (const d of [f.u, neg(f.u), f.v, neg(f.v)]) {
      const s1 = step(p, d, f.n);
      assert(cellOf(s1.pos) !== null, `step lands off-surface from ${key(p)} d=${key(d)}`);
    }
  }
}

// 5. 회전: 좌회전 4번 = 원위치, 좌회전+우회전 = 원위치, 회전 후에도 면 접선
{
  const f = E.FACES.front;
  let d = [1, 0, 0];
  for (let i = 0; i < 4; i++) d = turnLeft(d, f.n);
  assert(eq(d, [1, 0, 0]), 'turnLeft^4 != identity');
  assert(eq(turnRight(turnLeft([1, 0, 0], f.n), f.n), [1, 0, 0]), 'turnRight(turnLeft) != identity');
  // front(n=+z)에서 위(-y)로 가다 좌회전하면 시각적 왼쪽(-x)
  assert(eq(turnLeft([0, -1, 0], [0, 0, 1]), [-1, 0, 0]), 'visual left turn wrong');
  assert(eq(turnRight([0, -1, 0], [0, 0, 1]), [1, 0, 0]), 'visual right turn wrong');
}

// 6. 이웃: 모든 셀이 정확히 4개의 서로 다른 유효 이웃
{
  for (const p of allCells()) {
    const c = cellOf(p);
    const nbs = neighbors(p, E.FACES[c.face].n);
    assert(nbs.length === 4, `neighbors count != 4 at ${key(p)}`);
    const ks = new Set(nbs.map((s) => key(s.pos)));
    assert(ks.size === 4, `duplicate neighbors at ${key(p)}`);
    for (const nb of nbs) assert(cellOf(nb.pos) !== null, `invalid neighbor at ${key(p)}`);
  }
}

// 7. BFS 연결성: 한 셀에서 모든 셀 도달 가능
{
  const start = posOf('front', 0, 0);
  const seen = new Set([key(start)]);
  const q = [{ pos: start, n: [0, 0, 1] }];
  while (q.length) {
    const cur = q.shift();
    for (const nb of neighbors(cur.pos, cur.n)) {
      if (!seen.has(key(nb.pos))) { seen.add(key(nb.pos)); q.push(nb); }
    }
  }
  assert(seen.size === 6 * N * N, `flood fill reached ${seen.size} != ${6 * N * N}`);
}

// 8. 글로우 방향: front 머리, right 면 먹이 → +x 방향 모서리
{
  const head = posOf('front', 4, 4);
  const g1 = glowDirection(head, [0, 0, 1], posOf('right', 4, 4));
  assert(eq(g1, [1, 0, 0]), `glow toward right face: got ${g1 && key(g1)}`);
  const g2 = glowDirection(head, [0, 0, 1], posOf('top', 4, 4));
  assert(eq(g2, [0, -1, 0]), `glow toward top face: got ${g2 && key(g2)}`);
  const g3 = glowDirection(head, [0, 0, 1], posOf('front', 0, 0));
  assert(g3 === null, 'same-face food should not glow');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
