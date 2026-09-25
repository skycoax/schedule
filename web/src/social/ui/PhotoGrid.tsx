// Фото в посте: 1 — по пропорции (0.8…1.91), 2–4 — сеткой 16:9. Показываем миниатюры (m.thumb);
// миниатюра не загрузилась — пробуем полное фото, потом значок «фото». Кнопка остаётся рабочей.
import { useState } from 'react';
import type { JSX } from 'react';
import type { MediaRef } from '../types';
import { Icon } from '../../ui/icons';
import './social-ui.css';

function Cell({ m, i, n, onOpen }: { m: MediaRef; i: number; n: number; onOpen: (i: number) => void }) {
  const first = m.thumb || m.url;
  const [src, setSrc] = useState(first);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <button type="button" className="pgrid__i" aria-label={`Фото ${i + 1} из ${n}`} onClick={() => onOpen(i)}>
      {failed
        ? <Icon name="photo" size={28} className="pgrid__err" />
        : (
          <img
            className={loaded ? 'is-loaded' : undefined}
            src={src} width={m.w || undefined} height={m.h || undefined} loading="lazy" decoding="async" alt=""
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => {
              if (src !== m.url && m.url) setSrc(m.url);
              else setFailed(true);
            }}
          />
        )}
    </button>
  );
}

export function PhotoGrid(p: { media: MediaRef[]; onOpen: (i: number) => void }): JSX.Element | null {
  const list = p.media.slice(0, 4);
  const n = list.length;
  if (!n) return null;
  const one = list[0];
  const ratio = n === 1 && one.w > 0 && one.h > 0 ? Math.min(1.91, Math.max(0.8, one.w / one.h)) : 16 / 9;
  return (
    <div className={'pgrid pgrid--' + n} style={{ aspectRatio: String(ratio) }}>
      {list.map((m, i) => <Cell key={m.id} m={m} i={i} n={n} onOpen={p.onOpen} />)}
    </div>
  );
}
