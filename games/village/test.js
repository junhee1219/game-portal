// 오순도순 마을 코어 검증 — `node test.js`
var C = require('./core.js');
var fail = 0;
function ok(name, cond) { if (!cond) { console.error('  ✗ ' + name); fail++; } else console.log('  ✓ ' + name); }
function board() { return new Map(); }
function put(b, x, y, t) { return C.place(b, x, y, t); }

// 격자 안의 빈 칸이면 어디든 둘 수 있다(인접 제약 없음). 격자 밖·이미 찬 칸은 불가.
(function () {
  var b = board();
  ok('빈 격자 안은 어디든 둔다', C.isPlaceable(b, 0, 0) && C.isPlaceable(b, 3, 4));
  ok('격자 밖은 못 둔다', !C.isPlaceable(b, -1, 0) && !C.isPlaceable(b, C.GRID, 0));
  put(b, 2, 2, 'house');
  ok('이미 찬 칸은 못 둔다', !C.isPlaceable(b, 2, 2));
  ok('떨어진 빈 칸도 둘 수 있다', C.isPlaceable(b, 5, 5));
})();

// 가득 참 / 남은 칸.
(function () {
  var b = board();
  ok('처음 남은 칸 = GRID^2', C.cellsLeft(b) === C.GRID * C.GRID);
  put(b, 0, 0, 'forest');
  ok('한 칸 두면 남은 칸 −1', C.cellsLeft(b) === C.GRID * C.GRID - 1);
  ok('아직 안 참', !C.isFull(b));
})();

// 집은 자연에 둘러싸일수록 점수가 오른다.
(function () {
  var b = board();
  put(b, 2, 2, 'house');
  var lone = C.tileScore('house', C.neighborCounts(b, 2, 2));
  put(b, 3, 2, 'forest');
  var withTree = C.tileScore('house', C.neighborCounts(b, 2, 2));
  ok('자연 이웃이 생기면 집 점수 증가', withTree > lone);
})();

// 자연 HOME_NATURE개로 둘러싸면 집에 동물 주민 입주(연쇄 포함). HOME_NATURE 개수에 맞춰 채운다.
(function () {
  var b = board();
  var nat = ['forest', 'pond', 'flower', 'field'], spots = [[3, 2], [1, 2], [2, 1], [2, 3]];
  put(b, 2, 2, 'house');
  for (var i = 0; i < C.CFG.HOME_NATURE - 1; i++) put(b, spots[i][0], spots[i][1], nat[i]);
  ok('자연 ' + (C.CFG.HOME_NATURE - 1) + '개론 아직 미입주', b.get(C.key(2, 2)).villager !== true);
  var last = spots[C.CFG.HOME_NATURE - 1];
  var r = put(b, last[0], last[1], nat[C.CFG.HOME_NATURE - 1]);
  ok('자연 ' + C.CFG.HOME_NATURE + '개로 주민 입주', r.newlyHome.length === 1);
  ok('입주 집 좌표는 (2,2)', r.newlyHome[0].x === 2 && r.newlyHome[0].y === 2);
  ok('입주 보너스로 큰 gain', r.gain >= 6);
  ok('타일 칸이 입주 표시', b.get(C.key(2, 2)).villager === true);
})();

// 자연을 먼저 깔고 집을 끼워도 즉시 입주(같은 place 호출에서).
(function () {
  var b = board();
  var nat = ['forest', 'pond', 'flower', 'field'], spots = [[3, 2], [1, 2], [2, 1], [2, 3]];
  for (var i = 0; i < C.CFG.HOME_NATURE; i++) put(b, spots[i][0], spots[i][1], nat[i]);
  var r = put(b, 2, 2, 'house');
  ok('자연 사이에 집 넣으면 즉시 입주', r.newlyHome.length === 1 && r.tile.villager === true);
})();

// 가방: 모든 종류가 언젠가 나오고, 항상 유효 타입.
(function () {
  var seq = 1; var rng = function () { seq = (seq * 9301 + 49297) % 233280; return seq / 233280; };
  var bag = C.makeBag(rng), seen = {}, allValid = true;
  for (var i = 0; i < 400; i++) { var t = bag(); seen[t] = true; if (C.TYPES.indexOf(t) < 0) allValid = false; }
  ok('가방 타입은 항상 유효', allValid);
  ok('가방에서 모든 종류 등장', C.TYPES.every(function (t) { return seen[t]; }));
})();

// 연못은 이어질수록(강) 좋다.
(function () {
  var b1 = board(); b1.set(C.key(0, 0), { x: 0, y: 0, type: 'pond' });
  var one = C.tileScore('pond', C.neighborCounts(b1, 1, 0));
  var b2 = board(); b2.set(C.key(0, 0), { x: 0, y: 0, type: 'pond' }); b2.set(C.key(0, 1), { x: 0, y: 1, type: 'pond' });
  var two = C.tileScore('pond', C.neighborCounts(b2, 1, 0));
  ok('연못은 물끼리 이어지면 가산', two >= one);
})();

console.log(fail === 0 ? '\n✅ ALL PASS' : '\n❌ ' + fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
