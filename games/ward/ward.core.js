/* ward — 동네 지킴이 : 순수 게임 로직 (DOM/렌더 없음).
 *
 * 완전정보 턴제 전술. 벌레의 "다음 수"는 예고(telegraph)로 전부 공개된다.
 * 예고와 실제 결과가 절대 어긋나지 않도록, 예고 그리기와 적 페이즈 실행이
 * 똑같은 순수 함수 computeResolution() 을 공유한다. (완전정보 신뢰의 핵심)
 *
 * 브라우저: <script src="ward.core.js"> 로 전역 WardCore 사용.
 * node    : require('./ward.core.js') 로 유닛 테스트.
 */
(function (root) {
  'use strict';

  // 방향
  var DIRS = {
    N: { dc: 0, dr: -1 },
    S: { dc: 0, dr: 1 },
    E: { dc: 1, dr: 0 },
    W: { dc: -1, dr: 0 }
  };
  var DIR_KEYS = ['N', 'E', 'S', 'W'];

  // 지형 코드 (정적 타일)
  // '.' 빈 땅 / '~' 물 / 'o' 구덩이 / '#' 건물자리(건물은 buildings 배열로 별도 관리)
  var T_EMPTY = 0, T_WATER = 1, T_PIT = 2;

  function isHazardTerrain(t) { return t === T_WATER || t === T_PIT; }

  // ---- 시드 PRNG (재현 가능한 스폰) ----
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- 초기 지형 (6x6) ----
  // 중앙 2x2 마을. 양옆/위에 물, 아래에 구덩이 → 밀어서 처넣을 곳.
  // 중앙 2x2 마을. 네 모서리 방향 접근로마다 물/구덩이 웅덩이 → 옆으로 밀어 처넣는다.
  var TERRAIN_MAP = [
    '......',
    '.~..~.',
    '..##..',
    '..##..',
    '.o..o.',
    '......'
  ];
  var BUILDING_TILES = [[2, 2], [3, 2], [2, 3], [3, 3]];
  var W = 6, H = 6;

  function parseTerrain() {
    var g = [];
    for (var r = 0; r < H; r++) {
      var row = [];
      for (var c = 0; c < W; c++) {
        var ch = TERRAIN_MAP[r][c];
        row.push(ch === '~' ? T_WATER : ch === 'o' ? T_PIT : T_EMPTY);
      }
      g.push(row);
    }
    return g;
  }

  function inBounds(c, r) { return c >= 0 && c < W && r >= 0 && r < H; }

  function makeInitialState(seed) {
    var s = {
      w: W, h: H,
      terrain: parseTerrain(),
      buildings: BUILDING_TILES.map(function (b) { return { c: b[0], r: b[1], hp: 2 }; }),
      robots: [
        { id: 1, c: 2, r: 0, acted: false },
        { id: 4, c: 3, r: 5, acted: false }
      ],
      bugs: [],
      wave: 1,
      turn: 1,
      nextBugId: 100,
      seed: (seed == null ? 12345 : seed) >>> 0,
      gameover: false,
      lostBuildings: 0,
      lostRobots: 0
    };
    spawnWave(s); // 웨이브 1 스폰
    return s;
  }

  // ---- 점유 조회 ----
  function terrainAt(s, c, r) {
    if (!inBounds(c, r)) return 'wall';
    return s.terrain[r][c]; // 0/1/2
  }
  function buildingAt(s, c, r) {
    for (var i = 0; i < s.buildings.length; i++) {
      if (s.buildings[i].c === c && s.buildings[i].r === r && s.buildings[i].hp > 0) return s.buildings[i];
    }
    return null;
  }
  function robotAt(s, c, r) {
    for (var i = 0; i < s.robots.length; i++) {
      if (s.robots[i].c === c && s.robots[i].r === r) return s.robots[i];
    }
    return null;
  }
  function bugAt(s, c, r) {
    for (var i = 0; i < s.bugs.length; i++) {
      if (s.bugs[i].c === c && s.bugs[i].r === r) return s.bugs[i];
    }
    return null;
  }
  // 이동/밀치기 관점에서 "막힌" 칸인가 (벽/건물/로봇). 물/구덩이는 지형 별도 처리.
  function isSolid(s, c, r) {
    if (!inBounds(c, r)) return true;
    if (buildingAt(s, c, r)) return true;
    if (robotAt(s, c, r)) return true;
    return false;
  }
  function isEmptyGround(s, c, r) {
    if (!inBounds(c, r)) return false;
    if (terrainAt(s, c, r) !== T_EMPTY) return false;
    if (buildingAt(s, c, r) || robotAt(s, c, r) || bugAt(s, c, r)) return false;
    return true;
  }

  // ---------------------------------------------------------------------------
  // 핵심: 적 페이즈 결과 계산 (순수). 예고와 실행이 이 함수를 공유한다.
  //  반환: { bug: [{id,kind,fromC,fromR,toC,toR,dir,killed}],
  //          buildingHits: [{c,r}], robotHits: [{id}], bugDeaths: [id...] }
  //  kind: 'smash'(건물) | 'smashRobot' | 'smashBug' | 'step' | 'hold' | 'killed'
  // ---------------------------------------------------------------------------
  function computeResolution(s) {
    var bugs = s.bugs;
    var out = [];
    var buildingHits = [];
    var robotHits = {};
    var bugDeaths = {}; // id -> true

    // pass1: 원본 보드 기준으로 각 벌레 의도 산출
    for (var i = 0; i < bugs.length; i++) {
      var b = bugs[i];
      var d = DIRS[b.dir];
      var fc = b.c + d.dc, fr = b.r + d.dr; // front tile
      var act = { id: b.id, fromC: b.c, fromR: b.r, dir: b.dir, toC: b.c, toR: b.r, kind: 'hold', tc: fc, tr: fr };

      if (!inBounds(fc, fr)) {
        act.kind = 'hold';
      } else {
        var bld = buildingAt(s, fc, fr);
        var rob = robotAt(s, fc, fr);
        var obug = bugAt(s, fc, fr);
        var terr = terrainAt(s, fc, fr);
        if (bld) {
          act.kind = 'smash'; buildingHits.push({ c: fc, r: fr });
        } else if (rob) {
          act.kind = 'smashRobot'; robotHits[rob.id] = true;
        } else if (obug) {
          act.kind = 'smashBug'; bugDeaths[obug.id] = true;
        } else if (isHazardTerrain(terr)) {
          act.kind = 'hold'; // 벌레는 스스로 물/구덩이에 들어가지 않는다
        } else {
          act.kind = 'step'; act.toC = fc; act.toR = fr;
        }
      }
      out.push(act);
    }

    // pass2: step 목적지 충돌 해소 (낮은 id 우선, 밀린 쪽은 hold)
    var claimed = {};
    for (var j = 0; j < out.length; j++) {
      var a = out[j];
      if (a.kind !== 'step') continue;
      var key = a.toC + ',' + a.toR;
      if (claimed[key]) {
        // 이미 다른 벌레가 그 칸을 차지 → 못 감
        a.kind = 'hold'; a.toC = a.fromC; a.toR = a.fromR;
      } else {
        claimed[key] = true;
      }
    }

    // pass3: 이번 턴 죽는 벌레는 step 취소(제자리 죽음). smash류는 원본 기준으로 이미 발사됨.
    for (var k = 0; k < out.length; k++) {
      var e = out[k];
      if (bugDeaths[e.id]) {
        e.killed = true;
        if (e.kind === 'step') { e.toC = e.fromC; e.toR = e.fromR; }
      }
    }

    return {
      bug: out,
      buildingHits: buildingHits,
      robotHitIds: Object.keys(robotHits).map(Number),
      bugDeathIds: Object.keys(bugDeaths).map(Number)
    };
  }

  // 밀치기/이동으로 물에 빠져 죽는 것 외에, 적 페이즈에서 죽는 벌레(=서로 부딪힘) 목록
  function previewDeaths(s) { return computeResolution(s).bugDeathIds; }

  // ---------------------------------------------------------------------------
  // 로봇 행동
  // ---------------------------------------------------------------------------

  // 이동 가능 칸(BFS, 빈 땅만, range 스텝 이내). 반환: [{c,r,dist}]
  function reachable(s, robotId, range) {
    range = range == null ? 4 : range;
    var rob = s.robots.filter(function (x) { return x.id === robotId; })[0];
    if (!rob) return [];
    var seen = {};
    var start = rob.c + ',' + rob.r;
    seen[start] = 0;
    var q = [{ c: rob.c, r: rob.r, d: 0 }];
    var res = [];
    while (q.length) {
      var cur = q.shift();
      if (cur.d >= range) continue;
      for (var i = 0; i < DIR_KEYS.length; i++) {
        var dd = DIRS[DIR_KEYS[i]];
        var nc = cur.c + dd.dc, nr = cur.r + dd.dr;
        var key = nc + ',' + nr;
        if (seen[key] != null) continue;
        if (!isEmptyGround(s, nc, nr)) continue; // 빈 땅만 통과/도착
        seen[key] = cur.d + 1;
        res.push({ c: nc, r: nr, dist: cur.d + 1 });
        q.push({ c: nc, r: nr, d: cur.d + 1 });
      }
    }
    return res;
  }

  function moveRobot(s, robotId, c, r) {
    var rob = s.robots.filter(function (x) { return x.id === robotId; })[0];
    if (!rob) return false;
    var ok = reachable(s, robotId).some(function (t) { return t.c === c && t.r === r; });
    if (!ok) return false;
    rob.c = c; rob.r = r;
    return true;
  }

  // 로봇이 인접 벌레를 밀 수 있는 방향들. 반환: [{dir, bug, result}]
  //  result = preview of applyPush without mutating (drown ids / final positions)
  function pushOptions(s, robotId) {
    var rob = s.robots.filter(function (x) { return x.id === robotId; })[0];
    if (!rob) return [];
    var opts = [];
    for (var i = 0; i < DIR_KEYS.length; i++) {
      var key = DIR_KEYS[i];
      var d = DIRS[key];
      var tc = rob.c + d.dc, tr = rob.r + d.dr;
      var target = bugAt(s, tc, tr);
      if (!target) continue;
      var pre = simulatePush(s, tc, tr, key);
      if (pre.moved) opts.push({ dir: key, bug: target, drownIds: pre.drownIds });
    }
    return opts;
  }

  // 라인 밀치기 시뮬(순수, 미변경). t0=(c,r)의 벌레를 dir로 민다.
  //  연속된 벌레 줄을 통째로 1칸 민다. 줄 앞이:
  //   - 물/구덩이 → 맨 앞 벌레가 빠져 죽고 나머지가 전진
  //   - 빈 땅       → 줄 전체 전진
  //   - 그 외(벽/건물/로봇/범위밖) → 막힘(아무도 안 움직임)
  //  반환 { moved, moves:[{id,fromC,fromR,toC,toR}], drownIds:[] }
  function simulatePush(s, c, r, dir) {
    var d = DIRS[dir];
    var line = [];
    var cc = c, rr = r;
    while (true) {
      var bg = bugAt(s, cc, rr);
      if (!bg) break;
      line.push(bg);
      cc += d.dc; rr += d.dr;
    }
    if (line.length === 0) return { moved: false, moves: [], drownIds: [] };
    var frontC = cc, frontR = rr; // 줄 바로 앞 칸
    var ft = terrainAt(s, frontC, frontR);
    var moves = [], drownIds = [];
    if (ft === 'wall' || buildingAt(s, frontC, frontR) || robotAt(s, frontC, frontR)) {
      return { moved: false, moves: [], drownIds: [] }; // 막힘
    }
    if (isHazardTerrain(ft)) {
      // 맨 앞 벌레 익사, 나머지 전진
      var front = line[line.length - 1];
      drownIds.push(front.id);
      for (var i = 0; i < line.length - 1; i++) {
        var b = line[i];
        moves.push({ id: b.id, fromC: b.c, fromR: b.r, toC: b.c + d.dc, toR: b.r + d.dr });
      }
      return { moved: true, moves: moves, drownIds: drownIds };
    }
    // 빈 땅: 전체 전진
    for (var j = 0; j < line.length; j++) {
      var bb = line[j];
      moves.push({ id: bb.id, fromC: bb.c, fromR: bb.r, toC: bb.c + d.dc, toR: bb.r + d.dr });
    }
    return { moved: true, moves: moves, drownIds: drownIds };
  }

  function applyPush(s, c, r, dir) {
    var sim = simulatePush(s, c, r, dir);
    if (!sim.moved) return false;
    // 익사 제거
    sim.drownIds.forEach(function (id) { removeBug(s, id); });
    // 이동 적용
    sim.moves.forEach(function (m) {
      var b = s.bugs.filter(function (x) { return x.id === m.id; })[0];
      if (b) { b.c = m.toC; b.r = m.toR; }
    });
    return true;
  }

  function removeBug(s, id) {
    for (var i = 0; i < s.bugs.length; i++) {
      if (s.bugs[i].id === id) { s.bugs.splice(i, 1); return; }
    }
  }

  // ---------------------------------------------------------------------------
  // 턴 종료 → 적 페이즈 실행 → 스폰 → 다음 웨이브
  // ---------------------------------------------------------------------------
  function endTurn(s) {
    var res = computeResolution(s);

    // 1) 건물 피해
    res.buildingHits.forEach(function (h) {
      var bld = buildingAt(s, h.c, h.r);
      if (bld) {
        bld.hp -= 1;
        if (bld.hp <= 0) s.lostBuildings += 1;
      }
    });
    // 2) 로봇 파괴
    res.robotHitIds.forEach(function (id) {
      for (var i = 0; i < s.robots.length; i++) {
        if (s.robots[i].id === id) { s.robots.splice(i, 1); s.lostRobots += 1; break; }
      }
    });
    // 3) 벌레 서로 죽음
    res.bugDeathIds.forEach(function (id) { removeBug(s, id); });
    // 4) step 이동 (죽지 않은 벌레만; killed 표시는 이미 toC=fromC)
    res.bug.forEach(function (a) {
      if (a.kind === 'step' && !a.killed) {
        var b = s.bugs.filter(function (x) { return x.id === a.id; })[0];
        if (b) { b.c = a.toC; b.r = a.toR; }
      }
    });

    // 패배 판정: 건물 전멸
    var alive = s.buildings.filter(function (b) { return b.hp > 0; }).length;
    if (alive === 0) { s.gameover = true; return { resolution: res, gameover: true }; }

    // 다음 웨이브
    s.wave += 1;
    s.turn += 1;
    // 마일스톤: 웨이브 5 도달 시 3번째 로봇 지원(자리 비어 있으면)
    if (s.wave === 5 && s.robots.length < 3 && isEmptyGround(s, 2, 5)) {
      s.robots.push({ id: 7, c: 2, r: 5, acted: false });
    }
    spawnWave(s);
    // 로봇 행동 초기화
    s.robots.forEach(function (rb) { rb.acted = false; });

    return { resolution: res, gameover: false };
  }

  // ---------------------------------------------------------------------------
  // 스폰: 웨이브 1~3 스크립트(온보딩 램프), 4+ 절차 생성
  // ---------------------------------------------------------------------------
  function addBug(s, c, r, dir) {
    if (!isEmptyGround(s, c, r)) return null;
    var b = { id: s.nextBugId++, c: c, r: r, dir: dir };
    s.bugs.push(b);
    return b;
  }

  function spawnWave(s) {
    var w = s.wave;
    if (w === 1) {
      // 튜토리얼: 벌레 1마리가 마을 위를 부수려 함. 옆으로 밀어 물에 처넣으면 끝.
      ensureBug(s, 3, 1, 'S');
    } else if (w === 2) {
      // 2마리(북·남 반대편) = 로봇 2기로 전부 방어 가능("이길 수 있다")
      ensureBug(s, 3, 1, 'S');
      ensureBug(s, 2, 4, 'N');
    } else if (w === 3) {
      // 3마리 > 로봇 2기 = 첫 "다 못 막는다" 결정. 어느 건물을 포기?
      ensureBug(s, 3, 1, 'S');
      ensureBug(s, 2, 4, 'N');
      ensureBug(s, 4, 2, 'W');
    } else {
      // 절차: 목표 마리수까지 가장자리에서 마을 향해 스폰
      var target = Math.min(3 + (w - 3), 7);
      var rng = mulberry32(s.seed + w * 2654435761);
      s.seed = (s.seed + 1013904223) >>> 0;
      var edges = edgeSpawnTiles(s);
      // 셔플
      for (var i = edges.length - 1; i > 0; i--) {
        var jj = Math.floor(rng() * (i + 1));
        var tmp = edges[i]; edges[i] = edges[jj]; edges[jj] = tmp;
      }
      var placed = s.bugs.length;
      for (var e = 0; e < edges.length && placed < target; e++) {
        var t = edges[e];
        var dir = faceToTown(t.c, t.r);
        if (addBug(s, t.c, t.r, dir)) placed++;
      }
    }
  }

  // 이미 그 자리에 벌레 있으면 유지, 없고 비었으면 생성
  function ensureBug(s, c, r, dir) {
    if (bugAt(s, c, r)) return;
    addBug(s, c, r, dir);
  }

  function edgeSpawnTiles(s) {
    var res = [];
    for (var c = 0; c < W; c++) {
      if (isEmptyGround(s, c, 0)) res.push({ c: c, r: 0 });
      if (isEmptyGround(s, c, H - 1)) res.push({ c: c, r: H - 1 });
    }
    for (var r = 1; r < H - 1; r++) {
      if (isEmptyGround(s, 0, r)) res.push({ c: 0, r: r });
      if (isEmptyGround(s, W - 1, r)) res.push({ c: W - 1, r: r });
    }
    return res;
  }

  // 마을 중심(2.5,2.5)을 향하는 방향(더 먼 축 우선)
  function faceToTown(c, r) {
    var dc = 2.5 - c, dr = 2.5 - r;
    if (Math.abs(dc) >= Math.abs(dr)) return dc >= 0 ? 'E' : 'W';
    return dr >= 0 ? 'S' : 'N';
  }

  // ---- undo 스냅샷 ----
  function snapshot(s) { return JSON.stringify(s); }
  function restore(str) { return JSON.parse(str); }

  function buildingsAlive(s) { return s.buildings.filter(function (b) { return b.hp > 0; }).length; }

  var API = {
    DIRS: DIRS, T_EMPTY: T_EMPTY, T_WATER: T_WATER, T_PIT: T_PIT,
    W: W, H: H,
    makeInitialState: makeInitialState,
    terrainAt: terrainAt, buildingAt: buildingAt, robotAt: robotAt, bugAt: bugAt,
    isEmptyGround: isEmptyGround, inBounds: inBounds,
    computeResolution: computeResolution, previewDeaths: previewDeaths,
    reachable: reachable, moveRobot: moveRobot,
    pushOptions: pushOptions, simulatePush: simulatePush, applyPush: applyPush,
    endTurn: endTurn, spawnWave: spawnWave, addBug: addBug,
    snapshot: snapshot, restore: restore, buildingsAlive: buildingsAlive,
    faceToTown: faceToTown
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.WardCore = API;
})(typeof window !== 'undefined' ? window : globalThis);
