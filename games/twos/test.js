// 2048 핵심 로직 테스트 — node games/twos/test.js
const { slideIndices, move, hasMoves, emptyCells, maxTile } = require('./core.js');

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.error('FAIL', name, '\n  got ', g, '\n  want', w); }
}
function ok(name, cond) { if (cond) pass++; else { fail++; console.error('FAIL', name); } }

// 1) 슬라이드: 빈칸 압축 (이동만)
eq('압축', slideIndices([0, 2, 0, 2]).result, [4, 0, 0, 0]);
eq('압축 점수', slideIndices([0, 2, 0, 2]).gained, 4);

// 2) 합치기는 한 번만 (4 4 4 4 → 8 8)
eq('이중 합치기 한 번씩', slideIndices([4, 4, 4, 4]).result, [8, 8, 0, 0]);
eq('이중 합치기 점수', slideIndices([4, 4, 4, 4]).gained, 16);

// 3) 2 2 2 → 4 2 (앞쪽 우선 합치기)
eq('홀수 합치기', slideIndices([2, 2, 2, 0]).result, [4, 2, 0, 0]);

// 4) 합칠 게 없으면 moved=false
eq('변화 없음', slideIndices([2, 4, 8, 16]).moved, false);
eq('이미 정렬+합칠것없음 moved', slideIndices([2, 0, 0, 0]).moved, false);

// 5) 이동 정보: 2 2 → 두 from이 같은 to(0), survivor 하나
const m = slideIndices([2, 2, 0, 0]);
ok('moves 2개', m.moves.length === 2);
ok('둘 다 to=0', m.moves.every(x => x.to === 0));
ok('survivor 정확히 1', m.moves.filter(x => x.survivor).length === 1);
ok('survivor가 첫칸', m.moves.find(x => x.survivor).from === 0);

// 6) move() 방향 — 왼쪽
eq('보드 왼쪽 이동', move([
  [2, 2, 0, 0],
  [0, 4, 4, 0],
  [0, 0, 0, 0],
  [8, 0, 8, 0],
], 'left').board, [
  [4, 0, 0, 0],
  [8, 0, 0, 0],
  [0, 0, 0, 0],
  [16, 0, 0, 0],
]);

// 7) move() 오른쪽 — 같은 보드가 오른쪽으로
eq('보드 오른쪽 이동', move([
  [2, 2, 0, 0],
  [0, 4, 4, 0],
  [0, 0, 0, 0],
  [8, 0, 8, 0],
], 'right').board, [
  [0, 0, 0, 4],
  [0, 0, 0, 8],
  [0, 0, 0, 0],
  [0, 0, 0, 16],
]);

// 8) move() 위/아래
eq('보드 위 이동', move([
  [2, 0, 0, 0],
  [2, 0, 0, 0],
  [4, 0, 0, 0],
  [4, 0, 0, 0],
], 'up').board, [
  [4, 0, 0, 0],
  [8, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
]);
eq('보드 아래 이동', move([
  [2, 0, 0, 0],
  [2, 0, 0, 0],
  [4, 0, 0, 0],
  [4, 0, 0, 0],
], 'down').board, [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [4, 0, 0, 0],
  [8, 0, 0, 0],
]);

// 9) 변화 없는 이동은 moved=false
eq('막힌 이동', move([
  [2, 4, 2, 4],
  [4, 2, 4, 2],
  [2, 4, 2, 4],
  [4, 2, 4, 2],
], 'left').moved, false);

// 10) hasMoves
ok('빈칸 있으면 가능', hasMoves([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 0]]));
ok('인접 같은값 가능', hasMoves([[2, 2, 8, 16], [4, 8, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]));
ok('꽉차고 합칠것 없으면 불가', !hasMoves([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]));

// 11) emptyCells / maxTile
eq('빈칸 수', emptyCells([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 4]]).length, 14);
eq('최대 타일', maxTile([[2, 4, 8, 16], [32, 64, 128, 256], [512, 1024, 2048, 2], [4, 8, 16, 32]]), 2048);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
