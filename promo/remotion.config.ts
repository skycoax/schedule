import { Config } from '@remotion/cli/config';
// В облачной песочнице нет GPU: WebGL через SwiftShader (ANGLE). Браузер — Chromium Headless Shell из Playwright.
Config.setChromiumOpenGlRenderer('swangle');
Config.setBrowserExecutable('/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
