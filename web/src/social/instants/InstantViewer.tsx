// Просмотр моментов друзей: полоски сверху, автор и время, фото в форме суперэллипса, касание справа/слева —
// следующий/предыдущий, внизу реакции (как Instants в Instagram). Открытый момент отмечается просмотренным.
// «•••» — пожаловаться; «+» — снять свой момент.
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { chooseAction } from '../../ui/ActionSheet';
import { Icon } from '../../ui/icons';
import { toast } from '../../ui/Toast';
import { useHideTabBar } from '../../ui/bar';
import { useLayer } from '../../ui/layers';
import { useSocialActions } from '../actions';
import { socialApi } from '../api';
import { relTime } from '../format';
import { INSTANT_REACTIONS } from '../types';
import type { FriendInstant, InstantGroup, InstantReaction } from '../types';
import { Avatar } from '../ui/Avatar';
import { errText, handledBySession } from '../chat/PostCard';
import { installSquircle } from './squircle';
import './instants.css';

const firstUnseen = (g: InstantGroup | undefined) => {
  if (!g) return 0;
  const i = g.items.findIndex((x) => !x.seen);
  return i >= 0 ? i : 0;
};

export function InstantViewer(p: {
  groups: InstantGroup[];
  start: number;
  onClose: () => void;
  onCamera: () => void;
  onUpdate: (instantId: number, patch: Partial<FriendInstant>) => void;
  onGone: (instantId: number) => void;
}): JSX.Element | null {
  installSquircle();
  useLayer(true, p.onClose, 'instant-viewer');
  useHideTabBar(true, 'instant');
  const actions = useSocialActions();
  const [gi, setGi] = useState(p.start);
  const [ii, setIi] = useState(() => firstUnseen(p.groups[p.start]));
  const [pop, setPop] = useState<{ e: string; k: number } | null>(null);
  const g = p.groups[gi];
  const it = g ? g.items[Math.min(ii, g.items.length - 1)] : undefined;

  // Открыли — «просмотрено» (сервер и список у края).
  useEffect(() => {
    if (!it || it.seen) return;
    p.onUpdate(it.id, { seen: true });
    socialApi.viewInstant(it.id).catch(() => {});
  }, [it?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = () => {
    if (!g) return;
    if (ii < g.items.length - 1) setIi(ii + 1);
    else if (gi < p.groups.length - 1) { setGi(gi + 1); setIi(firstUnseen(p.groups[gi + 1])); }
    else p.onClose();
  };
  const prev = () => {
    if (ii > 0) setIi(ii - 1);
    else if (gi > 0) { setGi(gi - 1); setIi(p.groups[gi - 1].items.length - 1); }
  };

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  if (!g || !it) return null;

  const react = async (emoji: InstantReaction) => {
    const was = it.reaction;
    const want = was === emoji ? null : emoji;
    p.onUpdate(it.id, { reaction: want });
    if (want) setPop({ e: want, k: Date.now() });
    try {
      await socialApi.reactInstant(it.id, want);
    } catch (e) {
      p.onUpdate(it.id, { reaction: was });
      if (!handledBySession(e)) toast(errText(e), { kind: 'error' });
    }
  };

  const menu = async () => {
    const a = await chooseAction({ actions: [{ id: 'report', label: 'Пожаловаться', role: 'destructive' }] });
    if (a !== 'report') return;
    const r = await actions.report({ type: 'instant', id: it.id }, { username: g.author.username, kind: 'instant' });
    if (r) { p.onGone(it.id); next(); }
  };

  return createPortal(
    <div className="ix iv" role="dialog" aria-modal="true" aria-label={'Моменты: ' + g.author.name}>
      <div className="iv__bars" aria-hidden="true">
        {g.items.map((x, k) => <i key={x.id} className={k < ii ? 'is-done' : k === ii ? 'is-on' : ''} />)}
      </div>
      <div className="iv__top">
        <div className="iv__who">
          <Avatar user={g.author} size={32} />
          <span className="iv__name">{g.author.name}</span>
          <span className="iv__time">{relTime(it.createdAt)}</span>
        </div>
        <button type="button" className="ix__icon" aria-label="Снять свой момент" onClick={p.onCamera}><Icon name="plus" size={22} /></button>
        <button type="button" className="ix__icon" aria-label="Ещё" aria-haspopup="menu" onClick={() => void menu()}><Icon name="ellipsis" size={22} /></button>
        <button type="button" className="ix__icon" aria-label="Закрыть" onClick={p.onClose}><Icon name="close" size={24} /></button>
      </div>
      <div className="iv__stage">
        <div className="ix__frame sq">
          <img key={it.id} src={it.media.url} alt={'Момент ' + g.author.name} />
        </div>
        <button type="button" className="iv__nav iv__nav--prev" aria-label="Предыдущий" onClick={prev} />
        <button type="button" className="iv__nav iv__nav--next" aria-label="Следующий" onClick={next} />
        {pop && <span key={pop.k} className="iv__pop" aria-hidden="true" onAnimationEnd={() => setPop(null)}>{pop.e}</span>}
      </div>
      <div className="iv__reacts" role="group" aria-label="Реакция">
        {INSTANT_REACTIONS.map((e) => (
          <button key={e} type="button" className={'iv__r' + (it.reaction === e ? ' is-on' : '')} aria-pressed={it.reaction === e}
            aria-label={'Реакция ' + e} onClick={() => void react(e)}>{e}</button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
