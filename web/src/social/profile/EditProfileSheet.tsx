// Изменить профиль: имя, @имя, «О себе», Telegram, Instagram и «Мой вуз». «Готово» отправляет только
// изменённые поля (PATCH /api/social/me). Фото меняется сразу, отдельно от «Готово» (как в ux.md §6.5).
// Лист — сам себе слой истории: «Назад» с несохранёнными правками спрашивает, выбросить ли их.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { JSX, KeyboardEvent } from 'react';
import { getUniversities } from '../../api';
import type { University } from '../../api';
import { Sheet } from '../../ui/Sheet';
import { chooseAction, confirmDialog } from '../../ui/ActionSheet';
import { toast } from '../../ui/Toast';
import { Icon } from '../../ui/icons';
import { pushLayer } from '../../ui/layers';
import { Spinner } from '../../ui/Spinner';
import { socialApi } from '../api';
import { textLength } from '../format';
import { useSession } from '../session';
import type { MePatch } from '../types';
import { Avatar } from '../ui/Avatar';
import {
  UsernameField, UsernameStatus, failText, fieldOf, isQuiet, nameError, toastFail, unameOk, useAvatarPicker, useUsernameCheck,
} from './UsernameField';
import './profile.css';

// ─── Telegram и Instagram: принимаем ссылку или @имя, храним имя (как сервер, §B.4) ───

