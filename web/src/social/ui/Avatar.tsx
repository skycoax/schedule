// Фото профиля или монограмма (первая буква имени на мягком цвете из палитры). null — серый круг.
// Импортирует ТОЛЬКО avatar.css: Avatar попадает в основной бандл через панель вкладок.
import { useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { colorOf } from '../../lib/uni';
import './avatar.css';

let seg: { segment: (s: string) => Iterable<{ segment: string }> } | null | undefined;

function firstGrapheme(name: string): string {
  const s = (name || '').trim();
  if (!s) return '';
  if (seg === undefined) {
    try { seg = new Intl.Segmenter('ru', { granularity: 'grapheme' }); } catch { seg = null; }
  }
  if (seg) for (const g of seg.segment(s)) return g.segment.toUpperCase();
  return [...s][0].toUpperCase();
}

export function Avatar(p: {
  user: { id: number; name: string; avatar: string | null } | null;
  size: 24 | 26 | 32 | 36 | 40 | 44 | 56 | 72 | 88 | 96;
  onClick?: () => void; label?: string; ring?: boolean;
}): JSX.Element {
  const [failed, setFailed] = useState<string | null>(null);
  const u = p.user;
  const src = u && u.avatar && failed !== u.avatar ? u.avatar : null;
  const mono = !!u && !src;
  const cls = 'av av--' + p.size + (p.ring ? ' av--ring' : '') + (u ? '' : ' av--none')
    + (mono ? ' av--mono' : '') + (p.onClick ? ' av--btn' : '');
  const style = mono ? ({ '--av-c': colorOf(String(u.id)) } as CSSProperties) : undefined;
  const inner = src
    ? <img className="av__img" src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(src)} />
    : u ? <span className="av__mono" aria-hidden="true">{firstGrapheme(u.name)}</span> : null;

  if (p.onClick) {
    return (
      <button type="button" className={cls} style={style} onClick={p.onClick} aria-label={p.label || u?.name || 'Профиль'}>
        {inner}
      </button>
    );
  }
  return (
    <span className={cls} style={style} role={p.label ? 'img' : undefined} aria-label={p.label} aria-hidden={p.label ? undefined : true}>
      {inner}
    </span>
  );
}
