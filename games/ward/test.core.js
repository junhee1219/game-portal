/* ward 코어 로직 유닛/시뮬 검증. `node test.core.js` */
var W = require('./ward.core.js');
var pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; } else { fail++; console.log('  FAIL:', msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + a + ', want ' + b + ')'); }

// 헬퍼: 최소 상태를 손으로 구성
function blank() {
  var s = W.makeInitialState(1);
  s.bugs = [];
  s.robots = [];
  s.wave = 99; // 스폰 스크립트 개입 방지용 (직접 세팅 테스트)
  return s;
}

console.log('== 1. 밀치기: 벌레를 물로 처넣기 ==');
{
  var s = blank();
  // 물 (1,1). 벌레(2,1)를 W로 밀면 (1,1) 물 → 익사.
  s.bugs.push({ id: 100, c: 2, r: 1, dir: 'S' });
  var sim = W.simulatePush(s, 2, 1, 'W');
  ok(sim.moved, 'push moved');
  eq(sim.drownIds.length, 1, 'one bug drowns into water');
  eq(sim.drownIds[0], 100, 'correct bug id drowns');
}

console.log('== 2. 연쇄 밀치기: 벌레→벌레→물 ==');
{
  var s = blank();
  // (0,2)=물. 벌레 두 마리 (2,2)? 건물. 열을 바꿔서: (0,4)빈,(0,3)?
  // 물 위치 확인: TERRAIN row2/row3 col0 = '~'. (0,2)(0,3) 물.
  // 벌레 A(2,2 는 건물) 안됨. 다른 물 없는 열 필요. 상단 물 (2,0)(3,0).
  // 벌레 A(2,1), B(2,... ) 위로 밀어 (2,0)=물. B가 A 아래(2,2 건물)... 안됨.
  // col1은 물 없음. 좌측 물 col0 (0,2)(0,3): 벌레 A(1,2) B(2,2건물)불가.
  // → 벌레 A(1,3) B(2,3 건물)불가. 건물 회피 위해 hp0 처리.
  // 물 (1,1). 벌레 A(2,1) B(3,1). 로봇이 뒤(동쪽)에서 W로 밀면 줄=[B,A], 앞=(1,1)물.
  // 앞 벌레 A 익사, 뒤 벌레 B 전진. (벌레→벌레→물 연쇄)
  s.bugs.push({ id: 100, c: 2, r: 1, dir: 'S' }); // A 앞(물에 가까움)
  s.bugs.push({ id: 101, c: 3, r: 1, dir: 'S' }); // B 뒤(로봇이 미는 쪽)
  var sim = W.simulatePush(s, 3, 1, 'W'); // 줄=[101,100], 앞=(1,1)물
  eq(sim.drownIds.length, 1, 'chain: exactly one drowns (front)');
  eq(sim.drownIds[0], 100, 'front-most bug drowns');
  eq(sim.moves.length, 1, 'one survivor shifts');
  var m101 = sim.moves.filter(function (m) { return m.id === 101; })[0];
  eq(m101.toC, 2, '101 shifts into vacated col2');
}

console.log('== 3. 막힘: 앞이 벽/건물이면 아무도 안 움직임 ==');
{
  var s = blank();
  // 벌레(4,2), E로 밀면 앞 (5,2)=물 → 익사. 대신 건물 방향 테스트: 벌레(1,2) E로 → (2,2)건물 → 막힘
  s.bugs.push({ id: 100, c: 1, r: 2, dir: 'S' });
  var sim = W.simulatePush(s, 1, 2, 'E'); // 앞 (2,2)=건물
  ok(!sim.moved, 'push into building is jammed');
}

