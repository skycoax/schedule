// Текст поста: переносы строк как есть, ссылки http/https и упоминания @username.
// HTML из текста не вставляется никогда (без dangerouslySetInnerHTML).
// clamp — не больше N строк (-webkit-line-clamp). «Показать полностью» рисует тот, кто обрезает (PostCard).
import { useMemo } from 'react';
import type { JSX } from 'react';
import { brand } from '../../brand';
import { tokenize } from '../format';
import './social-ui.css';

export function RichText(p: { text: string; clamp?: number; onMention: (username: string) => void; className?: string }): JSX.Element {
  const tokens = useMemo(() => tokenize(p.text), [p.text]);
  const style = p.clamp ? { WebkitLineClamp: p.clamp, lineClamp: p.clamp } : undefined;
  return (
    <div className={'rt' + (p.clamp ? ' rt--clamp' : '') + (p.className ? ' ' + p.className : '')} style={style}>
      {tokens.map((t, i) => {
        if (typeof t === 'string') return t;
        if (t.t === 'url') {
          return (
            <a
              key={i} className="rt__link" href={t.href} target="_blank" rel="noopener noreferrer nofollow ugc"
              onClick={(e) => e.stopPropagation()}
            >
              {t.label}
            </a>
          );
        }
        return (
          <a
            key={i} className="rt__mention" href={'/?uni=' + encodeURIComponent(brand.id) + '&user=' + encodeURIComponent(t.username)}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); p.onMention(t.username); }}
          >
            @{t.username}
          </a>
        );
      })}
    </div>
  );
}
