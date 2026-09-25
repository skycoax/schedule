// Выбор вуза — меню от логотипа, как системное меню iOS: вырастает из кнопки сверху,
// материал с размытием, галочка у текущего вуза. На адресе вуза выбор — переход на
// сайт другого вуза; в Para — смена вуза на месте, и вместо эмблем — сокращения.
// Список отдаёт сервер: новый вуз появляется здесь сам.
import { useEffect, useRef, useState } from 'react';
import { getUniversities, type University } from '../api';
import { brand } from '../brand';
import { colorOf } from '../lib/uni';
import { Spark } from './Spark';

/** Куда поставить меню: под кнопкой-логотипом, в координатах окна. */
export interface MenuAnchor { top: number; left: number; }

export function UniversityMenu({ anchor, onClose }: { anchor: MenuAnchor | null; onClose: () => void }) {
  const [list, setList] = useState<University[] | null>(null);
  const [err, setErr] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const open = !!anchor;

  useEffect(() => {
    if (!open) return;
    if (!list) getUniversities().then(setList).catch((e) => setErr(String(e.message || e)));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // С клавиатуры фокус сразу на первом вузе.
  useEffect(() => {
    if (open && list) ref.current?.querySelector<HTMLElement>('.umenu__row')?.focus({ preventScroll: true });
  }, [open, list]);

  if (!anchor) return null;

  return (
    <>
      <div className="umenu__catch" onClick={onClose} aria-hidden="true" />
      <div className={'umenu' + (brand.hub ? ' umenu--hub' : '')} role="menu" aria-label="Выбор вуза" ref={ref}
        style={{ top: anchor.top, left: anchor.left, ['--umenu-top' as string]: `${anchor.top}px` }}>
        <div className="umenu__head">
          <div className="umenu__title">Расписания вузов</div>
          {list && <div className="umenu__count">{list.length}</div>}
        </div>
        {err && <div className="umenu__err">{err}</div>}
        {!list && !err && <div className="umenu__load"><i /><i /></div>}
        {list && <div className="umenu__list">
          {list.map((u) => {
            const current = u.id === brand.id;
            return (
              <a key={u.id} className="umenu__row" role="menuitemradio" aria-checked={current} aria-label={`${u.short}, ${u.university}`}
                href={brand.hub ? '/?uni=' + encodeURIComponent(u.id) : u.url}
                onClick={current ? (e) => { e.preventDefault(); onClose(); } : undefined}>
                <span className="umenu__logo"
                  style={{ ['--logo' as string]: `url("${u.logo}")`, ['--c' as string]: colorOf(u.id) }} />
                <span className="umenu__txt">
                  <span className="umenu__name">{u.short}</span>
                  <span className="umenu__sub">{u.university}</span>
                </span>
                {brand.hub && u.people > 0 && <Spark values={u.spark} color={colorOf(u.id)} />}
                {current && (
                  <svg className="umenu__check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                )}
              </a>
            );
          })}
        </div>}
      </div>
    </>
  );
}