console.log('== 4. 예고 == 실제 (computeResolution 공유) ==');
{
  // 랜덤 상태를 여러 개 만들어, computeResolution의 예측과 endTurn 적용 결과가 일치하는지.
  var mismatches = 0, trials = 400;
  for (var t = 0; t < trials; t++) {
    var s = W.makeInitialState(1000 + t);
    // 웨이브 몇 번 진행시켜 다양한 배치 확보
    var steps = t % 6;
    for (var k = 0; k < steps && !s.gameover; k++) {
      // 무작위로 로봇 하나 이동/밀치기 살짝 섞고 endTurn — 여기선 예고검증만이므로
      W.endTurn(s);
    }
    if (s.gameover) continue;
    var res = W.computeResolution(s);
    // 예측 스냅샷
    var before = JSON.parse(W.snapshot(s));
    var predBuildingHp = {};
    before.buildings.forEach(function (b) { predBuildingHp[b.c + ',' + b.r] = b.hp; });
    res.buildingHits.forEach(function (h) { predBuildingHp[h.c + ',' + h.r] -= 1; });
    // 이미 파괴된 건물은 더 못 맞는다(hp는 0 밑으로 안 내려감) — endTurn 의미와 일치
    Object.keys(predBuildingHp).forEach(function (k) { if (predBuildingHp[k] < 0) predBuildingHp[k] = 0; });
    var predRobotDead = {}; res.robotHitIds.forEach(function (id) { predRobotDead[id] = true; });
    var predBugDead = {}; res.bugDeathIds.forEach(function (id) { predBugDead[id] = true; });
    var predPos = {};
    res.bug.forEach(function (a) {
      if (predBugDead[a.id]) return;
      predPos[a.id] = a.toC + ',' + a.toR;
    });
    // 실제 적용
    var r2 = W.endTurn(s);
    // 검증: 건물 hp
    var mism = false;
    s.buildings.forEach(function (b) {
      if (b.hp !== predBuildingHp[b.c + ',' + b.r]) mism = true;
    });
    // 죽은 벌레는 사라졌나 / 산 벌레 위치 일치 (스폰된 새 벌레는 id>= before.nextBugId 라 제외)
    var beforeIds = {}; before.bugs.forEach(function (b) { beforeIds[b.id] = true; });
    res.bugDeathIds.forEach(function (id) {
      if (s.bugs.some(function (b) { return b.id === id; })) mism = true; // 죽었어야 하는데 살아있음
    });
    res.bug.forEach(function (a) {
      if (predBugDead[a.id]) return;
      var b = s.bugs.filter(function (x) { return x.id === a.id; })[0];
      if (b && (b.c + ',' + b.r) !== predPos[a.id]) mism = true;
    });
    // 로봇
    res.robotHitIds.forEach(function (id) {
      if (s.robots.some(function (rb) { return rb.id === id; })) mism = true;
    });
    if (mism) mismatches++;
  }
  eq(mismatches, 0, 'preview matches actual over ' + trials + ' random states');
}

console.log('== 5. 서로 부딪힘: 마주보는 벌레 둘 다 죽음 ==');
{
  var s = blank();
  s.buildings.forEach(function (b) { b.hp = 0; });
  s.bugs.push({ id: 100, c: 2, r: 1, dir: 'S' }); // 아래 봄 → (2,2)
  s.bugs.push({ id: 101, c: 2, r: 2, dir: 'N' }); // 위 봄 → (2,1)
  var res = W.computeResolution(s);
  eq(res.bugDeathIds.length, 2, 'both bugs die (mutual smash)');
}

console.log('== 6. 벌레 step 전진, 건물 도달 시 smash ==');
{
  var s = blank();
  s.bugs = [{ id: 100, c: 2, r: 0, dir: 'S' }]; // front (2,1) 빈 → step
  var res = W.computeResolution(s);
  eq(res.bug[0].kind, 'step', 'far bug steps forward');
  eq(res.bug[0].toR, 1, 'stepped to r1');
  // 건물 인접
  var s2 = blank();
  s2.bugs = [{ id: 100, c: 2, r: 1, dir: 'S' }]; // front (2,2)=건물 → smash
  var res2 = W.computeResolution(s2);
  eq(res2.bug[0].kind, 'smash', 'adjacent bug smashes building');
  eq(res2.buildingHits.length, 1, 'one building hit');
}

console.log('== 7. undo 스냅샷 왕복 ==');
{
  var s = W.makeInitialState(5);
  var snap = W.snapshot(s);
  W.applyPush(s, 3, 1, 'W'); // 웨이브1 벌레(3,1) 밀기
  W.endTurn(s);
  var restored = W.restore(snap);
  eq(restored.wave, 1, 'restored to wave 1');
  eq(restored.bugs.length, 1, 'restored bug count');
}

console.log('== 8. 억울한 실패 없음 / 결정 압박: 브루트포스 최적 손실 ==');
// 각 로봇의 이번 턴 가능한 (이동, 밀치기) 조합 전체를 탐색해, 이번 턴 건물 피해를 최소화.
function enumRobotPlans(s, robot) {
  // 반환: [{move:{c,r}|null, push:{c,r,dir}|null}]  (그 로봇 한 기의 선택지)
  var plans = [{ move: null, push: null }]; // 아무것도 안 함
  var spots = [{ c: robot.c, r: robot.r, dist: 0 }].concat(W.reachable(s, robot.id));
  spots.forEach(function (sp) {
    // 이 위치로 이동했다고 가정한 임시 상태에서 밀치기 옵션
    var tmp = W.restore(W.snapshot(s));
    var rb = tmp.robots.filter(function (x) { return x.id === robot.id; })[0];
    rb.c = sp.c; rb.r = sp.r;
    var moveObj = (sp.dist === 0) ? null : { c: sp.c, r: sp.r };
    plans.push({ move: moveObj, push: null }); // 이동만
    var opts = W.pushOptions(tmp, robot.id);
    opts.forEach(function (o) {
      plans.push({ move: moveObj, push: { c: o.bug.c, r: o.bug.r, dir: o.dir } });
    });
  });
  return plans;
}
function applyPlan(s, robotId, plan) {
  if (plan.move) W.moveRobot(s, robotId, plan.move.c, plan.move.r);
  if (plan.push) W.applyPush(s, plan.push.c, plan.push.r, plan.push.dir);
}
function minBuildingLossThisTurn(s0) {
  // 2기 가정(초기). 로봇 순서대로 모든 조합 탐색.
  var best = Infinity, bestState = null;
  var robots = s0.robots.map(function (r) { return r.id; });
  function rec(state, idx) {
    if (idx === robots.length) {
      var res = W.computeResolution(state);
      var loss = 0;
      var hpmap = {};
      state.buildings.forEach(function (b) { hpmap[b.c + ',' + b.r] = b.hp; });
      res.buildingHits.forEach(function (h) {
        hpmap[h.c + ',' + h.r] -= 1;
      });
      // 이번 턴 파괴되는 건물 수
      state.buildings.forEach(function (b) {
        if (b.hp > 0 && hpmap[b.c + ',' + b.r] <= 0) loss++;
      });
      // 건물 총 피해량(hp 손실)로 측정
      var dmg = res.buildingHits.length;
      if (dmg < best) { best = dmg; bestState = W.snapshot(state); }
      return;
    }
    var rid = robots[idx];
    var rb = state.robots.filter(function (x) { return x.id === rid; })[0];
    if (!rb) { rec(state, idx + 1); return; }
    var plans = enumRobotPlans(state, rb);
    for (var p = 0; p < plans.length; p++) {
      var next = W.restore(W.snapshot(state));
      applyPlan(next, rid, plans[p]);
      rec(next, idx + 1);
    }
  }
  rec(W.restore(W.snapshot(s0)), 0);
  return best;
}

