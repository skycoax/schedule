// Первый вход: имя, @имя и (по желанию) фото — так человека увидят в «Обсуждениях».
// Открывается сама только после #auth=ok, иначе — из ensure() или карточки «Заверши профиль» (AuthHost).
// Лист можно закрыть («Позже», «Назад», смахнуть) — тогда в «Профиле» останется карточка «Заверши профиль».
import { useEffect, useId, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Sheet } from '../../ui/Sheet';
import { Button } from '../../ui/Button';
import { isApiError, socialApi } from '../api';
import { useSession } from '../session';
import { Avatar } from '../ui/Avatar';
import {
  USERNAME_HINT, UsernameField, UsernameStatus, failText, fieldOf, isQuiet, nameError, unameOk, useAvatarPicker, useUsernameCheck,
} from './UsernameField';
import './profile.css';

interface Errors { name?: string; username?: string; avatar?: string; general?: string }

export function SetupSheet(p: { onDone: () => void; onLater: () => void }): JSX.Element {
  const s = useSession();
  const me = s.me;
  const titleId = useId();
  const nameId = useId();
  const unameStatusId = useId();
  const nameErrId = useId();

  const [name, setName] = useState(() => me?.name || '');
  const [username, setUsername] = useState(() => me?.suggestedUsername || '');
  const [avatar, setAvatar] = useState<{ id: string; preview: string } | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const check = useUsernameCheck(username, null);
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;
  const saved = useRef(false);

  // Уходим, не сохранив, — загруженное фото убираем (иначе сервер удалит его сам через сутки).
  useEffect(() => () => {
    const a = avatarRef.current;
    if (!a) return;
    URL.revokeObjectURL(a.preview);
    if (!saved.current) void socialApi.deleteMedia(a.id).catch(() => {});
  }, []);

  const picker = useAvatarPicker(async (img) => {
    setUploading(true);
    setErrors((e) => ({ ...e, avatar: undefined }));
    try {
      const up = await socialApi.uploadMedia(img, { kind: 'avatar' });
      const prev = avatarRef.current;
      if (prev) { URL.revokeObjectURL(prev.preview); void socialApi.deleteMedia(prev.id).catch(() => {}); }
      setAvatar({ id: up.id, preview: URL.createObjectURL(img.full) });
    } catch (e) {
      setErrors((x) => ({ ...x, avatar: failText(e) }));
    } finally {
      setUploading(false);
    }
  });

  const nameBad = nameError(name, s.config?.limits.name ?? 40);
  const canSave = !nameBad && !!username && unameOk(check) && check.kind !== 'idle' && !busy && !uploading;

  const nameRef = useRef<HTMLInputElement>(null);
  const unameRef = useRef<HTMLInputElement>(null);

  const save = async () => {
    setTouched(true);
    if (!canSave) {
      // Нажали «Продолжить» с ошибкой — ставим курсор туда, что нужно исправить.
      if (nameBad) nameRef.current?.focus();
      else if (!username || check.kind === 'bad') unameRef.current?.focus();
      return;
    }
    setBusy(true);
    setErrors({});
    try {
      const next = await socialApi.updateMe({
        name: name.trim(), username, ...(avatar ? { avatar: avatar.id } : {}),
      });
      saved.current = true;
      s.setMe(next);
      p.onDone();
    } catch (e) {
      if (isApiError(e, 'auth')) { p.onLater(); return; }
      const f = fieldOf(e);
      if (f && (f.field === 'name' || f.field === 'username' || f.field === 'avatar')) setErrors({ [f.field]: f.text });
      else if (!isQuiet(e)) setErrors({ general: failText(e) });   // ограничение и правила показывает сессия
      setBusy(false);
    }
  };

  const signOut = async () => {
    await s.signOut();
    p.onLater();
  };

  const shownNameErr = errors.name || (touched ? nameBad : null);

  return (
    <Sheet
      open onClose={p.onLater} variant="full" labelledBy={titleId} className="setup-sheet"
      left={<button type="button" className="setup__later" onClick={p.onLater}>Позже</button>}
      right={null}
    >
      <form className="setup" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
        <h2 className="setup__t" id={titleId}>Почти готово</h2>
        <p className="setup__sub">Так тебя увидят в обсуждениях.</p>

        <div className="setup__photo">
          <Avatar user={me ? { id: me.id, name: name.trim() || me.name, avatar: avatar?.preview || null } : null} size={88} />
          <button type="button" className="setup__photo-btn" onClick={picker.pick} disabled={uploading || busy}>
            {uploading ? 'Загружаю…' : avatar ? 'Изменить фото' : 'Добавить фото'}
          </button>
          {errors.avatar && <p className="setup__err" role="alert">{errors.avatar}</p>}
        </div>

        <div className="edit-group">
          <label className="edit-row" htmlFor={nameId}>
            <span className="edit-row__l">Имя</span>
            <input
              ref={nameRef} id={nameId} className="edit-row__in" type="text" value={name} autoComplete="given-name"
              enterKeyHint="next" aria-invalid={!!shownNameErr || undefined}
              aria-describedby={shownNameErr ? nameErrId : undefined}
              onChange={(e) => { setName(e.currentTarget.value); setErrors((x) => ({ ...x, name: undefined })); }}
              onBlur={() => setTouched(true)}
            />
          </label>
          <div className="edit-row">
            <UsernameField
              value={username} state={check} describedBy={unameStatusId} invalid={!!errors.username} inputRef={unameRef}
              onChange={(v) => { setUsername(v); setErrors((x) => ({ ...x, username: undefined })); }}
            />
          </div>
        </div>
        {shownNameErr && <p className="edit-err" id={nameErrId} role="alert">{shownNameErr}</p>}
        <UsernameStatus id={unameStatusId} state={check} serverError={errors.username}
          hint={!username ? USERNAME_HINT : null} />

        <p className="setup__note">Имя, имя пользователя и фото видят все в «Обсуждениях».</p>

        {errors.general && <p className="setup__err setup__err--general" role="alert">{errors.general}</p>}

        <div className="setup__acts">
          <Button type="submit" full size={50} busy={busy} disabled={check.kind === 'checking' || uploading}>
            Продолжить
          </Button>
          <Button full variant="plain" size={44} disabled={busy} onClick={() => void signOut()}>Выйти из аккаунта</Button>
        </div>
      </form>
      {picker.element}
    </Sheet>
  );
}
