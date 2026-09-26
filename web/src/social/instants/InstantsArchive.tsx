// «Твои моменты» (как «Your instants» в Instagram): свои моменты за год — «На этой неделе», «В этом месяце»,
// дальше по месяцам; сетка суперэллипсов с реакциями. Нажатие — момент крупно: кто видел, какие реакции,
// «Удалить». Видно только автору.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { confirmDialog } from '../../ui/ActionSheet';
import { Icon } from '../../ui/icons';
import { Spinner } from '../../ui/Spinner';
import { toast } from '../../ui/Toast';
import { useHideTabBar } from '../../ui/bar';
import { useLayer } from '../../ui/layers';
import { socialApi } from '../api';
import { plural } from '../../lib/plural';
import type { InstantDetail, MyInstant } from '../types';
import { Avatar } from '../ui/Avatar';
import { errText } from '../chat/PostCard';
import { installSquircle } from './squircle';
import './instants.css';

const MONTH = new Intl.DateTimeFormat('ru', { month: 'long', year: 'numeric', timeZone: 'Asia/Tashkent' });
const WHEN = new Intl.DateTimeFormat('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' });

/** Раздел архива: эта неделя (с понедельника), этот месяц, дальше — месяц и год. */
function periodOf(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const week = new Date(now);
  week.setHours(0, 0, 0, 0);
  week.setDate(week.getDate() - ((week.getDay() + 6) % 7));
  if (d >= week) return 'На этой неделе';
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) return 'В этом месяце';
  const m = MONTH.format(d).replace(/\s*г\.$/, '');
  return m.charAt(0).toUpperCase() + m.slice(1);
}

const total = (x: MyInstant) => x.reactions.reduce((n, r) => n + r.count, 0);

function Detail(p: { item: MyInstant; onBack: () => void; onDeleted: (id: number) => void }): JSX.Element {
  const [d, setD] = useState<InstantDetail | null>(null);
  const [busy, setBusy] = useState(false);
  useLayer(true, p.onBack, 'instant-detail');
  useEffect(() => {
    const c = new AbortController();
    socialApi.instant(p.item.id, c.signal).then(setD, () => {});
    return () => c.abort();
  }, [p.item.id]);
  const del = async () => {
    const ok = await confirmDialog({ title: 'Удалить момент?', message: 'Он пропадёт у друзей и из твоего архива.', confirm: 'Удалить', destructive: true });
    if (!ok) return;
    setBusy(true);
    try {
      await socialApi.deleteInstant(p.item.id);
      toast('Момент удалён');
      p.onDeleted(p.item.id);
    } catch (e) {
      setBusy(false);
      toast(errText(e), { kind: 'error' });
    }
  };
  const views = d ? d.views : p.item.views;
  return (
    <>
      <div className="ix__bar">
        <button type="button" className="ix__icon" aria-label="Назад" onClick={p.onBack}><Icon name="back" size={24} /></button>
        <h2 className="ix__title">{WHEN.format(Date.parse(p.item.createdAt))}</h2>
        <span />
      </div>
      <div className="ia__det">
        <div className="ix__frame sq">{p.item.media && <img src={p.item.media.url} alt="Момент" />}</div>
        <p className="ia__stats">
          {p.item.active ? 'Сейчас видят друзья' : 'Друзья больше не видят'} · {views} {plural(views, ['просмотр', 'просмотра', 'просмотров'])}
          {p.item.hidden ? ' · скрыт после жалобы' : ''}
        </p>
        {d && d.viewers && d.viewers.length > 0 && (
          <ul className="ia__viewers">
            {d.viewers.map((v) => (
              <li key={v.user.id} className="ia__viewer">
                <Avatar user={v.user} size={36} />
                <span className="ia__viewer-n">{v.user.name}</span>
                {v.reaction && <span className="ia__viewer-r" aria-label={'Реакция ' + v.reaction}>{v.reaction}</span>}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="ia__del" disabled={busy} onClick={() => void del()}>Удалить момент</button>
      </div>
    </>
  );
}

export function InstantsArchive(p: { onClose: () => void; onCamera?: () => void }): JSX.Element {
  installSquircle();
  useLayer(true, p.onClose, 'instant-archive');
  useHideTabBar(true, 'instant');
  const [items, setItems] = useState<MyInstant[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<MyInstant | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    if (cursor) setMore(true); else setState('loading');
    try {
      const pg = await socialApi.myInstants(cursor, c.signal);
      if (c.signal.aborted) return;
      setItems((l) => (cursor ? [...l, ...pg.items.filter((x) => !l.some((y) => y.id === x.id))] : pg.items));
      setNext(pg.next);
      setState('ready');
    } catch {
      if (!c.signal.aborted && !cursor) setState('error');
    } finally {
      if (!c.signal.aborted) setMore(false);
    }
  }, []);
  useEffect(() => { void load(null); return () => ctrl.current?.abort(); }, [load]);

  const sections = useMemo(() => {
    const out: { title: string; items: MyInstant[] }[] = [];
    for (const x of items) {
      const t = periodOf(x.createdAt);
      if (!out.length || out[out.length - 1].title !== t) out.push({ title: t, items: [] });
      out[out.length - 1].items.push(x);
    }
    return out;
  }, [items]);

  return createPortal(
    <div className="ix ia" role="dialog" aria-modal="true" aria-label="Твои моменты">
      {open ? (
        <Detail item={open} onBack={() => setOpen(null)}
          onDeleted={(id) => { setItems((l) => l.filter((x) => x.id !== id)); setOpen(null); }} />
      ) : (
        <>
          <div className="ix__bar">
            <button type="button" className="ix__icon" aria-label="Закрыть" onClick={p.onClose}><Icon name="back" size={24} /></button>
            <h2 className="ix__title">Твои моменты</h2>
            {p.onCamera
              ? <button type="button" className="ix__icon" aria-label="Новый момент" onClick={p.onCamera}><Icon name="camera" size={24} /></button>
              : <span />}
          </div>
          <div className="ia__body">
            {state === 'loading' && <div className="ia__more"><Spinner size={24} /></div>}
            {state === 'error' && <p className="ia__empty">Не удалось загрузить моменты.</p>}
            {state === 'ready' && !items.length && (
              <p className="ia__empty">Здесь будут твои моменты — снимки, которые сутки видят друзья. Хранятся год.</p>
            )}
            {sections.map((sec) => (
              <section key={sec.title}>
                <h3 className="ia__sec">{sec.title}</h3>
                <div className="ia__grid">
                  {sec.items.map((x) => (
                    <button key={x.id} type="button" className="ia__cell sq" aria-label={'Момент ' + WHEN.format(Date.parse(x.createdAt))}
                      onClick={() => setOpen(x)}>
                      {x.media && <img src={x.media.thumb} alt="" loading="lazy" decoding="async" />}
                      {total(x) > 0 && <span className="ia__react">{x.reactions[0].emoji} {total(x)}</span>}
                      {x.active && <span className="ia__live">сейчас</span>}
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {next && (
              <div className="ia__more">
                {more ? <Spinner size={22} /> : (
                  <button type="button" className="ic__btn" onClick={() => void load(next)}>Показать ещё</button>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
