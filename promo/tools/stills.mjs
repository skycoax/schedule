// Пробные кадры ролика одним бандлом: node tools/stills.mjs <папка> <кадр> [кадр…]
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [out, ...frames] = process.argv.slice(2);
const serveUrl = await bundle({ entryPoint: path.join(root, 'src/index.ts'), publicDir: path.join(root, 'public') });
const chromiumOptions = { gl: 'swangle' };
const browserExecutable = '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const composition = await selectComposition({ serveUrl, id: 'Para', chromiumOptions, browserExecutable });
for (const f of frames.map(Number)) {
  const t = Date.now();
  await renderStill({ composition, serveUrl, frame: f, output: path.join(out, `f${String(f).padStart(5, '0')}.png`), chromiumOptions, browserExecutable });
  console.log(f, ((Date.now() - t) / 1000).toFixed(1) + ' с');
}
