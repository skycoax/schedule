// Моменты в «Обсуждениях»: карточка у правого края (как в Instagram — «+», а когда у друзей есть новые моменты,
// их миниатюры и число), камера, просмотр моментов друзей и архив «Твои моменты».
// Моменты друзей грузятся, пока вкладка видна: сразу и раз в минуту, после своего момента — заново.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from '../../ui/icons';
import { socialApi } from '../api';
import { currentReturnTo, useSession } from '../session';
import type { FriendInstant, InstantsFeed } from '../types';
import { InstantCamera } from './InstantCamera';
import { InstantViewer } from './InstantViewer';
import { InstantsArchive } from './InstantsArchive';
import { installSquircle } from './squircle';
import './instants.css';

type Screen = null | 'camera' | 'viewer' | 'archive';

export function InstantsHost(p: { active: boolean; hidden?: boolean }): JSX.Element | null {
  installSquircle();
  const s = useSession();
  const [feed, setFeed] = useState<InstantsFeed | null>(null);
  const [screen, setScreen] = useState<Screen>(null);
  const [start, setStart] = useState(0);
  const ready = s.status === 'signed' && !!s.me?.username && s.mode === 'on';

  const load = useCallback(async () => {
    if (!ready) { setFeed(null); return; }
    try { setFeed(await socialApi.instantsFeed()); } catch { /* без сети — останется прежнее */ }
  }, [ready]);

  useEffect(() => {
    if (!p.active) return;
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 60_000);
    return () => clearInterval(t);
  }, [p.active, load]);

  const patch = useCallback((id: number, change: Partial<FriendInstant>) => {
    setFeed((f) => f && {
      ...f,
      groups: f.groups.map((g) => {
        if (!g.items.some((x) => x.id === id)) return g;
        const items = g.items.map((x) => (x.id === id ? { ...x, ...change } : x));
        return { ...g, items, unseen: items.filter((x) => !x.seen).length };
      }),
    });
  }, []);
  const gone = useCallback((id: number) => {
    setFeed((f) => f && {
      ...f,
      groups: f.groups.map((g) => ({ ...g, items: g.items.filter((x) => x.id !== id) })).filter((g) => g.items.length > 0),
    });
  }, []);

  const open = async () => {
    if (!(await s.ensure('post', currentReturnTo()))) return;
    const groups = feed?.groups || [];
    if (groups.length) {
      const i = groups.findIndex((g) => g.unseen > 0);
      setStart(i >= 0 ? i : 0);
      setScreen('viewer');
    } else {
      setScreen('camera');
    }
  };

  if (s.mode === 'off') return null;
  const groups = feed?.groups || [];
  const unseen = groups.reduce((n, g) => n + g.unseen, 0);
  const thumbs = groups.filter((g) => g.unseen > 0).slice(0, 2)
    .map((g) => (g.items.find((x) => !x.seen) || g.items[0]).media.thumb);
  const label = unseen ? `Моменты друзей: новых ${unseen}` : groups.length ? 'Моменты друзей' : 'Новый момент';

  return (
    <>
      {p.active && (
        <button type="button" className={'ie' + (p.hidden || screen ? ' is-hidden' : '')} aria-label={label} onClick={() => void open()}>
          {thumbs.length
            ? <span className="ie__stack">{thumbs.map((t) => <img key={t} className="sq" src={t} alt="" />)}</span>
            : <Icon name="plus" size={26} />}
          {unseen > 0 && <span className="ie__badge">{unseen}</span>}
        </button>
      )}
      {screen === 'camera' && (
        <InstantCamera onClose={() => setScreen(null)} onSent={() => void load()} onArchive={() => setScreen('archive')} />
      )}
      {screen === 'viewer' && feed && feed.groups.length > 0 && (
        <InstantViewer groups={feed.groups} start={Math.min(start, feed.groups.length - 1)} onClose={() => setScreen(null)}
          onCamera={() => setScreen('camera')} onUpdate={patch} onGone={gone} />
      )}
      {screen === 'archive' && <InstantsArchive onClose={() => setScreen(null)} onCamera={() => setScreen('camera')} />}
    </>
  );
}
