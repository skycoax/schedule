// Звёзды рейтинга — кликабельные (оставить отзыв) и для чтения (показать оценку).

export function StarPicker({ value, onChange, size = 30, emptyColor = 'var(--ink-30)' }: {
  value: number; onChange: (v: number) => void; size?: number; emptyColor?: string;
}) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={n + ' из 5'}
          onClick={() => onChange(n)}
          style={{ fontSize: size, lineHeight: 1, color: n <= value ? 'var(--c2)' : emptyColor, transition: 'color .12s' }}
        >
          {n <= value ? '★' : '☆'}
        </button>
      ))}
    </div>
  );
}

export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const full = Math.round(value);
  return (
    <span style={{ fontSize: size, color: 'var(--c2)', letterSpacing: 1 }}>
      {[1, 2, 3, 4, 5].map((n) => (n <= full ? '★' : '☆')).join('')}
    </span>
  );
}