export function normTg(raw: string): string {
  let v = raw.trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/@?([^/?#\s]*)/i.exec(v);
  if (m) v = m[1];
  return v.replace(/^@+/, '').toLowerCase();
}

export function normIg(raw: string): string {
  let v = raw.trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?instagram\.com\/@?([^/?#\s]*)/i.exec(v);
  if (m) v = m[1];
  return v.replace(/^@+/, '').toLowerCase();
}

const TG_TEXT = 'Telegram: укажи имя пользователя, например @username';
const IG_TEXT = 'Instagram: укажи имя пользователя, например @username';
const tgError = (v: string) => (!v || /^[a-z][a-z0-9_]{4,31}$/.test(v) ? null : TG_TEXT);
const igError = (v: string) =>
  (!v || (/^[a-z0-9._]{1,30}$/.test(v) && !v.startsWith('.') && !v.endsWith('.') && !v.includes('..')) ? null : IG_TEXT);

let unisCache: University[] | null = null;

let fmtDay: Intl.DateTimeFormat | null = null;
function dayMonth(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  fmtDay ??= new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Tashkent', day: 'numeric', month: 'long' });
  return fmtDay.format(t);
}

interface Form { name: string; username: string; bio: string; tg: string; ig: string; uni: string }
type Field = keyof Form;
type Errors = Partial<Record<Field | 'general', string>>;

export function EditProfileSheet(p: { open: boolean; onClose: () => void }): JSX.Element | null {
  const s = useSession();
  const me = s.me;
  const limits = s.config?.limits;
  const bioMax = limits?.bio ?? 160;
  const nameMax = limits?.name ?? 40;

  const ids = { name: useId(), bio: useId(), tg: useId(), ig: useId(), uname: useId() };
  const [init, setInit] = useState<Form | null>(null);
  const [f, setF] = useState<Form>({ name: '', username: '', bio: '', tg: '', ig: '', uni: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [unis, setUnis] = useState<University[] | null>(unisCache);
  const [gen, setGen] = useState(0);

  // Открыли — берём профиль как есть.
  useEffect(() => {
    if (!p.open || !me) return;
    const start: Form = {
      name: me.name, username: me.username || '', bio: me.bio, tg: me.links.tg, ig: me.links.ig, uni: me.uni || '',
    };
    setInit(start);
    setF(start);
    setErrors({});
    setTouched({});
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.open]);

  const check = useUsernameCheck(f.username, init?.username || null);

  const local: Errors = {
    name: nameError(f.name, nameMax) || undefined,
    bio: textLength(f.bio) > bioMax || f.bio.length > bioMax * 4 ? `О себе — не больше ${bioMax} символов` : undefined,
    tg: tgError(f.tg) || undefined,
    ig: igError(f.ig) || undefined,
  };
  const changed = useMemo(() => {
    const out: MePatch = {};
    if (!init) return out;
    if (f.name.trim() !== init.name) out.name = f.name.trim();
    if (f.username !== init.username) out.username = f.username;
    if (f.bio !== init.bio) out.bio = f.bio;
    if (f.tg !== init.tg) out.tg = f.tg;
    if (f.ig !== init.ig) out.ig = f.ig;
    if (f.uni !== init.uni) out.uni = f.uni;
    return out;
  }, [f, init]);
  const dirty = Object.keys(changed).length > 0;
  const valid = !local.name && !local.bio && !local.tg && !local.ig && !!f.username && unameOk(check) && check.kind !== 'checking';

  const set = (k: Field, v: string) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined, general: undefined }));
  };
  const touch = (k: Field) => setTouched((t) => ({ ...t, [k]: true }));
  const shown = (k: Field) => errors[k] || (touched[k] ? local[k] : undefined);

  const busyRef = useRef(busy);
  busyRef.current = busy;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const cancel = async (fromBack: boolean) => {
    if (busyRef.current) { if (fromBack) setGen((g) => g + 1); return; }
    if (!dirtyRef.current) { p.onClose(); return; }
    const drop = await confirmDialog({
      title: 'Отменить изменения?', confirm: 'Отменить изменения', destructive: true, cancel: 'Продолжить редактирование',
    });
    if (drop) p.onClose();
    else if (fromBack) setGen((g) => g + 1);
  };
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;

  // Свой слой истории (а не у Sheet): после «Назад» и «Продолжить редактирование» кладём его снова.
  useEffect(() => {
    if (!p.open) return;
    let popped = false;
    const close = pushLayer('sheet', () => { popped = true; void cancelRef.current(true); });
    return () => { if (!popped) void close(); };
  }, [p.open, gen]);

  const save = async () => {
    setTouched({ name: true, bio: true, tg: true, ig: true, username: true });
    if (!dirty || !valid || busy) return;
    setBusy(true);
    try {
      const next = await socialApi.updateMe(changed);
      s.setMe(next);
      toast('Сохранено');
      p.onClose();
    } catch (e) {
      const fe = fieldOf(e);
      if (fe && fe.field in f) setErrors({ [fe.field]: fe.text });
      else if (!isQuiet(e)) setErrors({ general: failText(e) });   // вход, ограничение, правила — покажет сессия
    } finally {
      setBusy(false);
    }
  };

  const picker = useAvatarPicker(async (img) => {
    setPhotoBusy(true);
    try {
      const next = await socialApi.setAvatar(img);
      s.setMe(next);
      toast('Фото обновлено');
    } catch (e) {
      toastFail(e);
      throw e;
    } finally {
      setPhotoBusy(false);
    }
  });

  const photoMenu = async () => {
    if (!me?.avatar) { picker.pick(); return; }
    const a = await chooseAction({
      actions: [{ id: 'pick', label: 'Выбрать фото' }, { id: 'del', label: 'Удалить фото', role: 'destructive' }],
    });
    if (a === 'pick') picker.pick();
    else if (a === 'del') {
      setPhotoBusy(true);
      try {
        s.setMe(await socialApi.removeAvatar());
        toast('Фото удалено');
      } catch (e) {
        toastFail(e);
      } finally {
        setPhotoBusy(false);
      }
    }
  };

  const pickUni = async () => {
    let list = unis;
    if (!list) {
      try {
        list = await getUniversities();
        unisCache = list;
        setUnis(list);
      } catch (e) {
        toast(navigator.onLine ? failText(e) : 'Нет интернета', { kind: 'error' });
        return;
      }
    }
    const id = await chooseAction({
      title: 'Мой вуз',
      actions: [
        ...list.map((u) => ({ id: 'u:' + u.id, label: u.short })),
        { id: 'none', label: 'Не показывать' },
      ],
    });
    if (id === 'none') set('uni', '');
    else if (id && id.startsWith('u:')) set('uni', id.slice(2));
  };

  if (!p.open || !me) return null;

  const uniLabel = !f.uni ? 'Не указан'
    : f.uni === init?.uni && me.uniShort ? me.uniShort
      : unis?.find((u) => u.id === f.uni)?.short || f.uni;
  const bioLeft = bioMax - textLength(f.bio);
  const nextChange = me.usernameNextChange && Date.parse(me.usernameNextChange) > Date.now()
    ? `@имя можно будет сменить с ${dayMonth(me.usernameNextChange)}` : null;

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { e.stopPropagation(); void cancel(false); }
  };

  return (
    <Sheet
      open onClose={() => void cancel(false)} variant="full" title="Профиль" dismissible={false} className="edit-sheet"
      left={<button type="button" className="edit__bar-btn" onClick={() => void cancel(false)}>Отмена</button>}
      right={
        <button type="button" className="edit__bar-btn edit__bar-btn--done" onClick={() => void save()}
          disabled={!dirty || !valid || busy} aria-busy={busy || undefined}>
          {busy ? <Spinner size={18} /> : 'Готово'}
        </button>
      }
    >
      <div className="edit" onKeyDown={onKey}>
        <div className="edit__photo">
          <Avatar user={me} size={96} />
          <button type="button" className="edit__photo-btn" onClick={() => void photoMenu()} disabled={photoBusy}
            aria-haspopup={me.avatar ? 'menu' : undefined}>
            {photoBusy ? 'Загружаю…' : 'Изменить фото'}
          </button>
        </div>

        {errors.general && <p className="edit-err edit-err--general" role="alert">{errors.general}</p>}

        <div className="edit-group">
          <label className="edit-row" htmlFor={ids.name}>
            <span className="edit-row__l">Имя</span>
            <input id={ids.name} className="edit-row__in" type="text" value={f.name} autoComplete="name"
              aria-invalid={!!shown('name') || undefined} onBlur={() => touch('name')}
              onChange={(e) => set('name', e.currentTarget.value)} />
          </label>
          <div className="edit-row">
            <UsernameField value={f.username} state={check} describedBy={ids.uname} invalid={!!errors.username}
              onChange={(v) => { set('username', v); touch('username'); }} />
          </div>
        </div>
        {shown('name') && <p className="edit-err" role="alert">{shown('name')}</p>}
        <UsernameStatus id={ids.uname} state={check} serverError={errors.username} hint={nextChange} />

        <h3 className="edit-h"><label htmlFor={ids.bio}>О себе</label></h3>
        <div className="edit-group edit-group--bio">
          <textarea id={ids.bio} className="edit-bio" rows={3} value={f.bio} placeholder="Пара слов о себе"
            aria-invalid={!!shown('bio') || undefined} onBlur={() => touch('bio')}
            onChange={(e) => { set('bio', e.currentTarget.value); touch('bio'); }} />
          {bioLeft <= 40 && (
            <span className={'edit-count' + (bioLeft < 0 ? ' is-over' : '')} aria-live="polite">{bioLeft}</span>
          )}
        </div>
        {shown('bio') && <p className="edit-err" role="alert">{shown('bio')}</p>}

        <h3 className="edit-h">Ссылки</h3>
        <div className="edit-group">
          <label className="edit-row" htmlFor={ids.tg}>
            <span className="edit-row__l">Telegram</span>
            <span className="edit-row__pre" aria-hidden="true">t.me/</span>
            <input id={ids.tg} className="edit-row__in" type="text" value={f.tg} placeholder="username"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url"
              aria-invalid={!!shown('tg') || undefined} onBlur={() => touch('tg')}
              onChange={(e) => set('tg', normTg(e.currentTarget.value))} />
          </label>
          <label className="edit-row" htmlFor={ids.ig}>
            <span className="edit-row__l">Instagram</span>
            <span className="edit-row__pre" aria-hidden="true">instagram.com/</span>
            <input id={ids.ig} className="edit-row__in" type="text" value={f.ig} placeholder="username"
              autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="url"
              aria-invalid={!!shown('ig') || undefined} onBlur={() => touch('ig')}
              onChange={(e) => set('ig', normIg(e.currentTarget.value))} />
          </label>
        </div>
        {shown('tg') && <p className="edit-err" role="alert">{shown('tg')}</p>}
        {shown('ig') && <p className="edit-err" role="alert">{shown('ig')}</p>}
        <p className="edit-foot">
          {me.privacy.links === 'signed' ? 'Видны всем, кто вошёл.' : 'Видны только друзьям.'} Изменить — в «Конфиденциальности».
        </p>

        <div className="edit-group edit-group--uni">
          <button type="button" className="edit-row edit-row--btn" onClick={() => void pickUni()} aria-haspopup="menu">
            <span className="edit-row__l edit-row__l--wide">Мой вуз</span>
            <span className="edit-row__val">{uniLabel}</span>
            <Icon name="chevronRight" size={16} className="edit-row__chev" />
          </button>
        </div>
        {errors.uni && <p className="edit-err" role="alert">{errors.uni}</p>}
        <p className="edit-foot">Виден только тем, кто вошёл.</p>
      </div>
      {picker.element}
    </Sheet>
  );
}
