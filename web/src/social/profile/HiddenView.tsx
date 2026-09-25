// Скрытые авторы (гость): список из этого телефона, без сети. «Показать снова» возвращает их посты в ленту.
import { useState } from 'react';
import type { JSX } from 'react';
import { NavBar, BackButton } from '../../shell/NavBar';
import { Button } from '../../ui/Button';
import { toast } from '../../ui/Toast';
import { hiddenUsers, unhideUser } from '../local';
import type { HiddenUser } from '../local';
import { Avatar } from '../ui/Avatar';
import { EmptyState } from '../ui/EmptyState';
import './profile.css';

export function HiddenView(p: { active: boolean; onBack: () => void }): JSX.Element {
  const [items, setItems] = useState<HiddenUser[]>(hiddenUsers);

  const show = (u: HiddenUser) => {
    unhideUser(u.id);
    setItems(hiddenUsers());
    toast(`Посты @${u.username} снова видны`);
  };

  return (
    <div className="wrap wrap--prof prof-screen">
      {p.active && <NavBar left={<BackButton onClick={p.onBack} />} title="Скрытые авторы" />}
      <p className="prof-lead">Их посты и ответы не показываются на этом телефоне.</p>
      {items.length ? (
        <ul className="frd-list">
          {items.map((u) => (
            <li key={u.id} className="frd-row">
              <span className="frd-row__main">
                <Avatar user={{ id: u.id, name: u.name, avatar: null }} size={44} />
                <span className="frd-row__txt">
                  <span className="frd-row__name"><span className="frd-row__name-t">{u.name}</span></span>
                  <span className="frd-row__sub">@{u.username}</span>
                </span>
              </span>
              <div className="frd-row__acts">
                <Button size={32} variant="tinted" onClick={() => show(u)}>Показать снова</Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="people" title="Скрытых авторов нет" />
      )}
    </div>
  );
}
