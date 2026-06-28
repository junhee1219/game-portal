// 행성 키우기 — 순수 로직 (DOM 없음, `node test.js`로 검증 가능)
// 방치형 성장: 톡 깨워 생명을 모으고, 생성기를 사서 초당 생명을 늘리고,
// 누적 생명(totalEver)이 임계를 넘으면 행성이 다음 단계로 진화한다.
// 단계(stage)가 리더보드 기록 단위. 마지막 명명 단계 이후엔 공식으로 무한 진행.
(function (root) {
  'use strict';

  // 자동 생성기 — 행성이 자라며 등장하는 생명/문명. 각자 초당 생명(rate) 생산.
  // base = 0개 보유 시 가격. 가격은 보유 1개마다 ×COST_MUL.
  var GENERATORS = [
    { key: 'microbe', name: '미생물',   base: 15,            rate: 0.3 },
    { key: 'moss',    name: '이끼',     base: 130,           rate: 1.6 },
    { key: 'bug',     name: '곤충',     base: 1500,          rate: 9 },
    { key: 'tree',    name: '나무',     base: 18000,         rate: 55 },
    { key: 'beast',   name: '들짐승',   base: 230000,        rate: 320 },
    { key: 'tribe',   name: '부족',     base: 3200000,       rate: 2000 },
    { key: 'city',    name: '도시',     base: 48000000,      rate: 14000 },
    { key: 'orbit',   name: '궤도도시', base: 760000000,     rate: 95000 },
    { key: 'star',    name: '항성로',   base: 11000000000,   rate: 650000 },
    { key: 'dyson',   name: '다이슨구체', base: 170000000000, rate: 4400000 },
    { key: 'galaxy',  name: '은하문명', base: 2500000000000,  rate: 30000000 },
    { key: 'rift',    name: '차원균열', base: 38000000000000, rate: 200000000 }
  ];
  var COST_MUL = 1.15;

  // 진화 단계 — 누적 생명(totalEver) 임계. 숫자를 가려도 서사가 보이게 이름/설명을 붙인다.
  // 진화 단계 — 누적 생명(lifetime) 임계. 숫자를 가려도 서사가 보이게 이름/설명을 붙인다.
  // 행성(0~11) → 별의 죽음과 잔해(12~18) → 은하 스케일(19~27) → 우주 거대구조(28~29) → 무한(다중우주).
  // 후반일수록 임계 배율이 가팔라져(하드코어) 환생 배수 없이는 도달 못 한다.
  var STAGES = [
    { min: 0,           name: '먼지',          desc: '우주를 떠도는 작은 먼지 한 줌' },
    { min: 40,          name: '암석',          desc: '먼지가 뭉쳐 단단한 바위가 됐어요' },
    { min: 400,         name: '바다',          desc: '표면에 물이 고여 첫 바다가 생겼어요' },
    { min: 3000,        name: '이끼 행성',     desc: '축축한 바위에 초록 이끼가 번져요' },
    { min: 22000,       name: '숲',            desc: '키 큰 나무들이 숲을 이뤘어요' },
    { min: 160000,      name: '야생',          desc: '들짐승이 뛰노는 생명의 땅' },
    { min: 1200000,     name: '부족',          desc: '첫 모닥불 — 사람들이 모여 살아요' },
    { min: 9000000,     name: '도시',          desc: '밤에도 꺼지지 않는 불빛의 도시' },
    { min: 70000000,    name: '문명',          desc: '행성 전체를 잇는 거대 문명' },
    { min: 550000000,   name: '궤도 문명',     desc: '궤도에 도시를 띄운 별의 문명' },
    { min: 4500000000,  name: '빛의 행성',     desc: '스스로 빛나기 시작한 행성' },
    { min: 45000000000, name: '항성',          desc: '핵융합이 점화돼 진짜 별이 됐어요' },
    { min: 5.4e11,      name: '적색거성',      desc: '별이 부풀어 하늘을 붉게 물들여요' },
    { min: 6.5e12,      name: '초신성',        desc: '별이 폭발하며 온 우주에 빛을 뿌려요' },
    { min: 7.8e13,      name: '백색왜성',      desc: '폭발의 핵이 작고 단단한 별로 식어가요' },
    { min: 9.3e14,      name: '중성자별',      desc: '한 숟갈에 산만큼 무거운 초고밀도 별' },
    { min: 1.12e16,     name: '펄사',          desc: '회전하며 우주로 신호를 쏘는 등대별' },
    { min: 1.34e17,     name: '블랙홀',        desc: '빛조차 빠져나오지 못하는 시공의 구멍' },
    { min: 1.6e18,      name: '퀘이사',        desc: '블랙홀이 삼키며 은하보다 밝게 타올라요' },
    { min: 1.9e19,      name: '성운',          desc: '별이 태어나는 거대한 빛의 요람' },
    { min: 2.3e20,      name: '산개성단',      desc: '갓 태어난 별들이 무리 지어 반짝여요' },
    { min: 2.8e21,      name: '구상성단',      desc: '수십만 별이 공처럼 뭉친 늙은 별무리' },
    { min: 3.3e22,      name: '왜소은하',      desc: '작은 은하가 처음 형태를 갖췄어요' },
    { min: 4.0e23,      name: '나선은하',      desc: '나선팔을 두른 거대한 별의 도시' },
    { min: 4.8e24,      name: '타원은하',      desc: '은하끼리 합쳐진 거대한 별의 바다' },
    { min: 5.8e25,      name: '은하군',        desc: '여러 은하가 중력으로 모인 무리' },
    { min: 6.9e26,      name: '은하단',        desc: '수천 은하가 얽힌 우주의 대도시' },
    { min: 8.3e27,      name: '초은하단',      desc: '은하단들이 이루는 거대한 흐름' },
    { min: 1.0e29,      name: '우주 거대구조', desc: '은하들이 짠 우주의 거미줄, 필라멘트' },
    { min: 1.2e30,      name: '관측 가능한 우주', desc: '우리가 볼 수 있는 우주의 끝에 닿았어요' }
  ];
  var TAIL_MUL = 12; // 마지막 명명 단계 이후 단계마다 임계 ×12 (등비) — 무한 진행(다중우주)

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
    return { min: last.min * Math.pow(TAIL_MUL, extra), name: '다중우주 +' + extra, desc: '하나의 우주를 넘어 무수한 우주로 뻗어가요' };
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

  // ===== 초신성 환생(프레스티지) =====
  // 충분히 키운 행성을 초신성으로 터뜨려 '성운 가루(stardust)'를 얻고 리셋한다.
  // 가루는 영구 생산 배수를 줘서 다음 사이클이 훨씬 빨라진다 — 방치형 핵심 중독 루프.
  var REBIRTH_MIN = 1000000;     // 첫 환생 가능: 이번 사이클 누적 생명 ≥ 100만('부족' 단계 근처)
  var STARDUST_BONUS = 0.0015;   // 배수 계수
  var STARDUST_POW = 1.5;        // 배수 = 1 + BONUS·가루^POW (1.5승 — 무한 등속 진행의 핵심)

  // 이번 사이클 누적(cycleTotal)으로 얻는 가루. 제곱근 스케일 →
  // 오래 끌수록 한계효용이 줄어 '언제 터뜨릴까'를 고민하게 만든다.
  function stardustGain(cycleTotal) {
    if (cycleTotal < REBIRTH_MIN) return 0;
    return Math.floor(Math.sqrt(cycleTotal / REBIRTH_MIN) * 2);
  }
  function canRebirth(cycleTotal) { return cycleTotal >= REBIRTH_MIN; }
  // 보유 가루 → 생산 배수 (1.0 = 가루 없음). 가루를 1.5승으로 반영해야
  // 단계 임계(등비)를 가루 증가가 따라잡아 후반에도 정체 없이 끝없이 진행된다.
  function prestigeMult(stardust) { return 1 + (stardust > 0 ? Math.pow(stardust, STARDUST_POW) : 0) * STARDUST_BONUS; }
  // 가루 배수까지 반영한 실효 초당 생산
  function effPerSec(owned, stardust) { return prodPerSec(owned) * prestigeMult(stardust); }

  // 큰 숫자 축약 표기: 1.2K, 3.40M, 12B ...
  function formatNum(n) {
    n = Number(n) || 0;
    if (n < 0) n = 0;
    if (n < 1000) return (n < 10 && n % 1 !== 0) ? n.toFixed(1) : String(Math.floor(n));
    var units = ['', 'K', 'M', 'B', 'T', 'aa', 'ab', 'ac', 'ad', 'ae', 'af', 'ag', 'ah', 'ai', 'aj', 'ak', 'al', 'am', 'an', 'ao', 'ap', 'aq', 'ar', 'as', 'at'];
    var u = 0;
    while (n >= 1000 && u < units.length - 1) { n /= 1000; u++; }
    var s = n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : String(Math.floor(n));
    return s + units[u];
  }

  var api = {
    GENERATORS: GENERATORS, STAGES: STAGES, COST_MUL: COST_MUL, TAIL_MUL: TAIL_MUL,
    REBIRTH_MIN: REBIRTH_MIN, STARDUST_BONUS: STARDUST_BONUS,
    cost: cost, prodPerSec: prodPerSec, tapGain: tapGain,
    stageForTotal: stageForTotal, stageInfo: stageInfo, nextStageMin: nextStageMin,
    stageProgress: stageProgress, offlineGain: offlineGain, formatNum: formatNum,
    stardustGain: stardustGain, canRebirth: canRebirth, prestigeMult: prestigeMult, effPerSec: effPerSec
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PlanetCore = api;
})(typeof self !== 'undefined' ? self : this);
