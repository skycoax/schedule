// Шрифты Inter / Inter Display (SIL OFL) из public/fonts — для титров и текста в холсте экрана.
import { continueRender, delayRender, staticFile } from 'remotion';

const FACES: [string, string, number][] = [
  ['Inter Display', 'InterDisplay-Regular.otf', 400], ['Inter Display', 'InterDisplay-Medium.otf', 500],
  ['Inter Display', 'InterDisplay-SemiBold.otf', 600], ['Inter Display', 'InterDisplay-Bold.otf', 700],
  ['Inter', 'Inter-Regular.otf', 400], ['Inter', 'Inter-Medium.otf', 500], ['Inter', 'Inter-SemiBold.otf', 600],
];

let started = false;
export function loadFonts() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const h = delayRender('шрифты');
  Promise.all(FACES.map(async ([family, file, weight]) => {
    const ff = new FontFace(family, `url(${staticFile('fonts/' + file)})`, { weight: String(weight) });
    await ff.load();
    (document.fonts as unknown as { add: (f: FontFace) => void }).add(ff);
  })).then(() => continueRender(h), (e) => { console.error(e); continueRender(h); });
}