{
  // 웨이브1: 손실 0 가능해야
  var s1 = W.makeInitialState(1);
  eq(s1.wave, 1, 'starts wave 1');
  eq(s1.bugs.length, 1, 'wave1 has 1 bug');
  var loss1 = minBuildingLossThisTurn(s1);
  eq(loss1, 0, 'wave1: fully defendable (0 building damage)');

  // 웨이브2 배치 만들기: endTurn 없이 직접 wave=2 스폰
  var s2 = W.makeInitialState(1);
  // 웨이브1 완벽 방어 후 진행
  // 최적수 재현이 복잡하니, 직접 wave2 배치 구성
  s2.bugs = []; s2.wave = 2; W.spawnWave(s2);
  eq(s2.bugs.length, 2, 'wave2 has 2 bugs');
  var loss2 = minBuildingLossThisTurn(s2);
  eq(loss2, 0, 'wave2: fully defendable (0 building damage) with 2 robots');

  // 웨이브3: 3위협 > 2로봇 → 최소 손실 >= 1 (다 못 막음 = 결정 압박)
  var s3 = W.makeInitialState(1);
  s3.bugs = []; s3.wave = 3; W.spawnWave(s3);
  eq(s3.bugs.length, 3, 'wave3 has 3 bugs');
  var loss3 = minBuildingLossThisTurn(s3);
  ok(loss3 >= 1, 'wave3: cannot save everything (>=1 dmg) — forced choice');
  ok(loss3 <= 1, 'wave3: but only lose the minimum (<=1) — not a wipe, 억울X (got ' + loss3 + ')');
}

console.log('== 9. 장기 생존 시뮬(그리디 방어) — 완전 무기력하지 않은가 ==');
{
  // 그리디: 매 턴 건물 피해를 가장 줄이는 로봇 조합 선택. 몇 웨이브 버티나.
  function greedyRun(seed) {
    var s = W.makeInitialState(seed);
    var guard = 0;
    while (!s.gameover && guard < 40) {
      // 최적(브루트) 조합 찾아 적용
      var robots = s.robots.map(function (r) { return r.id; });
      var bestDmg = Infinity, bestSeq = null;
      function rec(state, idx, seq) {
        if (idx === robots.length) {
          var res = W.computeResolution(state);
          if (res.buildingHits.length < bestDmg) { bestDmg = res.buildingHits.length; bestSeq = seq.slice(); }
          return;
        }
        var rid = robots[idx];
        var rb = state.robots.filter(function (x) { return x.id === rid; })[0];
        if (!rb) { rec(state, idx + 1, seq); return; }
        var plans = enumRobotPlans(state, rb);
        for (var p = 0; p < plans.length; p++) {
          var next = W.restore(W.snapshot(state));
          applyPlan(next, rid, plans[p]);
          rec(next, idx + 1, seq.concat([{ rid: rid, plan: plans[p] }]));
        }
      }
      rec(W.restore(W.snapshot(s)), 0, []);
      if (bestSeq) bestSeq.forEach(function (step) { applyPlan(s, step.rid, step.plan); });
      W.endTurn(s);
      guard++;
    }
    return s.wave;
  }
  var waves = [];
  for (var seed = 1; seed <= 5; seed++) waves.push(greedyRun(seed));
  var avg = waves.reduce(function (a, b) { return a + b; }, 0) / waves.length;
  console.log('  greedy 생존 웨이브:', waves.join(','), 'avg', avg.toFixed(1));
  ok(avg >= 3, 'greedy 방어로 평균 3웨이브 이상 (즉사 아님)');
  ok(avg <= 30, 'greedy 방어가 무한은 아님 (긴장 유지)');
}

console.log('\n결과: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
