// 행성 키우기 — core.js 순수 로직 검증 (node test.js)
var C = require('./core.js');
var fail = 0;
function ok(name, cond) { if (!cond) { console.error('FAIL: ' + name); fail++; } else console.log('ok  : ' + name); }
function approx(a, b) { return Math.abs(a - b) < 1e-6; }

// 가격 스케일
ok('cost(15,0)=15', C.cost(15, 0) === 15);
ok('cost grows by 1.15', C.cost(100, 1) === Math.ceil(100 * 1.15));
ok('cost monotonic', C.cost(15, 5) > C.cost(15, 4));

// 생산 합
ok('prod empty=0', C.prodPerSec([0, 0, 0, 0, 0, 0, 0, 0]) === 0);
ok('prod sums rates', approx(C.prodPerSec([2, 1, 0, 0, 0, 0, 0, 0]), 2 * 0.3 + 1 * 1.6));

// 톡 이득
ok('tapGain base=1', approx(C.tapGain(0), 1));
ok('tapGain scales', C.tapGain(1000) > C.tapGain(0));

// 단계 경계
ok('stage 0 at 0', C.stageForTotal(0) === 0);
ok('stage 1 at 40', C.stageForTotal(40) === 1);
ok('stage 1 just below 400', C.stageForTotal(399) === 1);
ok('stage 2 at 400', C.stageForTotal(400) === 2);
ok('stage monotonic non-decreasing', (function () {
  var prev = -1, t = 1;
  for (var i = 0; i < 60; i++) { var s = C.stageForTotal(t); if (s < prev) return false; prev = s; t *= 3; }
  return true;
})());
// 마지막 명명 단계 이후 무한 진행
var lastNamed = C.STAGES.length - 1;
ok('tail stage advances', C.stageForTotal(C.STAGES[lastNamed].min * C.TAIL_MUL) === lastNamed + 1);
ok('tail stage advances x2', C.stageForTotal(C.STAGES[lastNamed].min * C.TAIL_MUL * C.TAIL_MUL) === lastNamed + 2);

// stageInfo / next
ok('stageInfo named', C.stageInfo(0).name === '먼지');
ok('stageInfo tail name', C.stageInfo(lastNamed + 1).name === '항성계 +1');
ok('nextStageMin > cur', C.nextStageMin(0) > C.stageInfo(0).min);

// 진행률
ok('progress 0..1', C.stageProgress(0, 0) >= 0 && C.stageProgress(0, 0) <= 1);
ok('progress mid ~0.5', (function () { var p = C.stageProgress((0 + 40) / 2, 0); return p > 0.4 && p < 0.6; })());
ok('progress clamps high', C.stageProgress(1e18, 0) <= 1);

// 오프라인 이득 (상한)
ok('offline linear', approx(C.offlineGain(10, 100, 99999), 1000));
ok('offline capped', C.offlineGain(10, 1e9, 28800) === 10 * 28800);
ok('offline neg elapsed=0', C.offlineGain(10, -5, 28800) === 0);

// 숫자 포맷
ok('fmt 0', C.formatNum(0) === '0');
ok('fmt 999', C.formatNum(999) === '999');
ok('fmt 1.2K', C.formatNum(1200) === '1.20K');
ok('fmt M', /M$/.test(C.formatNum(2500000)));
ok('fmt B', /B$/.test(C.formatNum(3.4e9)));

if (fail) { console.error('\n' + fail + ' test(s) failed'); process.exit(1); }
console.log('\nall passed');
