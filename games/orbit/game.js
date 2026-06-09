/* 행성 합치기 (orbit) — 드롭 머지 + 블랙홀 트위스트.
   물리: matter.js. 손맛: 바운스/안정화 + 합체 팡 파티클 + 콤보 배율 + 화면 흔들림 + vibrate.
   계약: 신기록 시 localStorage.setItem('orbitBest', String(score)); orbitMuted 존중. portal.js 직접 주입 금지. */
(() => {
  'use strict';
  const { Engine, Runner, Bodies, Body, Composite, Events, Sleeping } = Matter;

  // ── 행성 단계 정의 (단색 원 + 부드러운 그라데이션, 이모지 라벨) ──
  // 명도폭 좁은 파스텔. r은 보드 폭 대비 비율(나중에 px 환산).
  // 우주 글리프: game-icons.net (CC BY 3.0), viewBox 512. g = 글리프 키.
  const TIERS = [
    { name: '운석',   rr: 0.052, c1: '#bfc6d8', c2: '#9fa8bf', g: 'meteor',     score: 1 },
    { name: '소행성', rr: 0.066, c1: '#c8b6e2', c2: '#a98fd1', g: 'asteroid',   score: 3 },
    { name: '달',     rr: 0.083, c1: '#e3e7f2', c2: '#c2cae0', g: 'moon',       score: 6 },
    { name: '화성',   rr: 0.104, c1: '#f3b89a', c2: '#e09573', g: 'planetcore', score: 10 },
    { name: '지구',   rr: 0.128, c1: '#9fd0f0', c2: '#7bb6e6', g: 'earth',      score: 16 },
    { name: '해왕성', rr: 0.156, c1: '#9fb6f0', c2: '#7d96e3', g: 'moonorbit',  score: 24 },
    { name: '천왕성', rr: 0.186, c1: '#a6e6df', c2: '#82d3c9', g: 'jupiter',    score: 34 },
    { name: '토성',   rr: 0.220, c1: '#f5d79c', c2: '#e6bd73', g: 'ringed',     score: 50, ring: true },
    { name: '목성',   rr: 0.258, c1: '#f2c2a0', c2: '#e09e76', g: 'stripedsun', score: 72 },
    { name: '태양',   rr: 0.300, c1: '#ffe1a6', c2: '#ffcf6e', g: 'sun',        score: 100, glow: true },
  ];
  const MAX_TIER = TIERS.length - 1;
  const BLACKHOLE = 'bh';

  const GLYPH_D = {
    meteor: "M107.5 18c40.728 58.21-63.708 25.914-88.03 2.47 1.058 40.082 100.03 99.633 147.374 72.124C195.904 75.71 136.984 22.936 107.5 18zm97.75 57.28l.875 1.47c120.364 99-4.023 175.247-64.97 48.78 15.823 82.506-78.425 44.2-89.655-30.655C-13.17 230.463 172.715 231.293 178.438 324c3.23 52.3-77.82 19.908-113.875-48.844C308.49 797.09 814.024 262.64 205.25 75.28zm134.97 136.376c44.577 0 85.52 18.708 109.56 52.5 43.656 75.614-63.777 27.4-70.717-8.844-21.45 58.675 101.883 114.72 16 170.375 25.962-34.188 2.345-113.552-87.875-109.125 116.512 72.473 42.326 206.9-19.688 93.157 1.306 35.083 11.99 54.83 27.156 64.436-60.89-11.955-107.03-65.528-107.03-129.906 0-39.06 16.94-74.22 43.874-98.5 1.674 61.897 83.61 37.656 115.97 62.344-11.544-60.34-56.022-59.933-82.72-84.28 16.883-7.803 35.67-12.158 55.47-12.158zM234.72 309c-1.386.015-2.724.112-4.064.25 26.032 6.737 74.684 83.827 33.875 61.75 3.41 14.6 43.038 41.75 57.5 21.156 18.816-26.79-44.374-83.634-87.31-83.156z",
    asteroid: "M252.625 36.307c-6.092.006-12.026.422-17.766 1.367-6.74 15.11-15.352 32.332-15.352 32.332l-32.752-13.453c-16.186 7.61-10.852 30.03-20.06 38.44-27.888 22.73-83.84 68.866-89.725 84.734-12.537 33.803-19.03 69.85-20.005 104.95 14.493 7.74 31.347 20.743 47.008 34.73 14.336 14.328 35.16 31.31 40.828 49.716l2.096 7.168-6.658 3.384c-11.466 5.26-9.42 16.91-11.275 25.86l-17.602-3.77c1.218-13.002 3.663-24.96 13.206-33.12-8.763-13.648-21.562-25.924-32.584-35.81-11.454-10.23-24.25-20.012-34.933-26.947 1.674 46.477 1.207 81.64 21.255 114.607l31.945 5.094-.553 28.053 42.27-3.222-5.3 30.28c92.217 38.28 247.83-57.624 288.362-162.223 8.685-22.415 48.163-45.242 49.896-67.717 2.734-35.472-8.37-70.06-27.727-100.74-13.795 13.218-29.79 17.135-46.56 9.796l20.255 23.86-13.723 11.648-27.4-32.273-1.24-18.446c-5.757-5.283-11.19-11.362-16.046-17.94l-33.95 9.97-5.073-17.27 29.023-8.522c-3.782-7.177-6.71-14.646-8.39-22.174-2.694-12.064-2.116-24.784 4.7-35.326.07-.108.145-.21.216-.317-36.018-4.868-73.49-16.754-106.387-16.718zm121.287 26.806c-3.475 5.376-4.253 12.655-2.248 21.633s6.862 19.155 13.3 28.45c6.44 9.293 14.446 17.73 22.216 23.577 23.14 12.916 41.762 7.763 39.084-16.968-1.89-16.137-17.54-29.672-23.46-35.753-12.655-12.994-38.097-34.83-48.892-20.94zm-36.207 4.266l-9.47 21.282-25.104 9.29-18.34-10.36zM233.393 96.282l30.316 11.072 27.874 46.264 32.05 14.146-7.27 16.468-37.26-16.45zm-43.89 30.66c9.625-.01 19.89 2.822 25.817 11.815 6.116 5.094 16.364 8.502 27.846 12.816l-6.332 16.852c-5.8-2.18-12.472-4.145-18.963-6.996-1.048 3.52-2.588 6.89-4.358 9.935a64.73 64.73 0 0 1-2.97 4.625c12.61 6.737 24.022 11.983 30.12 12.506l-1.54 17.934c-13.374-1.148-27.19-8.556-41.235-16.645a69.874 69.874 0 0 1-5.22 4.035c-5.618 3.903-12.543 7.623-20.044 10.5 2.925 14.92 3.148 30.108 2.94 41.203l-17.997-.337c.19-10.045-.234-23.675-2.45-36.112-5.99.925-12.046 1.06-17.944-.383-.09-.02-.177-.046-.266-.07.083 13.554-1.982 28.058-11.95 42.374l-14.77-10.285c10.87-15.612 8.98-30.818 7.804-49.224-1.566-5.005-1.475-10.304-.23-14.988 1.682-6.33 5.1-11.886 9.187-16.945 8.176-10.118 19.228-18.362 28.807-23.49 11.795-5.06 22.388-9.09 33.75-9.12zm-.665 18.012c-.64.012-1.308.047-2.004.102-7.502.613-16.64 3.695-22.588 6.88-7.375 3.946-17.25 11.444-23.3 18.93-3.023 3.743-5.045 7.453-5.79 10.254-1.15 5.08 2.084 9.024 6.29 10.087 3.02.738 7.46.737 12.396-.164 9.87-1.802 21.545-7.135 28.553-12.004 5.274-3.666 11.863-10.37 15.556-16.722 3.85-12.748.492-17.54-9.112-17.363zm259.953 37.65l12.642 62.508-54.782 40.737 33.01-56.89zm-61.31 20.75l3.182 17.717-66.13 11.883-9.65 25.186-25.25 11.934 21.725-53.04zm-11.63 64.83l16.3 7.63c-7.236 15.46-9.834 23.982-8.974 33.36 6.018.288 12.134.976 18.222 1.934l-2.796 17.78c-20.668-3.25-40.167-1.63-49.913 5.192-4.873 3.41-7.866 7.633-9.088 14.89-1.223 7.254-.21 17.796 4.873 31.997-14.763 5.31-28.485 9.344-43.684 14.436l-5.716-17.068 27.455-9.197c-1.625-8.534-1.85-16.21-.678-23.16 1.844-10.947 7.55-19.874 15.334-25.773-2.568-5.383-5.2-11.09-7.092-17.383-2.792-9.287-.37-27.64-.56-27.658 0 0 15.726 15.586 17.798 22.477 1.373 4.567 3.592 9.417 6.01 14.548 3.83-1.158 7.836-1.963 11.965-2.47-.69-12.83 3.032-25.492 10.543-41.536zm-145.416 3.946l-21.852 46.684-1.49 65.057-17.38-68.036s36.75-43.703 40.722-43.703zm38.574 139.85a84.97 84.97 0 0 1 7.69.32c13.628 1.172 27.29 5.13 40.73 9.132l-5.137 17.252c-13.297-3.96-26.01-7.494-37.134-8.45-5.48-.47-10.477-.36-15.1.508l-14.878-14.148c6.827-2.917 14.02-4.278 21.263-4.56a75.72 75.72 0 0 1 2.568-.054zm-38.95 15.075l13.983 13.3c-10.892 17.037-14.518 26.755-31.18 37.32 1.64-5.576 3.002-16.252 5.88-26.984 2.176-8.11 5.298-16.793 11.32-23.635z",
    moon: "M253.125 18.563c-131.53 0-238.375 106.813-238.375 238.343 0 131.53 106.846 238.344 238.375 238.344 131.53 0 238.344-106.815 238.344-238.344 0-131.528-106.816-238.344-238.345-238.344zm-23.938 52.093c40.517 0 77.988 12.904 108.532 34.813-5.597-.624-11.302-.97-17.064-.97-84.157 0-152.375 68.25-152.375 152.406 0 84.157 68.22 152.375 152.376 152.375 5.762 0 11.467-.313 17.063-.936-30.545 21.91-68.016 34.812-108.533 34.812-102.98 0-186.28-83.272-186.28-186.25 0-102.977 83.3-186.25 186.28-186.25z",
    earth: "M256 32c-37.764.086-74.894 9.72-107.938 28.002l27.52 19.36 40.033-13.694 24.582 5.62 8.78 49.864 15.1-11.588 41.087-14.046 18.26 27.742-35.82 18.963-22.473 16.152-2.458 22.475-24.932 21.07-7.023 34.064-14.047 1.053 7.023-38.63-53.027-2.807-12.64 18.61-.1-.01v26.644l25.824 1.986 23.838 16.885-1.986 25.328 33.77 5.96-.36.76 53.004-30.558 90.88 59.098-20.51 48.548-32.685 20.156-61.143 77.965-13.498-3.845L262.216 365l-42.213-42.213 7.853-13.86-25.732-9.482-25.326-30.79-21.853-4.967L116.422 208H112l-5.117 26.746-3.64-39.146 5.267-29.147-.7-23.178L97.247 98.2C55.516 140.12 32.06 196.847 32 256c0 123.712 100.288 224 224 224 82.413-.028 158.155-45.308 197.195-117.887L442.82 298.14l-5.62-36.17-34.06-27.392 6.67-37.926 15.803-20.367 37.555-5.05C428.766 87.086 346.913 32.072 256 32zm89.047 48H368v48l-32 16v-23.836zm-122.76 166.518l29.85 4.918-4.213 6.32-24.23-4.916z",
    planetcore: "M256 16A240 240 0 0 0 16 256a240 240 0 0 0 240 240 240 240 0 0 0 240-240A240 240 0 0 0 256 16zm-9 14.73v86.342c-35.304 2.47-124.423 31.35-127.033 129.928H37.605C39.993 81.83 189.513 34.292 247 30.73zm18 .874c.596.158 1.148.33 1.62.52 78.82 31.677 84.33 217.118 77.042 268.052l-36.498-22.813c3.486-34.36-.902-132.647-42.164-156.877V31.604zM41.258 265h85.996c19.485 15.47 77.33 34.583 166.902 25.46l37.7 23.563C163.39 333.03 61.252 291.425 41.26 265z",
    ringed: "M417.063 85.625c-35.503-.147-80.717 9.822-129.563 28.97-9.31-1.8-18.804-2.706-28.344-2.69-25.04.045-50.414 6.454-73.656 19.907-32.044 18.55-54.554 47.287-65.813 79.782-80.284 64.16-123.395 133.9-100.718 173.28 23.35 40.55 109.384 36.656 208.593-4.218 1.7-.7 3.417-1.403 5.125-2.125.622-.262 1.25-.514 1.875-.78 1.81-.765 3.62-1.554 5.437-2.344l1.563-.687c1.443-.633 2.895-1.29 4.343-1.94 19.712-8.812 39.79-19.016 59.844-30.624 15.83-9.162 30.907-18.77 45.156-28.656.394-.273.795-.54 1.188-.813.672-.465 1.33-.94 2-1.406 100.373-70.007 158.15-152.83 132.625-197.155-11.013-19.123-35.953-28.36-69.658-28.5zm-56.375 50c24.466-.44 42.61 5.846 50.437 19.438 8.373 14.54 3.594 35.145-11.22 57.937-3.086-9.146-7.093-18.13-12.092-26.813-11.72-20.35-27.54-36.846-45.782-49.093 6.543-.87 12.788-1.364 18.658-1.47zM111.75 269.905c1.397 22.12 7.76 44.257 19.563 64.75 5.088 8.838 10.948 16.957 17.437 24.314-27.663 1.7-48.293-4.418-56.78-19.158-9.82-17.05-1.558-42.433 19.78-69.906zm291.22 27.658c-25.755 21.322-55.33 41.912-87.876 60.75-31.97 18.504-63.966 33.663-94.75 45.28 36.843 10.142 77.578 6.073 113.28-14.593 35.833-20.74 59.75-54.215 69.345-91.438z",
    jupiter: "M256.175 32A224 224 0 0 0 156.11 55.68h199.71A224 224 0 0 0 256.174 32zM104.247 91.68a224 224 0 0 0-30.668 34.84l355.482-12.694a224 224 0 0 0-21.065-22.146h-303.75zM54.093 160a224 224 0 0 0-6.987 16.303l420.797 7.41a224 224 0 0 0-9.59-23.713H54.093zm-13.037 34.2a224 224 0 0 0-6.168 28.894l441.386-8.024a224 224 0 0 0-2.976-13.257L41.056 194.2zm437.693 38.827L32.92 241.13a224 224 0 0 0-.745 14.87 224 224 0 0 0 1.43 23h251.5c-3.19 1.413-6.214 3.02-9.024 4.816-5.576 3.568-10.425 8.035-14.005 13.184H36.09a224 224 0 0 0 7.93 30H257.46c3.102 9.023 10.002 16.672 18.62 22.184 3.162 2.023 6.593 3.802 10.235 5.336l-225.2 11.058a224 224 0 0 0 11.017 17.67l359.785 11.244a224 224 0 0 0 29.268-48.56l-99.652 4.894c.93-.53 1.844-1.074 2.733-1.642 8.615-5.512 15.516-13.16 18.618-22.184h85.53a224 224 0 0 0 7.82-30h-97.964c-3.58-5.15-8.428-9.616-14.005-13.184-2.812-1.797-5.834-3.403-9.027-4.816H478.96a224 224 0 0 0 .865-15.945l-75.808-10.918s48.452-4.13 75.54-6.344a224 224 0 0 0-.808-12.766zM320.174 290c13.77 0 26.1 3.674 34.394 8.98 8.292 5.303 12.105 11.52 12.105 17.52s-3.813 12.217-12.106 17.52c-8.294 5.306-20.625 8.98-34.395 8.98-13.77 0-26.102-3.674-34.395-8.98-8.293-5.303-12.105-11.52-12.105-17.52s3.812-12.217 12.105-17.52c8.293-5.306 20.624-8.98 34.395-8.98zM96.493 413a224 224 0 0 0 18.897 17h281.693a224 224 0 0 0 18.59-17H96.493zm82.537 53a224 224 0 0 0 77.145 14 224 224 0 0 0 77.488-14H179.03z",
    moonorbit: "M255.6 62.21c-25.1 0-50.7 5.02-75.3 15.48C81.74 119.5 35.86 233.1 77.69 331.7c4.76 11.1 10.45 21.7 16.93 31.5-12.6.3-23.45-.5-31.98-2.4-13.22-2.9-19.93-7.8-22.27-13.3-2.33-5.6-1.25-13.8 5.87-25.4 1.65-2.6 3.62-5.4 5.86-8.4-2.1-7.4-3.76-14.7-5.05-22.2-6.62 7.1-12.1 14.2-16.37 21.1-8.74 14.1-12.66 28.9-7.11 42 5.54 13.1 18.9 20.5 35.17 24 13.66 3 30.13 3.6 48.96 2.2 53.2 63.4 143.6 87.6 223.9 53.4 80.3-34.1 125.6-115.7 117.1-198.1 14.1-12.6 25.2-24.9 32.5-36.8 8.9-14.2 12.7-29 7.2-42-5.6-13.1-18.9-20.5-35.2-24.1-7.9-1.7-16.9-2.7-26.5-2.8 4.5 6.1 8.6 12.4 12.4 19.1 3.7.4 7.1.9 10.1 1.6 13.3 2.8 20 7.8 22.3 13.3 2.4 5.5 1.3 13.8-5.9 25.3-4.5 7.4-11.4 15.8-20.4 24.7 1.5 7.3 2.7 14.5 3.4 21.7-2.6 2.3-5.5 4.7-8.2 7.1-4.7 3.8-9.5 7.7-14.7 11.5 11.2 32-4.4 67.8-35.9 81.2-26.3 11.2-56 3.6-74-16.8-9.1 4.3-18.3 8.4-27.8 12.5-62.5 26.4-122.4 43-169.2 48.1-3.8.4-7.5.7-11 1.1-4.7-5.6-8.95-11.4-13.12-17.6 6.82-.2 14.22-.7 22.02-1.6 44.4-4.9 103-20.9 164.2-46.9 8.4-3.5 16.7-7.3 24.8-11-.4-.7-.7-1.4-1-2.1-14-32.9 1.5-71.2 34.4-85.1 28.3-12.1 60.7-2.1 78 21.8 4-3.1 7.9-6.1 11.5-9.1 6.1-5 11.6-10 16.6-14.8-2.6-11.5-6.2-22.9-11-34.1-31.4-73.9-103.1-118.22-178.6-118.09zM364.3 229.6c-5.9 0-12.1 1.2-18.1 3.7-23.7 10.1-34.8 37.3-24.6 61.2 10 23.8 37.3 34.7 61.1 24.6 23.7-10 34.8-37.3 24.6-61.1-7.5-17.9-24.7-28.5-43-28.4z",
    stripedsun: "M256 32a224 224 0 0 0-161.393 69.035h323.045A224 224 0 0 0 256 32zM79.148 118.965a224 224 0 0 0-16.976 25.16H449.74a224 224 0 0 0-16.699-25.16H79.148zm-27.222 45.16A224 224 0 0 0 43.3 186.25h425.271a224 224 0 0 0-8.586-22.125H51.926zM36.783 210.25a224 224 0 0 0-3.02 19.125h444.368a224 224 0 0 0-3.113-19.125H36.783zm-4.752 45.125A224 224 0 0 0 32 256a224 224 0 0 0 .64 16.5h446.534A224 224 0 0 0 480 256a224 224 0 0 0-.021-.625H32.03zm4.67 45.125a224 224 0 0 0 3.395 15.125h431.578a224 224 0 0 0 3.861-15.125H36.701zm14.307 45.125a224 224 0 0 0 6.017 13.125H454.82a224 224 0 0 0 6.342-13.125H51.008zm26.316 45.125a224 224 0 0 0 9.04 11.125H425.86a224 224 0 0 0 8.727-11.125H77.324zm45.62 45.125A224 224 0 0 0 136.247 445h239.89a224 224 0 0 0 12.936-9.125h-266.13z",
    sun: "M320.063 19.72c-72.258 14.575-19.248 71.693-74.344 108.81 4.846-.49 9.746-.702 14.655-.624 16.288.26 32.785 3.72 48.594 10.72 4.96 2.196 9.723 4.667 14.25 7.405 12.107-47.476-37.103-96.38-3.158-126.31zM136.75 44.47c-40.76 61.357 36.984 64.33 24.406 129.405 17.407-21.255 41.17-35.9 67.156-42.313-25.006-42.138-94.4-41.924-91.562-87.093zm297.313 75.405c-32.547.872-45.475 46.314-96.594 36.22 21.35 17.42 36.034 41.25 42.467 67.31 42.306-24.92 42.053-94.466 87.282-91.624-13.43-8.92-24.06-12.15-33.158-11.905zm-177.97 26.656c-23.656.46-46.53 8.82-64.906 23.626l18.657 36.156L170 193.156c-3.576 5.264-6.737 10.908-9.406 16.938-8.726 19.708-11.002 40.59-7.78 60.344l44.78 2.125-34 30.312c10.798 20.622 28.414 37.852 51.406 48.03 3.077 1.364 6.186 2.574 9.313 3.626l24.53-38.25 9.095 43.814c27.3.075 53.737-10.387 73.593-29.188l-19.186-37.125 38.406 12.658c1.822-3.188 3.512-6.506 5.03-9.938 9.746-22.01 11.457-45.498 6.44-67.22l-37.626-1.75 27.687-24.718c-10.83-20.194-28.236-37.07-50.874-47.093-1.37-.607-2.745-1.176-4.125-1.72l-25.874 40.313-9.906-47.75c-.5-.016-1-.023-1.5-.032-1.3-.02-2.61-.024-3.906 0zM133.407 186.5c-41.652.725-82.483 34.847-108.72 5.094 14.573 72.234 71.664 19.3 108.783 74.312-2.154-20.972.934-42.758 10.06-63.375 2.178-4.915 4.637-9.604 7.345-14.093-5.822-1.47-11.642-2.038-17.47-1.937zm249.5 53.97c2.204 21.047-.867 42.926-10.03 63.624l-.188.375c-2.143 4.796-4.57 9.393-7.22 13.78 47.524 12.244 96.507-37.137 126.47-3.156-14.603-72.388-71.92-19.04-109.032-74.625zM136.53 283.405c-42.123 25.014-41.928 94.37-87.093 91.53 61.422 40.803 64.322-37.123 129.594-24.342-21.344-17.385-36.03-41.167-42.5-67.188zm219.064 48.906c-17.406 21.46-41.236 36.24-67.344 42.72 24.944 42.263 94.497 42.004 91.656 87.218 40.867-61.52-37.402-64.358-24.312-129.938zM193.406 360.72c-12.047 47.456 37.087 96.33 3.156 126.25 72.305-14.587 19.195-71.79 74.47-108.908-21.04 2.204-42.898-.9-63.594-10.062-4.884-2.162-9.57-4.594-14.032-7.28z",
    blackhole: "M393.5 19.53c-2.858-.01-5.743.193-8.656.626-31.08 4.62-52.53 33.582-47.906 64.688 4.623 31.106 33.576 52.588 64.656 47.97 2.053-.307 4.066-.74 6.03-1.25 9.68 23.89 14.992 46.253 16.657 66.967-12.318 4.327-20.24 16.91-18.25 30.314 1.366 9.18 7.072 16.623 14.72 20.594-3.375 14.428-8.705 27.7-15.594 39.75-9.627 16.838-22.426 31.345-37.375 43.187 13.33-22.265 19.333-49.11 15.22-76.78-4.372-29.416-19.408-54.588-40.594-72.22-33.633-35.776-80.33-58.405-130.312-58.22-45.336.17-92.873 19.486-134.625 63.376-7.308-3.943-15.91-5.657-24.75-4.343-21.767 3.236-36.77 23.528-33.532 45.313 3.238 21.785 23.483 36.83 45.25 33.594 21.766-3.236 36.8-23.528 33.562-45.313-.93-6.26-3.28-11.97-6.656-16.843 38.472-40.475 80.822-56.944 120.844-57.093 21.038-.08 41.558 4.455 60.562 12.687-1.344-.05-2.678-.087-4.03-.093-5.835-.024-11.742.398-17.69 1.282-16.537 2.457-31.73 8.308-45 16.718-38.298 20.656-69.638 53.2-86.686 93.312-14.32 33.692-18.302 72.74-8 113.813-16.41 6.933-28.73 22.277-30.906 41.25-3.215 28.02 16.88 53.32 44.874 56.53 27.996 3.213 53.317-16.886 56.532-44.906 3.215-28.017-16.88-53.35-44.875-56.562-2.508-.288-4.99-.357-7.44-.28-9.626-37.47-5.866-72.288 7-102.564 5.206-12.245 11.944-23.753 19.94-34.342-4.43 15.467-5.71 32.107-3.19 49.062.354 2.373.794 4.715 1.282 7.03 7.884 58.165 40.39 112.06 91.97 141.658 45.803 26.28 106.342 32.7 175.75 6.75 8.357 11.38 22.54 17.875 37.468 15.656 21.484-3.194 36.32-23.216 33.125-44.72-3.196-21.5-23.203-36.35-44.688-33.155-21.484 3.192-36.32 23.215-33.125 44.717.015.096.048.187.063.282-64.737 24.18-118.595 17.612-159.313-5.75-23.945-13.74-43.422-33.523-57.625-56.783 23.992 18.134 54.95 26.988 87.032 22.22 8.252-1.228 16.172-3.316 23.686-6.126 46.562-11.748 88.206-40.568 112.5-83.06 8.058-14.095 14.142-29.657 17.844-46.5 14.273-3.006 23.925-16.652 21.75-31.282-1.56-10.494-8.8-18.77-18.125-22.125-1.686-23.377-7.498-48.395-18.156-74.657 17.774-11.842 28.13-33.24 24.78-55.78-4.19-28.19-28.373-48.48-56-48.595zM268.437 185.47l12.063 54 46.625-29.564-29.375 46.313 53.594 12.03-53.875 12.063 29.686 46.75-46.687-29.625-12.033 53.75-12-53.594-46.468 29.5 29.655-46.78-54-12.064 53.72-12.03-29.376-46.314 46.436 29.438 12.03-53.875zm-.156 71.28c-6.89 0-12.25 5.39-12.25 12.28 0 6.894 5.36 12.283 12.25 12.283 6.892 0 12.283-5.39 12.283-12.282 0-6.89-5.39-12.28-12.282-12.28z",
  };

  const GLYPH_P = {};
  for (const k in GLYPH_D) GLYPH_P[k] = new Path2D(GLYPH_D[k]);
  // HTML 칩/진화표용 작은 svg
  function glyphSvg(key, px) {
    return `<svg class="ki" style="width:${px}px;height:${px}px"><use href="#g-${key}"/></svg>`;
  }

  // 드롭으로 나올 수 있는 최대 단계(처음 몇 개만) — 수박게임 룰
  const SPAWN_MAX = 4;

  // ── DOM ──
  const board = document.getElementById('board');
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const elScore = document.getElementById('score');
  const elBest = document.getElementById('best');
  const elNext = document.getElementById('nextChip');
  const elCombo = document.getElementById('combo');
  const elDanger = document.getElementById('dangerline');
  const muteBtn = document.getElementById('mute');
  const overlay = document.getElementById('overlay');
  const startBtn = document.getElementById('startBtn');
  const ovTitle = document.getElementById('ovTitle');
  const ovScore = document.getElementById('ovScore');
  const ovSub = document.getElementById('ovSub');
  const recmark = document.getElementById('recmark');
  const evoEl = document.getElementById('evo');

  // ── 상태 ──
  let W = 0, H = 0, DPR = 1;
  let WALL = 14;          // 벽 두께
  let DANGER_Y = 0;       // 위험선 y
  let DROP_Y = 0;         // 행성이 매달리는 y
  let engine, runner;
  let bodies = [];        // 살아있는 행성 body 목록
  let score = 0;
  let best = +(localStorage.getItem('orbitBest') || 0);
  let running = false;
  let gameOver = false;
  let canDrop = true;
  let nextTier = 0;
  let nextIsBlackhole = false;
  let aimX = 0;           // 조준 x (월드 좌표)
  let mergeQueue = [];    // afterUpdate에서 처리할 합체 (이벤트 중 월드 변경 금지)
  const consumed = new Set();   // 이번 프레임 소비된 body id (이중 합체 방지)
  let combo = 0;          // 현재 콤보 수
  let comboTimer = 0;     // 콤보 유지 타이머(ms)
  let particles = [];     // 합체 팡 파티클
  let shake = 0;          // 화면 흔들림 강도
  let dangerHold = 0;     // 위험선 초과 누적 시간(ms)
  let lastTs = 0;
  let blackholeCooldown = 0;  // 블랙홀 등장 쿨다운(드롭 횟수 기준)
  let dropCount = 0;

  // ── 별 가루 배경 ──
  function paintStars() {
    const svg = document.getElementById('stars');
    const w = window.innerWidth, h = window.innerHeight;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    let s = '';
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const r = Math.random() * 1.4 + 0.4;
      const o = Math.random() * 0.4 + 0.15;
      s += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(1)}" fill="#8a9bd6" opacity="${o.toFixed(2)}"/>`;
    }
    svg.innerHTML = s;
  }

  // ── 진화 표 ──
  function paintEvo() {
    evoEl.innerHTML = TIERS.map(t =>
      `<div class="e" title="${t.name}" style="background:radial-gradient(circle at 35% 30%, ${t.c1}, ${t.c2})">${glyphSvg(t.g, 15)}</div>`
    ).join('');
  }

  // ── 캔버스/보드 사이즈 ──
  function fit() {
    const wrap = document.getElementById('wrap');
    const availW = Math.min(wrap.clientWidth, 460);
    const availH = wrap.clientHeight;
    // 세로 우선 비율 ~ 0.78 (가로:세로)
    let w = availW;
    let h = w / 0.72;
    if (h > availH) { h = availH; w = h * 0.72; }
    W = Math.round(w); H = Math.round(h);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    board.style.width = W + 'px';
    board.style.height = H + 'px';
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    DANGER_Y = Math.round(H * 0.16);
    DROP_Y = Math.round(H * 0.075);
    elDanger.style.top = DANGER_Y + 'px';
  }

  function radiusFor(tier) { return Math.max(10, TIERS[tier].rr * W); }

  // ── 물리 세계 ──
  function buildWorld() {
    if (runner) Runner.stop(runner);
    if (engine) Composite.clear(engine.world, false), Engine.clear(engine);
    engine = Engine.create();
    engine.world.gravity.y = 1.0;
    engine.enableSleeping = true;

    const opt = { isStatic: true, restitution: 0.2, friction: 0.6,
      render: { visible: false } };
    const floor = Bodies.rectangle(W / 2, H + WALL / 2 - 1, W * 2, WALL, opt);
    const left = Bodies.rectangle(WALL / 2, H / 2, WALL, H * 2, opt);
    const right = Bodies.rectangle(W - WALL / 2, H / 2, WALL, H * 2, opt);
    floor.label = left.label = right.label = 'wall';
    Composite.add(engine.world, [floor, left, right]);

    runner = Runner.create();
    Events.on(engine, 'collisionStart', onCollision);
    Events.on(engine, 'afterUpdate', onAfterUpdate);
  }

  // ── 행성 생성 ──
  let bodyId = 1;
  function makePlanet(x, y, tier, isBlackhole) {
    const r = isBlackhole ? radiusFor(2) : radiusFor(tier);
    const b = Bodies.circle(x, y, r, {
      restitution: 0.18,
      friction: 0.55,
      frictionStatic: 0.6,
      density: 0.0014,
      slop: 0.02,
    });
    b.plabel = isBlackhole ? BLACKHOLE : tier;
    b.tier = tier;
    b.isBlackhole = !!isBlackhole;
    b.r = r;
    b.uid = bodyId++;
    b.spawnAt = performance.now();
    return b;
  }

  // ── 충돌: 이중 합체 가드 + 큐잉(월드 변경은 afterUpdate에서) ──
  function onCollision(ev) {
    if (!running || gameOver) return;
    for (const pair of ev.pairs) {
      const a = pair.bodyA, b = pair.bodyB;
      if (a.label === 'wall' || b.label === 'wall') continue;
      if (consumed.has(a.uid) || consumed.has(b.uid)) continue;

      // 블랙홀: 닿은 행성과 같은 tier 전부 흡수
      if (a.isBlackhole || b.isBlackhole) {
        const hole = a.isBlackhole ? a : b;
        const hit = a.isBlackhole ? b : a;
        if (hit.isBlackhole) continue; // 블랙홀끼리는 무시
        consumed.add(hole.uid); consumed.add(hit.uid);
        mergeQueue.push({ type: 'blackhole', hole, targetTier: hit.tier, x: hit.position.x, y: hit.position.y });
        continue;
      }

      // 일반 합체: 같은 tier + 최대 미만
      if (a.tier === b.tier && a.tier < MAX_TIER) {
        consumed.add(a.uid); consumed.add(b.uid);
        mergeQueue.push({ type: 'merge', a, b, tier: a.tier });
      }
    }
  }

  function removeBody(b) {
    Composite.remove(engine.world, b);
    const i = bodies.indexOf(b);
    if (i >= 0) bodies.splice(i, 1);
  }

  function onAfterUpdate(ev) {
    if (!mergeQueue.length) { consumed.clear(); return; }
    const q = mergeQueue; mergeQueue = [];
    let merged = false;

    for (const m of q) {
      if (m.type === 'merge') {
        if (!bodies.includes(m.a) || !bodies.includes(m.b)) continue;
        const mx = (m.a.position.x + m.b.position.x) / 2;
        const my = (m.a.position.y + m.b.position.y) / 2;
        const newTier = m.tier + 1;
        removeBody(m.a); removeBody(m.b);
        const np = makePlanet(mx, my, newTier, false);
        bodies.push(np);
        Composite.add(engine.world, np);
        Body.setVelocity(np, { x: 0, y: -1.2 });
        merged = true;

        bumpCombo();
        const gain = TIERS[newTier].score * comboMult();
        addScore(gain);
        burst(mx, my, TIERS[newTier].c1, newTier);
        shake = Math.min(shake + 2 + newTier * 0.5, 14);
        Sound.merge(newTier, combo);
        vibrate(newTier >= 6 ? 30 : 12);
        if (newTier >= 6) Sound.big();
        if (newTier === MAX_TIER) { burst(mx, my, '#ffd86e', MAX_TIER); shake = 16; }
      } else if (m.type === 'blackhole') {
        if (!bodies.includes(m.hole)) continue;
        Sound.blackhole();
        // 흡수 시각효과: 블랙홀 위치로 빨려드는 파티클
        const hx = m.hole.position.x, hy = m.hole.position.y;
        const victims = bodies.filter(b => !b.isBlackhole && b.tier === m.targetTier);
        let absorbed = 0;
        for (const v of victims) {
          burst(v.position.x, v.position.y, TIERS[v.tier].c2, v.tier, true, hx, hy);
          removeBody(v); absorbed++;
        }
        removeBody(m.hole);
        merged = true;
        bumpCombo();
        const gain = (TIERS[m.targetTier].score * absorbed) * comboMult();
        addScore(gain);
        burstRing(hx, hy);
        shake = Math.min(shake + 8, 18);
        vibrate([20, 40, 30]);
      }
    }
    consumed.clear();
    if (merged) refreshNextPreview();
  }

  // ── 콤보 ──
  function bumpCombo() { combo++; comboTimer = 900; flashCombo(); }
  function comboMult() { return combo <= 1 ? 1 : combo; } // 2연쇄=x2, 3연쇄=x3...
  function flashCombo() {
    if (combo >= 2) {
      elCombo.textContent = `${combo} COMBO! x${comboMult()}`;
      elCombo.classList.add('show', 'pulse');
      setTimeout(() => elCombo.classList.remove('pulse'), 360);
    }
  }
  function decayCombo(dt) {
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) { combo = 0; elCombo.classList.remove('show'); }
    }
  }

  // ── 점수 ──
  function addScore(n) {
    score += Math.round(n);
    elScore.textContent = score;
    if (score > best) {
      best = score;
      elBest.textContent = best;
      // 계약: 신기록 시에만 setItem (서빙 후킹이 캡처)
      try { localStorage.setItem('orbitBest', String(best)); } catch (e) {}
    }
  }

  // ── 파티클 (합체 팡 / 흡수) ──
  function burst(x, y, color, tier, suck, tx, ty) {
    const n = 8 + tier;
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5;
      const sp = 1.5 + Math.random() * 2.5 + tier * 0.2;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        r: 2 + Math.random() * 2.5, color, life: 1,
        suck: !!suck, tx, ty,
      });
    }
  }
  function burstRing(x, y) {
    for (let i = 0; i < 22; i++) {
      const a = (Math.PI * 2 * i) / 22;
      particles.push({
        x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6,
        vx: Math.cos(a) * 4, vy: Math.sin(a) * 4,
        r: 2.5, color: '#3a2f5a', life: 1, ring: true,
      });
    }
  }
  function vibrate(p) { if (!Sound.muted && navigator.vibrate) try { navigator.vibrate(p); } catch (e) {} }

  // ── 다음 미리보기 ──
  function pickTier() { return Math.floor(Math.random() * SPAWN_MAX); }
  function refreshNextPreview() {
    if (nextIsBlackhole) {
      elNext.innerHTML = `<svg class="ki" style="width:18px;height:18px;fill:rgba(225,222,240,.95)"><use href="#g-blackhole"/></svg>`;
      elNext.style.background = 'radial-gradient(circle at 38% 32%, #5a5170, #2c2640)';
      elNext.style.boxShadow = 'inset 0 0 8px #1a1530, 0 0 10px rgba(90,80,130,.5)';
    } else {
      const t = TIERS[nextTier];
      elNext.innerHTML = glyphSvg(t.g, 18);
      elNext.style.background = `radial-gradient(circle at 35% 30%, ${t.c1}, ${t.c2})`;
      elNext.style.boxShadow = 'inset 0 2px 4px rgba(255,255,255,.55),0 2px 5px rgba(70,60,105,.18)';
    }
  }
  function rollNext() {
    // 블랙홀: 6번 드롭마다 한 번 정도, 보드에 행성이 충분히 있을 때
    dropCount++;
    if (blackholeCooldown <= 0 && bodies.length >= 5 && Math.random() < 0.5) {
      nextIsBlackhole = true;
      blackholeCooldown = 5 + Math.floor(Math.random() * 3);
    } else {
      nextIsBlackhole = false;
      nextTier = pickTier();
      if (blackholeCooldown > 0) blackholeCooldown--;
    }
    refreshNextPreview();
  }

  // ── 매달린(미리보기) 행성 ──
  let held = null; // {tier,isBlackhole,r}
  function prepHeld() {
    held = nextIsBlackhole
      ? { tier: 2, isBlackhole: true, r: radiusFor(2) }
      : { tier: nextTier, isBlackhole: false, r: radiusFor(nextTier) };
  }

  function clampAim(x, r) {
    return Math.max(WALL + r + 1, Math.min(W - WALL - r - 1, x));
  }

  function drop() {
    if (!running || gameOver || !canDrop || !held) return;
    canDrop = false;
    const x = clampAim(aimX, held.r);
    const b = makePlanet(x, DROP_Y, held.tier, held.isBlackhole);
    bodies.push(b);
    Composite.add(engine.world, b);
    Sound.drop();
    held = null;
    // 다음 굴리고, 낙하 텀 후 다시 드롭 허용 (연타 오염 방지)
    rollNext();
    setTimeout(() => { prepHeld(); canDrop = true; }, 420);
  }

  // ── 입력 (pointer) ──
  function pointerToWorldX(e) {
    const rect = cv.getBoundingClientRect();
    return ((e.clientX - rect.left) / rect.width) * W;
  }
  let aiming = false;
  cv.addEventListener('pointerdown', (e) => {
    if (!running || gameOver) return;
    Sound.unlock();
    aiming = true;
    aimX = clampAim(pointerToWorldX(e), held ? held.r : 16);
    try { cv.setPointerCapture(e.pointerId); } catch (_) {}
  });
  cv.addEventListener('pointermove', (e) => {
    if (!aiming || !running) return;
    aimX = clampAim(pointerToWorldX(e), held ? held.r : 16);
  });
  function release(e) {
    if (!aiming) return;
    aiming = false;
    drop();
  }
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', () => { aiming = false; });

  // ── 게임오버 판정: 위험선 위에 정착한(느린) 행성이 일정시간 지속 ──
  function checkDanger(dt) {
    let over = false;
    for (const b of bodies) {
      if (b.isBlackhole) continue;
      const age = performance.now() - b.spawnAt;
      if (age < 700) continue;                 // 방금 떨어뜨린 건 제외
      const speed = Math.hypot(b.velocity.x, b.velocity.y);
      if (speed > 1.1) continue;                // 아직 움직이는 중이면 제외
      if (b.position.y - b.r < DANGER_Y) { over = true; break; }
    }
    if (over) {
      dangerHold += dt;
      elDanger.classList.add('warn');
      if (dangerHold > 1100) endGame();
    } else {
      dangerHold = Math.max(0, dangerHold - dt * 1.5);
      if (dangerHold < 200) elDanger.classList.remove('warn');
    }
  }

  // ── 렌더 ──
  function drawPlanet(b, x, y, r, tier, isBlackhole, ghost) {
    ctx.save();
    if (ghost) ctx.globalAlpha = 0.55;
    if (isBlackhole) {
      // 블랙홀: 어두운 코어 + 빛 휘는 링 (네온 글로우 아님, 차분히)
      const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.1, x, y, r);
      g.addColorStop(0, '#2c2640');
      g.addColorStop(0.7, '#3a3358');
      g.addColorStop(1, '#5a5170');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(170,160,210,.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.18, r * 0.5, 0.5, 0, Math.PI * 2); ctx.stroke();
      // 블랙홀 글리프 (밝은 단색 — 어두운 코어 위에서 또렷)
      drawGlyph('blackhole', x, y, r, 'rgba(225,222,240,0.92)');
      ctx.restore();
      return;
    }
    const t = TIERS[tier];
    // 본체 그라데이션 (명도폭 좁게)
    const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.34, r * 0.15, x, y, r);
    g.addColorStop(0, t.c1);
    g.addColorStop(1, t.c2);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    // 토성 고리
    if (t.ring) {
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(2, r * 0.13);
      ctx.beginPath(); ctx.ellipse(x, y, r * 1.32, r * 0.42, -0.35, 0, Math.PI * 2); ctx.stroke();
    }
    // 크리스프 윗 림 (빛 하나만)
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = Math.max(1, r * 0.06);
    ctx.beginPath(); ctx.arc(x, y, r - 1, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
    // 우주 글리프 (Path2D, 512 viewBox) — 짙은 단색으로 또렷하게
    ctx.globalAlpha = (ghost ? 0.55 : 1);
    drawGlyph(t.g, x, y, r, 'rgba(57,52,78,0.9)');
    ctx.restore();
  }

  // 글리프 path를 원 중앙에 채워 그림. 512 viewBox 기준 scale.
  function drawGlyph(key, x, y, r, fill) {
    const gp = GLYPH_P[key];
    if (!gp) return;
    ctx.save();
    ctx.translate(x, y);
    const s = (r * 1.45) / 512;
    ctx.scale(s, s);
    ctx.translate(-256, -256);
    ctx.fillStyle = fill;
    ctx.fill(gp);
    ctx.restore();
  }

  function render(ts) {
    requestAnimationFrame(render);
    const dt = lastTs ? Math.min(ts - lastTs, 50) : 16;
    lastTs = ts;

    if (running && !gameOver) {
      checkDanger(dt);
      decayCombo(dt);
    }

    // 흔들림 오프셋
    let ox = 0, oy = 0;
    if (shake > 0.2) {
      ox = (Math.random() - 0.5) * shake;
      oy = (Math.random() - 0.5) * shake;
      shake *= 0.86;
    } else shake = 0;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);

    // 살아있는 행성
    for (const b of bodies) {
      drawPlanet(b, b.position.x, b.position.y, b.r, b.tier, b.isBlackhole, false);
    }

    // 매달린 미리보기 + 조준선
    if (running && !gameOver && held && canDrop === false) {
      // 떨어지는 중 — 미리보기 숨김
    }
    if (running && !gameOver && held && canDrop) {
      const hx = clampAim(aimX, held.r);
      ctx.save();
      ctx.strokeStyle = 'rgba(120,130,180,.4)';
      ctx.setLineDash([4, 6]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(hx, DROP_Y + held.r); ctx.lineTo(hx, H - WALL); ctx.stroke();
      ctx.restore();
      drawPlanet(null, hx, DROP_Y, held.r, held.tier, held.isBlackhole, true);
    }

    // 파티클
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.suck) {
        // 흡수: 목표(블랙홀)로 빨려감
        p.vx += (p.tx - p.x) * 0.06;
        p.vy += (p.ty - p.y) * 0.06;
        p.vx *= 0.9; p.vy *= 0.9;
        p.life -= 0.04;
      } else if (p.ring) {
        p.vx *= 0.92; p.vy *= 0.92; p.life -= 0.045;
      } else {
        p.vy += 0.12; p.vx *= 0.97; p.life -= 0.04;
      }
      p.x += p.vx; p.y += p.vy;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (p.ring ? p.life : 1), 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── 흐름 ──
  function startGame() {
    overlay.classList.remove('show');
    fit();
    buildWorld();
    bodies = []; particles = []; mergeQueue = []; consumed.clear();
    score = 0; combo = 0; comboTimer = 0; dangerHold = 0;
    dropCount = 0; blackholeCooldown = 6;
    gameOver = false; running = true; canDrop = true;
    aimX = W / 2;
    elScore.textContent = '0';
    elCombo.classList.remove('show');
    elDanger.classList.remove('warn');
    Runner.run(runner, engine);
    Sound.unlock();
    nextIsBlackhole = false; nextTier = pickTier();
    prepHeld();
    refreshNextPreview();
  }

  function endGame() {
    if (gameOver) return;
    gameOver = true; running = false; canDrop = false;
    Runner.stop(runner);
    Sound.over();
    const isRec = score >= best && score > 0;
    if (isRec) { try { localStorage.setItem('orbitBest', String(score)); } catch (e) {} setTimeout(() => Sound.rec(), 350); }
    setTimeout(() => {
      ovTitle.textContent = '게임 오버';
      recmark.style.display = isRec ? 'block' : 'none';
      ovScore.style.display = 'block'; ovScore.textContent = score;
      ovSub.textContent = isRec ? '새로운 우주 최고 기록!' : `최고 기록 ${best}점`;
      startBtn.textContent = '다시 시작';
      overlay.classList.add('show');
      // 게임 끝나면 후원+의견 (포털 공용 모달 — 모든 게임 동일)
      if (window.GamePortal) setTimeout(function () { GamePortal.openSupport(); }, 700);
    }, 600);
  }

  // ── 음소거 ──
  function syncMute() {
    const u = muteBtn.querySelector('use');
    if (u) u.setAttribute('href', Sound.muted ? '#p-speaker-slash' : '#p-speaker-high');
  }
  muteBtn.addEventListener('click', () => { Sound.toggle(); syncMute(); });

  startBtn.addEventListener('click', () => { Sound.unlock(); startGame(); });

  // ── 리사이즈 ──
  let rzTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(() => {
      paintStars();
      if (!running) fit();
      // 진행 중 리사이즈는 비율 변동 위험 → 보드만 유지 (간단히 재맞춤 생략)
    }, 200);
  });

  // ── 초기화 ──
  elBest.textContent = best;
  syncMute();
  paintStars();
  paintEvo();
  fit();
  ovScore.style.display = 'none';
  recmark.style.display = 'none';
  requestAnimationFrame(render);

  // 디버그/테스트용 훅
  window.__orbit = {
    drop(x) { aimX = x == null ? W / 2 : x; drop(); },
    state() { return { score, best, combo, bodies: bodies.length, gameOver, running, nextIsBlackhole }; },
    forceBlackhole() { nextIsBlackhole = true; prepHeld(); refreshNextPreview(); },
  };
})();
