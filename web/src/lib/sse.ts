// Поток событий сервера (SSE) с переподключением — общий для живых обновлений приложения (social/live.ts) и стола
// покера (game/stream.ts). Живёт, только пока включён и страница видна: у HTTP/1.1 всего 6 соединений на адрес.
// Всё решает сервер, поток — только подсказка: на hello и при возвращении на страницу приложение перечитывает экран.
// bye: сразу es.close() (иначе EventSource переподключится сам). max_age — сразу новый поток; replaced — ждём
// «Играть здесь» (resume); session/ban — не переподключаемся. Не вышло (3 ошибки за 30 с или не открылся за 10 с) —
// опрос раз в pollMs (если задан), через 2 минуты — снова поток. «reconnecting» — только после 5 с без связи.
export type SseStatus = 'off' | 'connecting' | 'live' | 'reconnecting' | 'poll' | 'replaced' | 'ended';

export interface SseHandlers {
  /** hello и возвращение на страницу: перечитать экран. */
  resync(): void;
  /** Обработчики событий по имени (кроме hello, ping, bye). */
  on: Record<string, (d: Record<string, unknown>) => void>;
  /** Сессию закрыли (выход, ограничение): поток больше не нужен. */
  ended?(reason: 'session' | 'ban'): void;
  /** Опрос вместо потока; false — сервер не ответил. Без опроса — только повторные попытки потока. */
  poll?(): Promise<boolean>;
}

const WATCHDOG_MS = 45_000;
const OPEN_MS = 10_000;
const LOST_MS = 5_000;
const ERR_WINDOW = 30_000;
const ERR_MAX = 3;
const RETRY_MS = 3_000;
const SSE_AGAIN_MS = 120_000;

const visible = () => document.visibilityState === 'visible';

/** 16 случайных знаков [A-Za-z0-9_-] (сервер принимает 8–24). */
function tabId(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  const b = new Uint8Array(16);
  try { crypto.getRandomValues(b); } catch { for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256); }
  return Array.from(b, (x) => abc[x & 63]).join('');
}

type Timer = 'open' | 'lost' | 'dog' | 'retry' | 'poll' | 'again';

export class SseStream {
  status: SseStatus = 'off';
  /** Сервер «сейчас» − Date.now() (по hello, ping и данным) — для таймеров. */
  offset = 0;
  private es: EventSource | null = null;
  private on = false;
  private onPurpose = false;
  private mode: 'sse' | 'poll' = 'sse';
  private errors: number[] = [];
  private t: Record<Timer, number> = { open: 0, lost: 0, dog: 0, retry: 0, poll: 0, again: 0 };
  private subs = new Set<() => void>();
  private url: string;
  private h: () => SseHandlers;
  private pollMs: number;

  constructor(url: string, handlers: () => SseHandlers, o: { pollMs?: number } = {}) {
    // c= — id потока этой вкладки: переподключившись (сторож, смена сети), она сменит своё старое соединение,
    // даже если то умерло молча и сервер ещё считает его живым.
    this.url = url + (url.includes('?') ? '&' : '?') + 'c=' + tabId();
    this.h = handlers;
    this.pollMs = o.pollMs ?? 0;
  }

  subscribe(f: () => void): () => void {
    this.subs.add(f);
    return () => { this.subs.delete(f); };
  }

  private set(s: SseStatus) {
    if (this.status === s) return;
    this.status = s;
    this.subs.forEach((f) => f());
  }

  private clear(...names: Timer[]) {
    for (const n of names) { clearTimeout(this.t[n]); clearInterval(this.t[n]); this.t[n] = 0; }
  }

  private readonly onVis = () => {
    if (!this.on) return;
    if (visible()) {
      if (this.onPurpose) return;
      this.connect();
      this.h().resync();
    } else {
      this.drop();
    }
  };

  private readonly onHide = () => { if (this.on) this.drop(); };
  private readonly onShow = () => { if (this.on && visible() && !this.onPurpose && !this.es) this.connect(); };

