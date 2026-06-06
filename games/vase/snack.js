// GAME-KIT 간식 사주기 — 클리어/게임오버 화면에 은은하게 노출되는 후원 버튼
// PC에선 토스 앱 스킴이 안 열리므로 "마음만으로도 고마워요" 모달로 대체한다.
// 사용:
//   initSnack(document.getElementById('snack-mount'));            // 기본값(준희 계좌)
//   initSnack(el, { label: '재밌었다면 개발자 간식 사주기' });
// 전제: ui.css(.k-snack/.k-modal/.k-card)와 sprite.svg(#g-donut)가 페이지에 있어야 한다.
function initSnack(mount, opts) {
  opts = opts || {};
  const toss = opts.toss || { bank: '토스뱅크', accountNo: '100025266940', amount: 3000 };
  const kakaoUrl = opts.kakaoUrl || 'https://qr.kakaopay.com/FP0dZW9ip';
  const label = opts.label || '재밌었다면 개발자 간식 사주기';
  const tossHref = `supertoss://send?bank=${toss.bank}&accountNo=${toss.accountNo}&amount=${toss.amount}`;

  mount.classList.add('k-snack');
  mount.innerHTML = `
    <span class="k-snack-label">${label}</span>
    <span class="k-snack-btns">
      <a class="toss" href="${tossHref}">토스</a>
      <a class="kakao" href="${kakaoUrl}" target="_blank" rel="noopener">
        <svg class="ki sm"><use href="#g-donut"/></svg>카카오페이</a>
    </span>`;

  // PC fallback 모달 (한 페이지에 한 번만 주입)
  let thanks = document.getElementById('k-thanks');
  if (!thanks) {
    thanks = document.createElement('div');
    thanks.id = 'k-thanks';
    thanks.className = 'k-modal hidden';
    thanks.innerHTML = `
      <div class="k-card">
        <svg class="ki lg" style="fill:#ff8a9b;width:46px;height:46px;"><use href="#p-heart"/></svg>
        <h2>마음만으로도 감동이에요!</h2>
        <p style="font-size:15px;line-height:1.55;opacity:.85;">송금은 폰에서 열어야 동작하지만,<br>여기까지 눌러주신 것만으로도<br>개발자는 이미 간식 하나 먹은 기분이에요</p>
        <p style="font-size:12px;opacity:.55;margin-top:10px;">정 보내고 싶다면 폰으로 접속해서 눌러주세요!</p>
        <button class="k-btn k-teal lg" style="margin-top:18px;" id="k-thanks-close">고마워요</button>
      </div>`;
    document.body.appendChild(thanks);
    thanks.querySelector('#k-thanks-close').addEventListener('click', () => thanks.classList.add('hidden'));
    thanks.addEventListener('click', (e) => { if (e.target === thanks) thanks.classList.add('hidden'); });
  }

  const isMobile = () => /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  mount.querySelectorAll('a').forEach((a) => {
    a.addEventListener('click', (e) => {
      if (!isMobile()) { e.preventDefault(); thanks.classList.remove('hidden'); }
    });
  });
}

if (typeof window !== 'undefined') window.initSnack = initSnack;
