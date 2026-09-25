// Диагностика экрана для iPhone: что браузер сообщает приложению о размерах окна, безопасных полях и
// закреплённых элементах. Открывается пятью быстрыми нажатиями на надпись внизу настроек (SettingsList).
// Нужна, чтобы понять, почему на iOS нижние вкладки уезжают за край, — владелец присылает скриншот.
import { useEffect, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { toast } from '../ui/Toast';

function probe(style: string): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:0;top:0;width:0;visibility:hidden;pointer-events:none;' + style;
  document.body.appendChild(el);
  return el;
}

const px = (v: string) => Math.round(parseFloat(v) || 0);
const r = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '–' : String(Math.round(n * 10) / 10));

function rectOf(sel: string): string {
  const el = document.querySelector<HTMLElement>(sel);
  if (!el || !el.getClientRects().length) return 'нет';
  const b = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return `${r(b.top)}…${r(b.bottom)} (${cs.position}, top ${cs.top}, bottom ${cs.bottom}, translate ${cs.translate || 'none'})`;
}

function measure(): string[] {
  const ua = navigator.userAgent;
  const ios = /OS (\d+)_(\d+)(?:_(\d+))? like Mac OS X/.exec(ua);
  const iosVer = ios ? `${ios[1]}.${ios[2]}${ios[3] ? '.' + ios[3] : ''}` : '–';
  const nav = navigator as Navigator & { standalone?: boolean };
  let standalone = '–';
  try { standalone = matchMedia('(display-mode: standalone)').matches ? 'да' : 'нет'; } catch { /* старый браузер */ }
  const vv = window.visualViewport;
  const root = document.documentElement;

  const safe = probe('padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)');
  const cs = getComputedStyle(safe);
  const units = ['100vh', '100svh', '100lvh', '100dvh'].map((u) => {
    const el = probe('height:' + u);
    const h = el.offsetHeight;
    el.remove();
    return `${u.slice(3)} ${h}`;
  });
  const lines = [
    `iOS ${iosVer} · standalone ${standalone}${nav.standalone !== undefined ? ' / ' + (nav.standalone ? 'да' : 'нет') : ''} · DPR ${devicePixelRatio}`,
    `screen ${screen.width}×${screen.height} · inner ${innerWidth}×${innerHeight} · outer ${outerWidth}×${outerHeight}`,
    `client ${root.clientWidth}×${root.clientHeight} · scroll ${r(scrollY)} из ${root.scrollHeight}`,
    vv ? `vv ${r(vv.width)}×${r(vv.height)} · offsetTop ${r(vv.offsetTop)} · pageTop ${r(vv.pageTop)} · scale ${r(vv.scale)}` : 'vv нет',
    `safe ↑${px(cs.paddingTop)} ↓${px(cs.paddingBottom)} ←${px(cs.paddingLeft)} →${px(cs.paddingRight)}`,
    `единицы: ${units.join(' · ')}`,
    `--vv-fix ${root.style.getPropertyValue('--vv-fix') || '–'} · --kb ${root.style.getPropertyValue('--kb') || '–'}`,
    `вкладки ${rectOf('.tabbar')}`,
    `шапка ${rectOf('.navrow')}`,
    `затемнение сверху ${rectOf('.topfade')}`,
    `время ${new Date().toLocaleTimeString('ru')}`,
  ];
  safe.remove();
  return lines;
}

const box: CSSProperties = {
  position: 'fixed', left: 8, right: 8, top: '30%', zIndex: 300, padding: '12px 12px 10px', borderRadius: 14,
  background: 'rgba(0,0,0,.88)', color: '#fff', font: '12px/1.45 ui-monospace, Menlo, monospace',
  boxShadow: '0 8px 30px rgba(0,0,0,.4)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
};
const btn: CSSProperties = { minHeight: 36, padding: '0 12px', borderRadius: 10, background: 'rgba(255,255,255,.16)', color: '#fff', font: '600 13px/1 system-ui' };

export function ViewportDebug({ onClose }: { onClose: () => void }): JSX.Element {
  const [lines, setLines] = useState<string[]>(measure);

  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setLines(measure())); };
    const vv = window.visualViewport;
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    vv?.addEventListener('resize', on);
    vv?.addEventListener('scroll', on);
    const t = window.setInterval(on, 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      vv?.removeEventListener('resize', on);
      vv?.removeEventListener('scroll', on);
    };
  }, []);

  const copy = async () => {
    try { await navigator.clipboard.writeText(lines.join('\n')); toast('Скопировано'); } catch { toast('Не получилось скопировать'); }
  };

  return (
    <div style={box} role="dialog" aria-label="Диагностика экрана">
      {lines.join('\n')}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" style={btn} onClick={() => void copy()}>Скопировать</button>
        <button type="button" style={btn} onClick={onClose}>Закрыть</button>
      </div>
    </div>
  );
}
