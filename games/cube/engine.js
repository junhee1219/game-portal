// Cube Snake — 표면 토폴로지 엔진
// 좌표계: CSS 3D와 동일 (x 오른쪽, y 아래, z 뷰어 방향), 큐브는 [0, S]^3 (S = 2N)
// 셀 중심: 한 좌표는 0 또는 S(면 위), 나머지 두 좌표는 홀수(1..S-1)
// 상태: pos(셀 중심), d(진행 방향, 단위축벡터), n(면 바깥쪽 법선)

const N = 6;          // 한 면의 격자 크기
const S = 2 * N;      // 스케일된 큐브 한 변

// --- 벡터 유틸 ---
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const neg = (a) => scale(a, -1);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const eq = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const key = (p) => p.join(',');

// --- 한 칸 전진 ---
// 같은 면이면 pos + 2d, 모서리를 넘으면 pos + d - n (n' = d, d' = -n)
function step(pos, d, n) {
  const cand = add(pos, scale(d, 2));
  const axis = d.findIndex((v) => v !== 0);
  if (cand[axis] > 0 && cand[axis] < S) {
    return { pos: cand, d, n };
  }
  return { pos: add(pos, sub(d, n)), d: neg(n), n: d };
}

// --- 회전 (뱀 기준) ---
// 화면상 n이 뷰어를 향할 때 좌회전/우회전이 시각적 좌/우와 일치
const turnLeft = (d, n) => cross(d, n);
const turnRight = (d, n) => cross(n, d);

// --- 면 정의 (렌더링 매핑과 공유) ---
// u: 면 로컬 +x(열 방향), v: 면 로컬 +y(행 방향), n: 바깥 법선
// cell(r, c) 중심 = origin + u*(2c+1) + v*(2r+1)
const FACES = {
  front:  { n: [0, 0, 1],  u: [1, 0, 0],  v: [0, 1, 0],  origin: [0, 0, S] },
  back:   { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0],  origin: [S, 0, 0] },
  right:  { n: [1, 0, 0],  u: [0, 0, -1], v: [0, 1, 0],  origin: [S, 0, S] },
  left:   { n: [-1, 0, 0], u: [0, 0, 1],  v: [0, 1, 0],  origin: [0, 0, 0] },
  top:    { n: [0, -1, 0], u: [1, 0, 0],  v: [0, 0, 1],  origin: [0, 0, 0] },
  bottom: { n: [0, 1, 0],  u: [1, 0, 0],  v: [0, 0, -1], origin: [0, S, S] },
};

// 3D 셀 중심 → { face, r, c }
function cellOf(pos) {
  for (const [face, f] of Object.entries(FACES)) {
    const rel = sub(pos, f.origin);
    if (rel[0] * f.n[0] + rel[1] * f.n[1] + rel[2] * f.n[2] !== 0) continue;
    const cu = rel[0] * f.u[0] + rel[1] * f.u[1] + rel[2] * f.u[2];
    const cv = rel[0] * f.v[0] + rel[1] * f.v[1] + rel[2] * f.v[2];
    if (cu % 2 === 1 && cv % 2 === 1 && cu > 0 && cu < S && cv > 0 && cv < S) {
      return { face, r: (cv - 1) / 2, c: (cu - 1) / 2 };
    }
  }
  return null;
}

// { face, r, c } → 3D 셀 중심
function posOf(face, r, c) {
  const f = FACES[face];
  return add(f.origin, add(scale(f.u, 2 * c + 1), scale(f.v, 2 * r + 1)));
}

// 표면 전체 셀 나열 (6 * N * N개)
function allCells() {
  const cells = [];
  for (const face of Object.keys(FACES))
    for (let r = 0; r < N; r++)
      for (let c = 0; c < N; c++) cells.push(posOf(face, r, c));
  return cells;
}

// 셀의 표면 이웃 4개 (방향 무관, BFS용)
function neighbors(pos, n) {
  const out = [];
  for (const f of Object.values(FACES)) {
    if (eq(f.n, n) || eq(f.n, neg(n))) continue;
    out.push(step(pos, f.n, n));
  }
  return out;
}

// 머리에서 먹이까지 표면 BFS → 현재 면을 벗어나는 첫 모서리 방향(면 로컬 d) 반환
// 먹이가 같은 면이면 null
function glowDirection(headPos, headN, foodPos) {
  const startCell = cellOf(headPos);
  const foodCell = cellOf(foodPos);
  if (startCell.face === foodCell.face) return null;
  const prev = new Map(); // key -> { from, state }
  const start = { pos: headPos, d: null, n: headN };
  const queue = [start];
  prev.set(key(headPos), { from: null });
  let found = null;
  while (queue.length && !found) {
    const cur = queue.shift();
    for (const nb of neighbors(cur.pos, cur.n)) {
      const k = key(nb.pos);
      if (prev.has(k)) continue;
      prev.set(k, { from: cur, state: nb });
      if (eq(nb.pos, foodPos)) { found = nb; break; }
      queue.push(nb);
    }
  }
  if (!found) return null;
  // 경로 역추적: 시작 면을 벗어나는 첫 스텝의 (벗어나기 직전 면 로컬 방향)을 찾는다
  const path = [];
  let cur = found;
  while (cur) {
    path.unshift(cur);
    cur = prev.get(key(cur.pos)).from;
  }
  // path[0] = 머리. 면이 바뀌는 첫 지점에서, 넘어간 직후 n(= 직전 진행 방향)이 글로우 방향
  for (let i = 1; i < path.length; i++) {
    if (!eq(path[i].n, headN)) return path[i].n; // 모서리를 넘는 순간 n' = 이전 d
  }
  return null;
}

if (typeof module !== 'undefined') {
  module.exports = {
    N, S, add, sub, scale, neg, cross, eq, key,
    step, turnLeft, turnRight, FACES, cellOf, posOf, allCells, neighbors, glowDirection,
  };
}
