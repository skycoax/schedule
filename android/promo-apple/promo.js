// Общие куски для feature.html и shots.html: телефон с живым скриншотом и знак Para.
const STATUS_ICONS = `
  <svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg>
  <svg viewBox="0 0 16 12"><path d="M8 11.5 5.6 9a3.4 3.4 0 0 1 4.8 0z"/><path d="M3.5 6.9a6.4 6.4 0 0 1 9 0l-1.4 1.4a4.4 4.4 0 0 0-6.2 0z"/><path d="M1.2 4.6a9.6 9.6 0 0 1 13.6 0l-1.4 1.4a7.6 7.6 0 0 0-10.8 0z"/></svg>
  <svg viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="#fff" stroke-opacity=".45"/><rect x="2" y="2" width="15" height="8" rx="1.6"/><path d="M24 4v4a2 2 0 0 0 0-4z" fill-opacity=".45"/></svg>`;

// Живые экраны из live/ (снимает shoot-countdown.mjs); top — цвет верха экрана под полосой статуса.
const SHOTS = {
  vuzy: { src: 'live/вузы.png', top: '#1a1a1c' },
  now: { src: 'live/сейчас.png', top: '#000' },
  week: { src: 'live/неделя.png', top: '#000' },
  edits: { src: 'live/правки.png', top: '#000' },
};

function phone({ shot, w, x, y, z = 1, time = '9:27' }) {
  const s = SHOTS[shot];
  return `
    <div class="phone" style="--w:${w}px; left:${x}px; top:${y}px; z-index:${z}">
      <div class="bezel">
        <div class="screen" style="--top:${s.top}">
          <div class="status"><span>${time}</span><i class="cam"></i><span class="icons">${STATUS_ICONS}</span></div>
          <img src="${s.src}" alt="">
        </div>
      </div>
    </div>`;
}

// Объёмный знак Para на чёрном фоне — встаёт на чёрный кадр без рамки
function logo(h) {
  return `<img class="logo" src="logo-3d.png" alt="Para" style="height:${h}px; width:auto; display:inline-block">`;
}
