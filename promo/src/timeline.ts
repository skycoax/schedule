// Таймлайн ролика (секунды). Этот же файл читает сведение звука (tools/mix.py → через timeline.json).
export const FPS = 30;
export const W = 1920, H = 1080;

export const SC = {
  cold: [0, 6],
  reveal: [6, 13],
  now: [13, 21],
  day: [21, 30.5],
  week: [30.5, 38.6],
  together: [38.6, 42.6],
  changes: [42.6, 49.6],
  unis: [49.6, 57.6],
  offline: [57.6, 64.6],
  campus: [64.6, 76],
  omt: [76, 79],
  egg: [79, 83.3],
  poker: [83.3, 92.3],
  end: [92.3, 102.5],
} as const;
export type SceneId = keyof typeof SC;
export const DURATION = 102.5;

// озвучка: [файл, начало]
export const VO: [string, number][] = [
  ['s01', 0.8], ['s02', 7.0], ['s03', 13.3], ['s04', 21.4], ['s05', 30.8], ['s07', 38.9], ['s06', 42.9],
  ['s08', 49.9], ['s10', 57.9], ['s11', 64.9], ['s12a', 76.4], ['s12b', 79.3], ['s13', 92.8], ['s14', 97.9],
];

// куски записи покера (сек в poker.mp4): [начало, конец]
export const POKER: [number, number][] = [[5.6, 8.6], [15.8, 17.8], [30.6, 34.6]];

// смена темы в сцене offline (сек от начала сцены)
export const THEME_AT = 3.4;
// баннер уведомления в сцене changes
export const BANNER_IN = 0.6, BANNER_OUT = 2.25;
