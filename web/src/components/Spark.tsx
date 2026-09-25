// Минимальный график активности вуза: сколько людей заходило в каждый из последних
// дней. Столбики, а не линия: на полусотне пикселей линия превращается в кашу.
// Последний день — сегодня, поэтому он ярче остальных.
// Класс .pulse, а не .spark: .spark занят большим графиком статистики.
const W = 5, GAP = 2, H = 20;

export function Spark({ values, color }: { values: number[]; color?: string }) {
  if (!values || !values.length) return null;
  const max = Math.max(1, ...values);
  return (
    <svg className="pulse" viewBox={`0 0 ${values.length * (W + GAP) - GAP} ${H}`}
      style={color ? { color } : undefined} aria-hidden="true">
      {values.map((v, i) => {
        const h = v ? Math.max(3, Math.round((v / max) * H)) : 2;
        return <rect key={i} x={i * (W + GAP)} y={H - h} width={W} height={h} rx={2}
          fill="currentColor" opacity={v ? (i === values.length - 1 ? 1 : 0.5) : 0.2} />;
      })}
    </svg>
  );
}
