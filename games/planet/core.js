// 행성 키우기 — 순수 로직 (DOM 없음, `node test.js`로 검증 가능)
// 방치형 성장: 톡 깨워 생명을 모으고, 생성기를 사서 초당 생명을 늘리고,
// 누적 생명(totalEver)이 임계를 넘으면 행성이 다음 단계로 진화한다.
// 단계(stage)가 리더보드 기록 단위. 마지막 명명 단계 이후엔 공식으로 무한 진행.
(function (root) {
  'use strict';

  // 자동 생성기 — 행성이 자라며 등장하는 생명/문명. 각자 초당 생명(rate) 생산.
  // base = 0개 보유 시 가격. 가격은 보유 1개마다 ×COST_MUL.
  var GENERATORS = [
    { key: 'microbe', name: '미생물',   base: 15,         rate: 0.3 },
    { key: 'moss',    name: '이끼',     base: 130,        rate: 1.6 },
    { key: 'bug',     name: '곤충',     base: 1500,       rate: 9 },
    { key: 'tree',    name: '나무',     base: 18000,      rate: 55 },
    { key: 'beast',   name: '들짐승',   base: 230000,     rate: 320 },
    { key: 'tribe',   name: '부족',     base: 3200000,    rate: 2000 },
    { key: 'city',    name: '도시',     base: 48000000,   rate: 14000 },
    { key: 'orbit',   name: '궤도도시', base: 760000000,  rate: 95000 }
  ];
  var COST_MUL = 1.15;

  // 진화 단계 — 누적 생명(totalEver) 임계. 숫자를 가려도 서사가 보이게 이름/설명을 붙인다.
  var STAGES = [
    { min: 0,          name: '먼지',      desc: '우주를 떠도는 작은 먼지 한 줌' },
    { min: 40,         name: '암석',      desc: '먼지가 뭉쳐 단단한 바위가 됐어요' },
    { min: 400,        name: '바다',      desc: '표면에 물이 고여 첫 바다가 생겼어요' },
    { min: 3000,       name: '이끼 행성', desc: '축축한 바위에 초록 이끼가 번져요' },
    { min: 22000,      name: '숲',        desc: '키 큰 나무들이 숲을 이뤘어요' },
    { min: 160000,     name: '야생',      desc: '들짐승이 뛰노는 생명의 땅' },
    { min: 1200000,    name: '부족',      desc: '첫 모닥불 — 사람들이 모여 살아요' },
    { min: 9000000,    name: '도시',      desc: '밤에도 꺼지지 않는 불빛의 도시' },
    { min: 70000000,   name: '문명',      desc: '행성 전체를 잇는 거대 문명' },
    { min: 550000000,  name: '궤도 문명', desc: '궤도에 도시를 띄운 별의 문명' },
    { min: 4500000000, name: '빛의 행성', desc: '스스로 빛나기 시작한 행성' },
    { min: 45000000000, name: '항성',     desc: '작은 별로 타오르는 행성' }
  ];
  var TAIL_MUL = 7; // 마지막 명명 단계 이후 단계마다 임계 ×7 (무한 진행)

  // 보유 owned개일 때 1개 더 살 가격
  function cost(base, owned) { return Math.ceil(base * Math.pow(COST_MUL, owned || 0)); }

  // owned: GENERATORS와 같은 길이의 보유 수 배열 → 초당 총 생산
  function prodPerSec(owned) {
    var s = 0;
    for (var i = 0; i < GENERATORS.length; i++) s += (owned[i] || 0) * GENERATORS[i].rate;
    return s;
  }

  // 톡 1회당 생명 — 초반엔 1, 생산이 커지면 초당 생산의 일부를 따라 커져 끝까지 의미있게.
  function tapGain(perSec) { return 1 + perSec * 0.10; }

  // 누적 생명 → 단계 인덱스 (꼬리 공식 포함, 항상 증가)
  function stageForTotal(total) {
    var idx = 0;
    for (var i = 0; i < STAGES.length; i++) { if (total >= STAGES[i].min) idx = i; else break; }
    if (idx < STAGES.length - 1) return idx;
    var k = 0, threshold = STAGES[STAGES.length - 1].min * TAIL_MUL;
    while (total >= threshold) { k++; threshold *= TAIL_MUL; }
    return STAGES.length - 1 + k;
  }

  // 단계 인덱스 → {min,name,desc} (명명 범위 밖이면 공식 생성)
  function stageInfo(stageIdx) {
    if (stageIdx < STAGES.length) return STAGES[stageIdx];
    var extra = stageIdx - (STAGES.length - 1);
    var last = STAGES[STAGES.length - 1];
    return { min: last.min * Math.pow(TAIL_MUL, extra), name: '항성계 +' + extra, desc: '끝없이 확장되는 별들의 세계' };
  }

  function nextStageMin(stageIdx) { return stageInfo(stageIdx + 1).min; }

  // 다음 단계까지 진행률 0..1
  function stageProgress(total, stageIdx) {
    var cur = stageInfo(stageIdx).min, nxt = nextStageMin(stageIdx);
    if (nxt <= cur) return 1;
    var p = (total - cur) / (nxt - cur);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }

  // 자리 비운 동안의 생산 (capSec 상한, 기본 8시간)
  function offlineGain(perSec, elapsedSec, capSec) {
    var e = Math.max(0, Math.min(elapsedSec, capSec == null ? 28800 : capSec));
    return perSec * e;
  }

  // 큰 숫자 축약 표기: 1.2K, 3.40M, 12B ...
  function formatNum(n) {
    n = Number(n) || 0;
    if (n < 0) n = 0;
    if (n < 1000) return (n < 10 && n % 1 !== 0) ? n.toFixed(1) : String(Math.floor(n));
    var units = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae'];
    var u = 0;
    while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
    var s = n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : String(Math.floor(n));
    return s + units[u];
  }

  var api = {
    GENERATORS: GENERATORS, STAGES: STAGES, COST_MUL: COST_MUL, TAIL_MUL: TAIL_MUL,
    cost: cost, prodPerSec: prodPerSec, tapGain: tapGain,
    stageForTotal: stageForTotal, stageInfo: stageInfo, nextStageMin: nextStageMin,
    stageProgress: stageProgress, offlineGain: offlineGain, formatNum: formatNum
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlanetCore = api;
})(typeof self !== 'undefined' ? self : this);
