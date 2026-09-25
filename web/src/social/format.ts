// Форматирование для «Обсуждений»: время (Asia/Tashkent, ru-RU), счётчики, длина текста в графемах,
// ссылки и упоминания в тексте, формулировка ограничения.
import { useEffect, useState } from 'react';
import type { Ban } from './types';

const TZ = 'Asia/Tashkent';
const TZ_MS = 5 * 3600e3;          // Ташкент: UTC+5 круглый год
const DAY = 864e5;

const dayKey = (t: number) => Math.floor((t + TZ_MS) / DAY);
const yearOf = (t: number) => new Date(t + TZ_MS).getUTCFullYear();

let fmtShort: Intl.DateTimeFormat | null = null;
let fmtLong: Intl.DateTimeFormat | null = null;
let fmtDayMonth: Intl.DateTimeFormat | null = null;
let fmtTime: Intl.DateTimeFormat | null = null;

/** «24 сент.» (+ « 2025», если год другой). */
function shortDate(t: number, withYear: boolean): string {
  fmtShort ??= new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'short' });
  const s = fmtShort.format(t);
  return withYear ? s + ' ' + yearOf(t) : s;
}

/** «сейчас» · «5 мин» · «3 ч» · «вчера» · «24 сент.» · «24 сент. 2025» */
export function relTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = now - t;
  if (diff < 60e3) return 'сейчас';                       // и время из будущего (часы телефона спешат)
  if (diff < 3600e3) return Math.floor(diff / 60e3) + ' мин';
  const days = dayKey(now) - dayKey(t);
  if (days === 0) return Math.floor(diff / 3600e3) + ' ч';
  if (days === 1) return 'вчера';
  return shortDate(t, yearOf(t) !== yearOf(now));
}

/** «25 сентября 2026 в 14:05» */
export function fullTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  fmtDayMonth ??= new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long' });
  fmtTime ??= new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return fmtDayMonth.format(t) + ' ' + yearOf(t) + ' в ' + fmtTime.format(t);
}

/** 999 · «1,2 тыс.» · «12 тыс.» · «1,5 млн» */
export function fmtCount(n: number): string {
  const v = Math.max(0, Math.floor(n || 0));
  if (v < 1000) return String(v);
  const one = (x: number) => {
    const r = Math.floor(x * 10) / 10;
    return (r % 1 === 0 ? String(r) : r.toFixed(1)).replace('.', ',');
  };
  if (v < 10_000) return one(v / 1000) + ' тыс.';
  if (v < 1_000_000) return Math.floor(v / 1000) + ' тыс.';
  if (v < 10_000_000) return one(v / 1e6) + ' млн';
  return Math.floor(v / 1e6) + ' млн';
}

let segmenter: { segment: (s: string) => Iterable<unknown> } | null | undefined;

/** Длина в графемах (как считает сервер); без Intl.Segmenter — в кодовых точках. */
export function textLength(s: string): number {
  if (!s) return 0;
  if (segmenter === undefined) {
    try { segmenter = new Intl.Segmenter('ru', { granularity: 'grapheme' }); } catch { segmenter = null; }
  }
  if (!segmenter) return [...s].length;
  return [...segmenter.segment(s)].length;
}

/** Длиннее max графем или больше 4·max единиц UTF-16 (предел сервера). */
export function textTooLong(s: string, max: number): boolean {
  return s.length > 4 * max || textLength(s) > max;
}

/** Единственная формулировка ограничения: «Публикация ограничена до 3 октября. Причина: спам.» */
export function banText(ban: Ban): string {
  let head = 'Публикация ограничена навсегда.';
  if (ban.until) {
    const t = Date.parse(ban.until);
    if (Number.isFinite(t)) {
      fmtLong ??= new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, day: 'numeric', month: 'long' });
      head = 'Публикация ограничена до ' + fmtLong.format(t) + '.';
    }
  }
  const reason = (ban.reason || '').trim();
  if (!reason) return head;
  return head + ' Причина: ' + reason + (/[.!?…]$/.test(reason) ? '' : '.');
}

const LINKS_RE = /\bhttps?:\/\/|\bwww\.|\bt\.me\//gi;

/** Сколько ссылок — то же правило, что на сервере. */
export function countLinks(s: string): number {
  return (s.match(LINKS_RE) || []).length;
}

const PHONE_RE = /(\+?998)?[\s-]?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;

/** Похоже на номер телефона (перед публикацией спрашиваем). */
export function hasPhone(s: string): boolean {
  return PHONE_RE.test(s);
}

export type Token = string | { t: 'url'; href: string; label: string } | { t: 'mention'; username: string };

const URL_RE = /\bhttps?:\/\/[^\s<>"'«»]+[^\s<>"'«».,;:!?)\]]/gi;
const MENTION_RE = /(^|[^\p{L}\p{N}_])@([a-z0-9_]{3,20})(?![a-z0-9_])/giu;

function urlLabel(href: string): string {
  const s = href.replace(/^https?:\/\//i, '');
  return s.length > 32 ? s.slice(0, 32) + '…' : s;
}

function mentions(text: string, out: Token[]) {
  let last = 0;
  MENTION_RE.lastIndex = 0;
  for (let m = MENTION_RE.exec(text); m; m = MENTION_RE.exec(text)) {
    const at = m.index + m[1].length;
    if (at > last) out.push(text.slice(last, at));
    out.push({ t: 'mention', username: m[2].toLowerCase() });
    last = at + 1 + m[2].length;
  }
  if (last < text.length) out.push(text.slice(last));
}

/** Текст → куски: строки, ссылки (только http/https) и упоминания @username. HTML не бывает никогда. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  if (!text) return out;
  let last = 0;
  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
    if (m.index > last) mentions(text.slice(last, m.index), out);
    out.push({ t: 'url', href: m[0], label: urlLabel(m[0]) });
    last = m.index + m[0].length;
  }
  if (last < text.length) mentions(text.slice(last), out);
  return out;
}

/** Перерисовка раз в ms (по умолчанию раз в минуту) — для «5 мин» в списках. */
export function useNow(ms = 60000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
