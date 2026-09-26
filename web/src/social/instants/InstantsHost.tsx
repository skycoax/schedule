// Моменты в «Обсуждениях»: карточка у правого края (как в Instagram — «+», а когда есть моменты друзей и людей
// из вуза — фото на всю карточку, сначала непросмотренное), камера, просмотр моментов и архив «Твои моменты».
// Моменты грузятся, пока вкладка видна: сразу и раз в минуту, после своего момента — заново.
// Анимации: из карточки экран «вырастает» и в неё же уходит; камера выезжает снизу, архив — справа;
// между экранами под ними чёрная подложка, чтобы лента не мигала.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../ui/icons';
import { socialApi } from '../api';
import { currentReturnTo, useSession } from '../session';
import type { FriendInstant, InstantsFeed } from '../types';
import { InstantCamera } from './InstantCamera';
import { InstantViewer } from './InstantViewer';
import { InstantsArchive } from './InstantsArchive';
import { installSquircle } from './squircle';
import { ixMotion, setIxOrigin, useLeave } from './motion';
import type { IxAnim } from './motion';
import './instants.css';

type Screen = null | 'camera' | 'viewer' | 'archive';

export function InstantsHost(p: { active: boolean; hidden?: boolean }): JSX.Element | null {
  installSquircle();
  const s = useSession();
  const [feed, setFeed] = useState<InstantsFeed | null>(null);
  const [screen, setScreen] = useState<Screen>(null);
  const [start, setStart] = useState(0);
  const [anim, setAnim] = useState<IxAnim>('zoom');
  const [back, setBack] = useState<Screen>(null);   // куда вернуться из архива («Назад»), если пришли из камеры
  const card = useRef<HTMLButtonElement>(null);
  const [leaving, closeAll] = useLeave(() => { setScreen(null); setBack(null); });
  const go = (next: Exclude<Screen, null>, a: IxAnim, from: Screen = null) => { setAnim(a); setBack(from); setScreen(next); };
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
    setIxOrigin(card.current);
    const groups = feed?.groups || [];
    if (groups.length) {
      const i = groups.findIndex((g) => g.unseen > 0);
      setStart(i >= 0 ? i : 0);
      go('viewer', 'zoom');
    } else {
      go('camera', 'zoom');
    }
  };

  if (s.mode === 'off') return null;
  const groups = feed?.groups || [];
  const unseen = groups.reduce((n, g) => n + g.unseen, 0);
  const first = groups.find((g) => g.unseen > 0) || groups[0];
  const cover = first ? (first.items.find((x) => !x.seen) || first.items[first.items.length - 1]).media.thumb : null;
  const label = unseen ? `Моменты: новых ${unseen}` : groups.length ? 'Моменты' : 'Новый момент';
  const motion = ixMotion(anim, leaving);

  return (
    <>
      {p.active && (
        <button ref={card} type="button" className={'ie' + (cover ? ' has-photo' : '') + (p.hidden || screen ? ' is-hidden' : '')}
          aria-label={label} onClick={() => void open()}>
          {cover ? <img className="ie__img" src={cover} alt="" /> : <Icon name="plus" size={26} />}
        </button>
      )}
      {screen && createPortal(<div className={'ix-shade' + (leaving ? ' is-leaving' : '')} aria-hidden="true" />, document.body)}
      {screen === 'camera' && (
        <InstantCamera motion={motion} onClose={closeAll} onSent={() => void load()} onArchive={() => go('archive', 'push', 'camera')} />
      )}
      {screen === 'viewer' && feed && feed.groups.length > 0 && (
        <InstantViewer motion={motion} groups={feed.groups} start={Math.min(start, feed.groups.length - 1)} onClose={closeAll}
          onCamera={() => go('camera', 'up')} onUpdate={patch} onGone={gone} />
      )}
      {screen === 'archive' && (
        <InstantsArchive motion={motion} onClose={back === 'camera' ? () => go('camera', 'back') : closeAll}
          onCamera={() => go('camera', 'up')} />
      )}
    </>
  );
}
