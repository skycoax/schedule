// «Как играть»: правила холдема в трёх абзацах и старшинство рук с примерами карт.
import { useId } from 'react';
import type { JSX } from 'react';
import { Sheet } from '../ui/Sheet';
import { PlayingCard } from './Card';

const HANDS: { name: string; cards: string[]; note: string }[] = [
  { name: 'Роял-флеш', cards: ['As', 'Ks', 'Qs', 'Js', 'Ts'], note: 'от десятки до туза одной масти' },
  { name: 'Стрит-флеш', cards: ['9h', '8h', '7h', '6h', '5h'], note: 'пять по порядку одной масти' },
  { name: 'Каре', cards: ['Qd', 'Qs', 'Qh', 'Qc', '4s'], note: 'четыре одинаковых' },
  { name: 'Фулл-хаус', cards: ['Jc', 'Jd', 'Jh', '8s', '8d'], note: 'тройка и пара' },
  { name: 'Флеш', cards: ['Kc', 'Tc', '7c', '5c', '2c'], note: 'пять одной масти' },
  { name: 'Стрит', cards: ['8d', '7s', '6h', '5c', '4d'], note: 'пять по порядку' },
  { name: 'Тройка', cards: ['7h', '7d', '7s', 'Kd', '2c'], note: 'три одинаковых' },
  { name: 'Две пары', cards: ['Ad', 'As', '9h', '9c', '5s'], note: '' },
  { name: 'Пара', cards: ['Th', 'Td', 'Ks', '6c', '3d'], note: '' },
  { name: 'Старшая карта', cards: ['Ah', 'Jd', '8s', '5c', '2h'], note: 'ничего не собралось' },
];

export function HowToSheet(p: { open: boolean; onClose: () => void }): JSX.Element {
  const id = useId();
  return (
    <Sheet open={p.open} onClose={p.onClose} variant="bottom" detent="large" labelledBy={id} right={null}>
      <div className="pk-how">
        <h2 id={id} className="pk-how__h">Как играть</h2>
        <p>Каждому — две карты. На стол по очереди выходят пять общих: три, потом одна и ещё одна. Собери лучшую
          пятёрку из своих двух и пяти общих.</p>
        <p>Круг торговли — после каждой сдачи. <b>Чек</b> — пропустить, если никто не ставил. <b>Уравнять</b> — поставить
          столько же, сколько соперник. <b>Поднять</b> — поставить больше. <b>Сбросить</b> — выйти из раздачи. На ход — 20 секунд.</p>
        <p>Остался один — банк его. Дошли до вскрытия — банк у сильнейшей руки. Если за столом больше никого, с тобой
          играет Para — бот приложения.</p>
        <p><b>Фишки.</b> У каждого свой счёт, в начале — 1 000. Каждый день в игре ждёт бонус: 500, а если заходить
          подряд — больше, до 1 200 на седьмой день. Проиграл всё — новые фишки завтра. Фишки игровые: их не купить
          и не вывести.</p>
        <h3 className="pk-how__h3">Старшинство рук</h3>
        <ol className="pk-how__list">
          {HANDS.map((h) => (
            <li key={h.name} className="pk-how__row">
              <div className="pk-how__cards" aria-hidden="true">
                {h.cards.map((c) => <PlayingCard key={c} card={c} size="sm" up />)}
              </div>
              <div className="pk-how__t"><b>{h.name}</b>{h.note && <span>{h.note}</span>}</div>
            </li>
          ))}
        </ol>
      </div>
    </Sheet>
  );
}
