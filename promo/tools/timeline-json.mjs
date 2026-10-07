// src/timeline.ts → JSON для tools/audio.py: node --experimental-strip-types tools/timeline-json.mjs > timeline.json
const tl = await import('../src/timeline.ts');
console.log(JSON.stringify({ SC: tl.SC, VO: tl.VO, DURATION: tl.DURATION, POKER: tl.POKER, THEME_AT: tl.THEME_AT }));