  enable(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on) {
      document.addEventListener('visibilitychange', this.onVis);
      window.addEventListener('pagehide', this.onHide);
      window.addEventListener('pageshow', this.onShow);
      this.onPurpose = false;
      this.mode = 'sse';
      this.errors = [];
      if (visible()) this.connect();
    } else {
      document.removeEventListener('visibilitychange', this.onVis);
      window.removeEventListener('pagehide', this.onHide);
      window.removeEventListener('pageshow', this.onShow);
      this.drop();
      this.clear('again');
      this.set('off');
    }
  }

  /** Открыть поток снова после replaced («Играть здесь»). */
  resume() {
    if (!this.on) return;
    this.onPurpose = false;
    this.mode = 'sse';
    this.errors = [];
    this.connect();
    this.h().resync();
  }

  /** Часы сервера из любого ответа. */
  clock(now: unknown) {
    const t = typeof now === 'number' ? now : typeof now === 'string' ? Date.parse(now) : NaN;
    if (Number.isFinite(t)) this.offset = t - Date.now();
  }

  private drop() {
    this.clear('open', 'lost', 'dog', 'retry', 'poll');
    if (this.es) { this.es.close(); this.es = null; }
  }

  private connect() {
    this.drop();
    if (!this.on || !visible()) return;
    if (this.mode === 'poll') { this.startPoll(); return; }
    let es: EventSource;
    try { es = new EventSource(this.url); } catch { this.fallback(); return; }
    this.es = es;
    if (this.status !== 'reconnecting') this.set('connecting');
    this.t.open = window.setTimeout(() => { if (this.es === es && es.readyState !== EventSource.OPEN) this.fallback(); }, OPEN_MS);
    this.t.lost = window.setTimeout(() => { if (this.es === es && es.readyState !== EventSource.OPEN) this.set('reconnecting'); }, LOST_MS);
    this.kick(es);
    es.onopen = () => {
      if (this.es !== es) return;
      this.clear('open', 'lost');
      this.set('live');
      this.kick(es);
    };
    es.onerror = () => {
      if (this.es !== es) return;
      const now = Date.now();
      this.errors = this.errors.filter((x) => now - x < ERR_WINDOW);
      this.errors.push(now);
      if (this.errors.length >= ERR_MAX) { this.fallback(); return; }
      if (!this.t.lost) {
        this.t.lost = window.setTimeout(() => {
          this.t.lost = 0;
          if (this.es === es && es.readyState !== EventSource.OPEN) this.set('reconnecting');
        }, LOST_MS);
      }
      if (es.readyState === EventSource.CLOSED) {
        // Браузер сдался (ответ не 200) — пробуем сами чуть позже.
        this.es = null;
        this.clear('open', 'dog');
        this.t.retry = window.setTimeout(() => this.connect(), RETRY_MS);
      }
    };
    const listen = (name: string, fn: (d: Record<string, unknown>) => void) => {
      es.addEventListener(name, (ev) => {
        if (this.es !== es) return;
        this.kick(es);
        let d: Record<string, unknown> = {};
        try { d = JSON.parse((ev as MessageEvent<string>).data || '{}') || {}; } catch { /* пустое событие */ }
        this.clock(d.now);
        try { fn(d); } catch { /* обработчик экрана не должен ронять поток */ }
      });
    };
    listen('hello', () => { this.set('live'); this.h().resync(); });
    listen('ping', () => {});
    for (const name of Object.keys(this.h().on)) listen(name, (d) => this.h().on[name]?.(d));
    listen('bye', (d) => {
      es.close();
      this.es = null;
      this.clear('open', 'lost', 'dog');
      const reason = d.reason;
      if (reason === 'max_age') { this.connect(); return; }
      this.onPurpose = true;
      if (reason === 'replaced') { this.set('replaced'); return; }
      this.set('ended');
      this.h().ended?.(reason === 'ban' ? 'ban' : 'session');
    });
  }

  /** Сторож: 45 с без единого события (ping — раз в 20 с) — соединение умерло молча, открываем заново. */
  private kick(es: EventSource) {
    this.clear('dog');
    this.t.dog = window.setTimeout(() => { if (this.es === es) this.connect(); }, WATCHDOG_MS);
  }

  private fallback() {
    this.drop();
    const again = () => {
      this.t.again = 0;
      if (!this.on || this.onPurpose) return;
      this.mode = 'sse';
      this.errors = [];
      this.connect();
    };
    this.clear('again');
    if (!this.pollMs || !this.h().poll) {
      // Без опроса: просто попробовать поток позже (живые обновления приложения — не критичны).
      this.set('reconnecting');
      this.t.again = window.setTimeout(again, 30_000);
      return;
    }
    this.mode = 'poll';
    this.startPoll(this.status === 'reconnecting');
    this.pollNow();
    this.t.again = window.setTimeout(again, SSE_AGAIN_MS);
  }

  private startPoll(lost = false) {
    this.clear('poll');
    if (!this.pollMs) return;
    this.set(lost ? 'reconnecting' : 'poll');
    this.t.poll = window.setInterval(() => this.pollNow(), this.pollMs);
  }

  private pollNow() {
    const poll = this.h().poll;
    if (!visible() || !poll) return;
    void poll().then((ok) => { if (this.on && this.mode === 'poll' && !this.es) this.set(ok ? 'poll' : 'reconnecting'); });
  }
}
