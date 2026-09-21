// Флип-часы в стиле Apple: каждая цифра — створка табло, при смене доигрывает
// переворот. Перенос идеи flipTo() из старой страницы на React.
import { useEffect, useState } from 'react';

function FlipDigit({ char }: { char: string }) {
  const [st, setSt] = useState({ cur: char, prev: char, flip: false });

  useEffect(() => {
    if (char === st.cur) return;
    setSt((s) => ({ cur: char, prev: s.cur, flip: true }));
    const t = setTimeout(() => setSt((s) => ({ ...s, flip: false })), 540);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [char]);

  const { cur, prev, flip } = st;
  return (
    <span className="fl">
      <b className="u"><i>{cur}</i></b>
      <b className="l"><i>{flip ? prev : cur}</i></b>
      {flip && (
        <>
          <b className="u f"><i>{prev}</i></b>
          <b className="l f"><i>{cur}</i></b>
        </>
      )}
    </span>
  );
}

export function FlipClock({ digits, labels }: { digits: string; labels: [string, string] }) {
  const d = digits.padStart(4, '0').slice(0, 4);
  return (
    <div className="clk">
      <div className="clk__d">
        <FlipDigit char={d[0]} />
        <FlipDigit char={d[1]} />
        <span className="clk__sep">:</span>
        <FlipDigit char={d[2]} />
        <FlipDigit char={d[3]} />
      </div>
      <div className="clk__lbls">
        <span>{labels[0]}</span>
        <b className="sp"></b>
        <span>{labels[1]}</span>
      </div>
    </div>
  );
}
