// Графики статистики — recharts, тот же приём, что в панели CyberAdvice на этом
// же сервере: SVG-атрибутам (stroke/fill) нужен настоящий цвет, а не var(--c1),
// поэтому токены темы читаем из :root и переслушиваем смену темы.
import { useEffect, useId, useState, type CSSProperties } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { plural } from '../lib/plural';

const TOKENS = ['--c1', '--yellow', '--green', '--ink-100', '--ink-60', '--ink-30', '--sep', '--fill', '--surface'] as const;
type TokenMap = Record<(typeof TOKENS)[number], string>;

function readTokens(): TokenMap {
  const cs = getComputedStyle(document.documentElement);
  const out = {} as TokenMap;
  TOKENS.forEach((t) => { out[t] = cs.getPropertyValue(t).trim(); });
  return out;
}

/** Цвета текущей темы; сами обновляются при переключении светлая/тёмная. */
export function useThemeTokens(): TokenMap {
  const [tokens, setTokens] = useState<TokenMap>(readTokens);
  useEffect(() => {
    const sync = () => setTokens(readTokens());
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', sync);
    return () => { mo.disconnect(); mq.removeEventListener('change', sync); };
  }, []);
  return tokens;
}

/** Маленький график в плитке KPI — без осей и сетки, только силуэт тренда. */
export function Sparkline({ data, dataKey, color }: { data: unknown[]; dataKey: string; color: string }) {
  const uid = useId().replace(/:/g, '');
  return (
    <ResponsiveContainer width={72} height={34}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`spark-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.6}
          fill={`url(#spark-${uid})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

const tipStyle: CSSProperties = {
  background: 'var(--surface)', boxShadow: 'inset 0 0 0 1px var(--glass-edge)',
  borderRadius: 12, padding: '8px 12px', fontSize: 12,
};

interface TooltipPayloadItem { name: string; value: number; color: string; }
function Tip({ active, payload, label, order }: {
  active?: boolean; payload?: TooltipPayloadItem[]; label?: string; order?: string[];
}) {
  if (!active || !payload?.length) return null;
  // recharts отдаёт серии в порядке отрисовки — показываем в порядке легенды.
  const items = order ? [...payload].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)) : payload;
  return (
    <div style={tipStyle}>
      <div style={{ color: 'var(--ink-30)', marginBottom: 4 }}>{label}</div>
      {items.map((p) => (
        <div key={p.name} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--ink-100)' }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: p.color, flex: 'none' }} />
          {p.name}: <b>{p.value}</b>
        </div>
      ))}
    </div>
  );
}

type TrendPoint = { date: string; hits: number; users: number; newUsers?: number };

/**
 * Большой график по дням — люди и сколько из них новые.
 *
 * «Заходов» тут нарочно нет: один человек может открыть расписание и десять
 * раз за день, так что эта линия — не про людей, а про совсем другую величину
 * с другим размахом. На одной шкале с людьми она всегда сверху и приплюснет
 * «Новых» к нулю — тот же эффект, что у графика с двумя осями, только без
 * второй оси. Общее число заходов не потеряно — оно есть в плитках ниже.
 */
export function TrendChart({ data }: { data: TrendPoint[] }) {
  const t = useThemeTokens();
  const uid = useId().replace(/:/g, '');
  const lines = [
    { key: 'users', name: 'Людей', color: t['--c1'] },
    { key: 'newUsers', name: 'Новых', color: t['--yellow'] },
  ];
  const order = lines.map((l) => l.name);
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 8 }}>
        {lines.map((s) => (
          <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-60)' }}>
            <span style={{ width: 12, height: 2, borderRadius: 2, background: s.color, flex: 'none' }} />
            {s.name}
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={190}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <defs>
            {lines.map((s) => (
              <linearGradient key={s.key} id={`${uid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.12} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke={t['--sep']} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: t['--ink-30'] }} tickLine={false} stroke={t['--sep']} />
          <YAxis width={28} allowDecimals={false} tick={{ fontSize: 11, fill: t['--ink-30'] }} tickLine={false} axisLine={false} />
          <Tooltip content={<Tip order={order} />} cursor={{ stroke: t['--sep'] }} />
          {[...lines].reverse().map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.name}
              stroke={s.color} strokeWidth={2} fill={`url(#${uid}-${s.key})`}
              dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: t['--surface'] }} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

const pad2 = (h: number) => String(h).padStart(2, '0');

function HourTip({ active, payload }: { active?: boolean; payload?: { payload: { h: number; n: number } }[] }) {
  if (!active || !payload?.length) return null;
  const { h, n } = payload[0].payload;
  return (
    <div style={tipStyle}>
      <div style={{ color: 'var(--ink-30)', marginBottom: 2 }}>{pad2(h)}:00–{pad2((h + 1) % 24)}:00</div>
      <div style={{ color: 'var(--ink-100)' }}><b>{n}</b> {plural(n, ['заход', 'захода', 'заходов'])}</div>
    </div>
  );
}

/** Когда открывают расписание — заходы по часам суток. */
export function HourChart({ data }: { data: { h: number; n: number }[] }) {
  const t = useThemeTokens();
  return (
    <ResponsiveContainer width="100%" height={140}>
      <BarChart data={data} margin={{ top: 4, right: 0, left: -20, bottom: 0 }} barCategoryGap={2}>
        <CartesianGrid stroke={t['--sep']} vertical={false} />
        <XAxis dataKey="h" interval={5} tickFormatter={(h: number) => `${h}:00`}
          tick={{ fontSize: 11, fill: t['--ink-30'] }} tickLine={false} axisLine={{ stroke: t['--sep'] }} />
        <YAxis width={28} allowDecimals={false} tick={{ fontSize: 11, fill: t['--ink-30'] }} tickLine={false} axisLine={false} />
        <Tooltip content={<HourTip />} cursor={{ fill: t['--fill'] }} />
        <Bar dataKey="n" fill={t['--c1']} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
