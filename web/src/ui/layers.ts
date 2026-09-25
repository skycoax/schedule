// Кнопка «Назад» (Android, браузер) для листов и вложенных экранов. Одна история на всё приложение (D29).
// Каждый слой — запись history.pushState с тем же адресом: { paraLayer: key, depth: n }.
// Все операции с историей (push, back, go) идут через одну очередь: операция, после которой браузер
// шлёт popstate, ждёт его (или 1000 мс), и только потом выполняется следующая. Так «закрыть лист и
// сразу открыть подтверждение» не ломает историю (CONTRACT.md §E.2, правила layers.ts 1–7).
import { useEffect, useRef } from 'react';

interface Layer {
  key: number;
  id: string;
  onPop: () => void;
  /** Запись уже в истории (push выполнен). Ещё не выполненные слои всегда лежат наверху стека. */
  pushed: boolean;
  /** Закрыт интерфейсом, back для него поставлен в очередь (из стека уже убран). */
  closing: boolean;
  /** Закрыт, когда лежал не наверху: запись уберём, когда он окажется сверху. */
  dead: boolean;
  /** Убран из стека. */
  gone: boolean;
}

type Op = () => void | Promise<void>;

const stack: Layer[] = [];
const queue: Op[] = [];
// Ключи уникальны и между перезагрузками: запись чужой (прошлой) загрузки страницы узнаём по ключу.
let seq = Math.floor(Math.random() * 2 ** 40);
const own = new Set<number>();
let running = false;
let waiter: (() => void) | null = null;
let idle: Array<() => void> = [];

const WAIT_MS = 1000;
const hasWindow = typeof window !== 'undefined' && typeof history !== 'undefined';

function pump() {
  if (running) return;
  const op = queue.shift();
  if (!op) {
    const w = idle; idle = [];
    w.forEach((f) => f());
    return;
  }
  running = true;
  let r: void | Promise<void>;
  try { r = op(); } catch { r = undefined; }
  const done = () => { running = false; pump(); };
  Promise.resolve(r).then(done, done);
}

function enqueue(op: Op) {
  queue.push(op);
  pump();
}

/** back/go: ждём своего popstate (или 1000 мс, если браузер его не прислал). */
function travel(fn: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let timer = 0;
    const finish = () => {
      clearTimeout(timer);
      if (waiter === finish) waiter = null;
      resolve();
    };
    waiter = finish;
    timer = window.setTimeout(finish, WAIT_MS);
    try { fn(); } catch { finish(); }
  });
}

const pushedCount = () => {
  let n = 0;
  for (const l of stack) if (l.pushed) n++;
  return n;
};

/** Закрытый «под другими» слой, оказавшийся сверху, убираем ещё одним back. */
function cleanupDead() {
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (!top.dead || !top.pushed) break;
    stack.pop();
    top.gone = true;
    enqueue(() => travel(() => history.back()));
  }
}

function onPopState(ev: PopStateEvent) {
  const st = ev.state as { paraLayer?: unknown; depth?: unknown } | null;
  const depthOf = st && typeof st.depth === 'number' && st.depth > 0 ? Math.floor(st.depth) : 0;
  // Запись слоя из прошлой загрузки страницы (перезагрузили с открытым листом): она всегда ниже
  // наших записей. Значит, «Назад» ушёл ниже всех наших слоёв; потом пропускаем и её слои.
  const stale = !!st && typeof st.paraLayer === 'number' && !own.has(st.paraLayer) && depthOf > 0;
  const target = stale ? 0 : depthOf;
  let pushed = pushedCount();
  // Снимаем верхние слои, пока их больше, чем записей в истории: закрытые — молча, остальные — через onPop.
  while (pushed > target) {
    const i = pushed - 1;
    const l = stack[i];
    stack.splice(i, 1);
    pushed--;
    l.gone = true;
    if (!l.closing && !l.dead) {
      try { l.onPop(); } catch { /* закрытие слоя не должно ломать историю */ }
    }
  }
  const w = waiter;
  if (w) w();
  else if (stale) enqueue(() => travel(() => history.go(-depthOf)));
  else if (target > pushed) {
    // «Вперёд» в запись слоя, которого уже нет, — возвращаемся.
    const n = target - pushed;
    enqueue(() => travel(() => history.go(-n)));
  }
  cleanupDead();
}

if (hasWindow) window.addEventListener('popstate', onPopState);

/** Открыть слой. Возвращает close(): закрыть его из интерфейса (onPop при этом не вызывается).
 *  Промис close() выполняется, когда запись слоя убрана из истории. */
export function pushLayer(id: string, onPop: () => void): () => Promise<void> {
  const layer: Layer = { key: ++seq, id, onPop, pushed: false, closing: false, dead: false, gone: false };
  own.add(layer.key);
  stack.push(layer);
  if (hasWindow) {
    enqueue(() => {
      if (layer.gone) return;
      const depthNow = stack.indexOf(layer) + 1;
      history.pushState({ paraLayer: layer.key, depth: depthNow }, '');
      layer.pushed = true;
    });
  }
  let closed: Promise<void> | null = null;
  return () => {
    if (closed) return closed;
    if (layer.gone) return (closed = Promise.resolve());
    const i = stack.indexOf(layer);
    if (!layer.pushed) {
      // Запись ещё не добавлена — просто не добавляем её.
      stack.splice(i, 1);
      layer.gone = true;
      return (closed = Promise.resolve());
    }
    if (i === stack.length - 1) {
      layer.closing = true;
      stack.splice(i, 1);
      layer.gone = true;
      closed = new Promise<void>((resolve) => {
        enqueue(() => travel(() => history.back()).then(resolve));
      });
      cleanupDead();
      return closed;
    }
    layer.dead = true;
    return (closed = Promise.resolve());
  };
}

/** Слой, пока open === true. «Назад» → onClose. Закрыли из интерфейса (open → false) — запись снимается сама.
 *  id по умолчанию 'sheet'. */
export function useLayer(open: boolean, onClose: () => void, id = 'sheet'): void {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    if (!open) return;
    let popped = false;
    const close = pushLayer(id, () => { popped = true; ref.current(); });
    return () => { if (!popped) void close(); };
  }, [open, id]);
}

/** Сколько слоёв сейчас открыто (= записей истории, которые наши). */
export function depth(): number {
  return stack.length;
}

/** Сколько открытых слоёв, кроме слоёв с id из exceptIds (например, openLayerCount(['tab'])). */
export function openLayerCount(exceptIds?: string[]): number {
  let n = 0;
  for (const l of stack) if (!l.dead && !l.closing && !(exceptIds && exceptIds.includes(l.id))) n++;
  return n;
}

/** Снять все слои выше toDepth одним history.go(-n); onPop каждого вызывается (сверху вниз).
 *  Ничего не делает, если слоёв не больше toDepth. */
export function unwind(toDepth: number): Promise<void> {
  if (!hasWindow) return Promise.resolve();
  return new Promise<void>((resolve) => {
    enqueue(async () => {
      const n = pushedCount() - Math.max(0, toDepth);
      if (n > 0) await travel(() => history.go(-n));
      resolve();
    });
  });
}

/**
 * Страница сейчас уйдёт на другой адрес (вход через Google): убрать из истории все свои записи, не закрывая
 * слоёв на экране (onPop не вызывается), — тогда следующий location.replace заменит запись самой страницы
 * и «Назад» после возвращения не проведёт через старые записи с перезагрузкой. Выполняется, когда записи убраны.
 */
export function leaveLayers(): Promise<void> {
  if (!hasWindow) return Promise.resolve();
  return new Promise<void>((resolve) => {
    enqueue(async () => {
      const n = pushedCount();
      for (const l of stack) l.closing = true;
      if (n > 0) await travel(() => history.go(-n));
      resolve();
    });
  });
}

/** Когда в очереди истории ничего не осталось. */
export function whenIdle(): Promise<void> {
  if (!running && queue.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => { idle.push(resolve); });
}
