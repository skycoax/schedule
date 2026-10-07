// Ролик Para: 3D-телефон с записями настоящего приложения, титры, логотип. Звук сводится отдельно (tools/mix.py) и
// накладывается на готовое видео ffmpeg'ом — так звук можно менять без перерендера.
import React from 'react';
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { Environment, Lightformer } from '@react-three/drei';
import { Phone, SCREEN } from './Phone';
import { Layer, useScreenTexture, Draw, Bar } from './screen';
import { drawBanner, drawTap } from './overlays';
import { Title, FONT } from './Titles';
import { ParaMark } from './Logo';
import { loadFonts } from './fonts';
import { FPS, W, H, SC, SceneId, POKER, THEME_AT, BANNER_IN, BANNER_OUT, DURATION } from './timeline';
import clips from './clips.json';

loadFonts();

type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number };
const P0: Pose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };
const pose = (p: Partial<Pose>): Pose => ({ ...P0, ...p });

const EIO = Easing.bezier(0.65, 0, 0.35, 1);
const EOUT = Easing.bezier(0.16, 1, 0.3, 1);
// ключи: [время, поза, сглаживание участка ДО этой точки]
type Key = [number, Partial<Pose>, ((t: number) => number)?];
function kf(t: number, keys: Key[]): Pose {
  const ks = keys.map(([tt, p, e]) => [tt, pose(p), e] as [number, Pose, ((t: number) => number) | undefined]);
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    const [t1, p1, e] = ks[i];
    const [t0, p0] = ks[i - 1];
    if (t <= t1) {
      const u = (e || EIO)((t - t0) / (t1 - t0));
      const r = {} as Pose;
      (Object.keys(p0) as (keyof Pose)[]).forEach((k) => { r[k] = p0[k] + (p1[k] - p0[k]) * u; });
      return r;
    }
  }
  return ks[ks.length - 1][1];
}

// точка экрана (px записи 1179×2556) → координаты телефона
const sp = (px: number, py: number) => ({ x: (px / 1179 - 0.5) * SCREEN.w, y: (0.5 - py / 2556) * SCREEN.h });
// поставить точку экрана в (fx, fy) кадра на глубине z
const focus = (px: number, py: number, fx: number, fy: number, z: number, extra: Partial<Pose> = {}): Partial<Pose> => {
  const p = sp(px, py);
  return { x: fx - p.x, y: fy - p.y, z, ...extra };
};

const sceneOf = (t: number): [SceneId, number] => {
  for (const [id, [a, b]] of Object.entries(SC) as [SceneId, readonly [number, number]][]) if (t >= a && t < b) return [id, t - a];
  return ['end', t - SC.end[0]];
};

type ClipInfo = { frames: number; taps: { frame: number; x: number; y: number }[] };
const C = clips as Record<string, ClipInfo>;
const fr = (clip: string, sec: number) => Math.max(0, Math.min(C[clip].frames - 1, Math.round(sec * FPS)));
const L = (clip: string, sec: number, bar: Bar = 'dark', alpha = 1): Layer => ({ clip, frame: fr(clip, sec), bar, alpha, ...(clip === 'poker' ? { dy: 56 } : {}) });

// ── что на экране главного телефона ──
type ScreenSpec = { layers: Layer[]; draw?: Draw; key?: string; extra?: string[] };
function tapsDraw(clip: string, sec: number, light = false): { draw: Draw; key: string } {
  const f = Math.round(sec * FPS);
  const near = C[clip].taps.filter((tp) => f - tp.frame >= -6 && f - tp.frame <= 16);
  return {
    key: near.map((tp) => `${tp.frame}:${f - tp.frame}`).join(','),
    draw: (ctx) => near.forEach((tp) => drawTap(ctx, tp.x, tp.y, f - tp.frame, light)),
  };
}
const withTaps = (clip: string, sec: number, layers: Layer[], light = false): ScreenSpec => {
  const t = tapsDraw(clip, sec, light);
  return { layers, draw: t.draw, key: t.key };
};

const BANNER = { t: 'Изменения в расписании', b: 'Чт, 6-я пара в 16:40: Основы програм. на С++ 224 П ком. Хасанов З.Ш. асс.' };

function mainScreen(id: SceneId, t: number, T: number): ScreenSpec {
  switch (id) {
    case 'cold': case 'reveal': case 'now':
      return { layers: [L('clock', T)] };
    case 'day': return { layers: [L('today', t)] };
    case 'week': return withTaps('week', t, [L('week', t)]);
    case 'together': return withTaps('week', t + 8.1, [L('week', t + 8.1)]);
    case 'changes': {
      const tp = tapsDraw('changes', t);
      const by = t < BANNER_OUT
        ? interpolate(t, [BANNER_IN, BANNER_IN + 0.55], [-300, 162], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EOUT })
        : interpolate(t, [BANNER_OUT, BANNER_OUT + 0.3], [162, -300], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic) });
      const ba = t < BANNER_IN ? 0 : 1;
      return {
        layers: [L('changes', t)], extra: [staticFile('ui/icon-512.png')], key: tp.key + '|' + by.toFixed(1),
        draw: (ctx, ex, cv) => { drawBanner(ctx, cv, ex[0], by, ba, BANNER.t, BANNER.b); tp.draw(ctx, ex, cv); },
      };
    }
    case 'unis': return withTaps('unis', t, [L('unis', t)]);
    case 'offline': {
      if (t < THEME_AT) return { layers: [L('offline', t, 'airplane')] };
      // смена темы: светлый экран раскрывается кругом от правого верхнего угла
      const u = interpolate(t, [THEME_AT, THEME_AT + 0.7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EIO });
      const light = L('clocklight', t - THEME_AT + 0.4, 'light');
      if (u >= 1) return { layers: [light] };
      return { layers: [L('offline', Math.min(t, 3.9), 'airplane'), { ...light, circle: [1050, 210, Math.round(2900 * u)] }] };
    }
    case 'campus': {
      if (t < 5.6) return withTaps('feed', t, [L('feed', t)]);
      if (t < 8.9) {
        const m = t - 5.6 + 0.15;
        const a = interpolate(t, [5.6, 5.8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
        const s = withTaps('moments', m, [L('feed', 5.6 + (t - 5.6) * 0, 'dark'), L('moments', m, 'dark', a)]);
        return s;
      }
      const pr = t - 8.9;
      return withTaps('profile', pr, [L('profile', pr)]);
    }
    case 'omt': return { layers: [L('egg', 0)] };
    case 'egg': return withTaps('egg', t, [L('egg', t)]);
    case 'poker': case 'end': {
      const tt = id === 'end' ? 9 + t : t;
      let acc = 0;
      for (let i = 0; i < POKER.length; i++) {
        const [a, b] = POKER[i];
        const d = b - a;
        if (tt < acc + d || i === POKER.length - 1) {
          const local = Math.min(tt - acc, d - 1 / FPS);
          const layers = [L('poker', a + local, 'cover')];
          if (i > 0 && local < 0.2) {
            const [pa, pb] = POKER[i - 1];
            layers.unshift(L('poker', pb - 1 / FPS, 'cover'));
            layers[1].alpha = local / 0.2;
          }
          return { layers };
        }
        acc += d;
      }
      return { layers: [L('poker', POKER[2][1] - 0.04, 'cover')] };
    }
  }
}

// ── позы телефона по сценам ──
function mainPose(id: SceneId, t: number): Pose {
  switch (id) {
    case 'cold': // макро: секунды на перекидных часах
      return kf(t, [[0, focus(857, 939, 0.2, 0.3, 37.5, { ry: -0.16, rx: 0.04 })], [6, focus(857, 939, 0, 0.2, 39.5, { ry: -0.06, rx: 0.02 })]]);
    case 'reveal':
      return kf(t, [[0, focus(857, 939, 0, 0.2, 39.5, { ry: -0.06, rx: 0.02 })],
        [3.4, { x: 5.4, y: -0.2, z: 2, ry: -0.5, rx: 0.06, rz: 0.01 }, Easing.bezier(0.7, 0, 0.2, 1)],
        [7, { x: 5.2, y: -0.1, z: 3.2, ry: -0.36, rx: 0.04, rz: 0.01 }, Easing.linear]]);
    case 'now':
      return kf(t, [[0, { x: 5.2, y: -0.1, z: 3.2, ry: -0.36, rx: 0.04, rz: 0.01 }],
        [1.8, focus(589, 945, 5.2, 0.4, 15, { ry: -0.24, rx: 0.06 })],
        [8, focus(589, 945, 4.9, 0.3, 17.5, { ry: -0.17, rx: 0.04 }), Easing.linear]]);
    case 'day':
      return kf(t, [[0, { x: -5.6, y: -3.5, z: 0, ry: 0.85, rx: 0.15 }],
        [1.0, { x: -5.0, y: 0, z: 2.5, ry: 0.42, rx: 0.05, rz: -0.01 }, EOUT],
        [9.5, { x: -4.8, y: 0.1, z: 4, ry: 0.3, rx: 0.03, rz: -0.01 }, Easing.linear]]);
    case 'week':
      return kf(t, [[0, { x: 5.8, y: -3.5, z: 0, ry: -0.85, rx: 0.15 }],
        [1.0, { x: 5.0, y: 0, z: 2.5, ry: -0.42, rx: 0.05, rz: 0.01 }, EOUT],
        [8.1, { x: 4.8, y: 0.1, z: 3.8, ry: -0.3, rx: 0.03, rz: 0.01 }, Easing.linear]]);
    case 'together':
      return kf(t, [[0, { x: 4.8, y: 0.1, z: 3.8, ry: -0.3, rx: 0.03, rz: 0.01 }],
        [1.6, focus(560, 1400, 4.6, -0.6, 17, { ry: -0.2, rx: 0.05 })],
        [4, focus(560, 1400, 4.4, -0.6, 18.5, { ry: -0.15, rx: 0.04 }), Easing.linear]]);
    case 'changes':
      return kf(t, [[0, { x: -5.4, y: 3.5, z: 0, ry: 0.8, rx: -0.15 }],
        [1.0, { x: -5.0, y: 0, z: 2.5, ry: 0.36, rx: 0.02 }, EOUT],
        [2.4, { x: -4.9, y: -0.3, z: 4, ry: 0.28, rx: 0.04 }],
        [7, { x: -4.8, y: -0.2, z: 5, ry: 0.22, rx: 0.03 }, Easing.linear]]);
    case 'unis':
      return kf(t, [[0, { x: 1.2, y: -3.0, z: -1, ry: -0.6, rx: 0.12 }],
        [1.0, { x: 1.4, y: 0, z: -2, ry: -0.22, rx: 0.04 }, EOUT],
        [8, { x: 1.2, y: 0.1, z: -1.4, ry: -0.14, rx: 0.03 }, Easing.linear]]);
    case 'offline':
      return kf(t, [[0, { x: 5.4, y: 0, z: 1.6, ry: -0.75, rx: 0.06 }],
        [1.0, { x: 5.2, y: 0, z: 2.4, ry: -0.3, rx: 0.04 }, EOUT],
        [7, { x: 5.0, y: 0.1, z: 3.4, ry: -0.2, rx: 0.03 }, Easing.linear]]);
    case 'campus':
      return kf(t, [[0, { x: -5.6, y: -3.5, z: 0, ry: 0.85, rx: 0.15 }],
        [1.0, { x: -5.0, y: 0, z: 2.5, ry: 0.4, rx: 0.05 }, EOUT],
        [5.6, { x: -4.8, y: 0.1, z: 3.4, ry: 0.3, rx: 0.03 }, Easing.linear],
        [6.6, { x: -4.9, y: 0, z: 3.8, ry: 0.18, rx: 0.02 }],
        [11.4, { x: -4.7, y: 0.1, z: 4.6, ry: 0.26, rx: 0.03 }, Easing.linear]]);
    case 'omt':
      return pose({ z: -60 });
    case 'egg':
      return kf(t, [[0, focus(589, 945, 0, -0.8, 6, { ry: 0.25, rx: 0.12 })],
        [1.2, focus(589, 945, 0, -0.5, 10, { ry: 0.08, rx: 0.06 }), EOUT],
        [2.9, focus(589, 945, 0, -0.3, 12, { ry: 0.03, rx: 0.04 }), Easing.linear],
        [4.3, { x: 0, y: 0, z: 3, ry: -0.05, rx: 0.02 }]]);
    case 'poker':
      return kf(t, [[0, { x: 0, y: 0, z: 3, ry: -0.05, rx: 0.02 }],
        [3, { x: 0.3, y: 0, z: 3.6, ry: -0.18, rx: 0.03 }, Easing.linear],
        [5, { x: -0.3, y: 0, z: 4.2, ry: 0.16, rx: 0.03 }],
        [6.2, focus(595, 1481, 0, -0.4, 12, { ry: 0.08, rx: 0.04 })],
        [9, focus(595, 1481, 0, -0.4, 14, { ry: 0.02, rx: 0.03 }), Easing.linear]]);
    case 'end':
      return kf(t, [[0, focus(595, 1481, 0, -0.4, 14, { ry: 0.02, rx: 0.03 })],
        [1.4, { x: 0, y: -2, z: -30, ry: 0.9, rx: 0.3 }, Easing.bezier(0.6, 0, 0.9, 0.6)]]);
  }
}

// второй телефон (сцена unis — режим преподавателя)
function teacherPose(t: number): Pose {
  return kf(t, [[2.6, { x: 22, y: 0, z: -2, ry: -0.9, rx: 0.05 }], [3.6, { x: 10.4, y: 0, z: -2.4, ry: -0.3, rx: 0.04 }, EOUT],
    [8, { x: 10.1, y: 0.1, z: -1.8, ry: -0.24, rx: 0.03 }, Easing.linear]]);
}

const Lights: React.FC = () => (
  <Environment resolution={256} frames={1}>
    <Lightformer intensity={2.6} position={[0, 14, 6]} scale={[30, 4, 1]} />
    <Lightformer intensity={2.2} position={[-16, 3, 8]} rotation-y={Math.PI / 2.4} scale={[10, 30, 1]} />
    <Lightformer intensity={2.4} position={[16, 0, 2]} rotation-y={-Math.PI / 2} scale={[2, 30, 1]} />
    <Lightformer intensity={1.2} position={[0, -12, 6]} scale={[30, 2, 1]} />
    <Lightformer intensity={0.8} position={[0, 0, -14]} scale={[30, 30, 1]} />
  </Environment>
);

const PhoneAt: React.FC<{ p: Pose; spec: ScreenSpec; glare: number; visible?: boolean }> = ({ p, spec, glare, visible = true }) => {
  const tex = useScreenTexture(visible ? spec.layers : [], spec.draw, spec.key, spec.extra);
  return (
    <group position={[p.x, p.y, p.z]} rotation={[p.rx, p.ry, p.rz]} visible={visible}>
      <Phone screen={visible && spec.layers.length ? tex : null} glare={glare} />
    </group>
  );
};

const Stage: React.FC = () => {
  const f = useCurrentFrame();
  const T = f / FPS;
  const [id, t] = sceneOf(T);
  const p = mainPose(id, t);
  const spec = mainScreen(id, t, T);
  const glare = (T * 0.07) % 1.4 - 0.2 + p.ry * 0.6;
  const showB = id === 'unis' && t >= 2.6;
  const pb = teacherPose(t);
  const tb = Math.max(0, t - 3.0);
  const specB: ScreenSpec = showB ? withTaps('teacher', tb, [L('teacher', tb)]) : { layers: [] };
  return (
    <>
      <Lights />
      <PhoneAt p={p} spec={spec} glare={glare} visible={id !== 'omt'} />
      <PhoneAt p={pb} spec={specB} glare={glare + 0.2} visible={showB} />
    </>
  );
};

// ── фон, глубина резкости, титры ──
const Background: React.FC<{ light: number }> = ({ light }) => {
  const c0 = mix('#18181a', '#ffffff', light), c1 = mix('#000000', '#e8e8ed', light);
  return <AbsoluteFill style={{ background: `radial-gradient(110% 95% at 50% 42%, ${c0} 0%, ${c1} 72%)` }} />;
};
function mix(a: string, b: string, u: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * u)).join(',')})`;
}

const Dof: React.FC<{ amount: number; cx?: string; cy?: string }> = ({ amount, cx = '50%', cy = '50%' }) => {
  if (amount <= 0.01) return null;
  return (
    <AbsoluteFill style={{
      backdropFilter: `blur(${amount * 14}px)`, WebkitBackdropFilter: `blur(${amount * 14}px)`,
      maskImage: `radial-gradient(42% 46% at ${cx} ${cy}, transparent 0%, transparent 45%, black 100%)`,
      WebkitMaskImage: `radial-gradient(42% 46% at ${cx} ${cy}, transparent 0%, transparent 45%, black 100%)`,
    }} />
  );
};

const GRAY = '#86868b';
const Titles: React.FC = () => {
  const s = (id: SceneId, d: number) => SC[id][0] + d;
  const ink = '#1d1d1f';
  return (
    <>
      <Title from={2.3} to={5.6} x={W / 2} y={900} align="center" lines={[{ text: 'Every minute counts.', size: 64, weight: 600 }]} />
      <Title from={s('reveal', 2.2)} to={s('reveal', 6.8)} x={190} y={470} lines={[
        { text: 'Para.', size: 168, weight: 700, tracking: -0.04 },
        { text: 'Your schedule, reimagined.', size: 48, weight: 500, color: GRAY, gap: 18, tracking: -0.015 }]} />
      <Title from={s('now', 1.0)} to={s('now', 7.7)} x={190} y={540} lines={[
        { text: 'Now.', size: 112 }, { text: 'To the second.', size: 112, color: GRAY }]} />
      <Title from={s('day', 0.9)} to={s('day', 9.2)} x={W - 190} y={540} align="right" lines={[
        { text: 'Your day.', size: 112 }, { text: 'At a glance.', size: 112, color: GRAY }]} />
      <Title from={s('week', 1.0)} to={s('week', 7.9)} x={190} y={540} lines={[
        { text: 'Your week.', size: 112 }, { text: 'Decoded.', size: 112, color: GRAY }]} />
      <Title from={s('together', 1.0)} to={s('together', 3.85)} x={190} y={540} lines={[
        { text: 'See who shares', size: 96 }, { text: 'your classroom.', size: 96, color: GRAY }]} />
      <Title from={s('changes', 0.9)} to={s('changes', 6.8)} x={W - 190} y={540} align="right" lines={[
        { text: 'Changes.', size: 112 }, { text: 'Instantly.', size: 112, color: GRAY }]} />
      <Title from={s('unis', 0.8)} to={s('unis', 3.7)} x={150} y={540} lines={[
        { text: '14 universities.', size: 96 }, { text: 'One app.', size: 96, color: GRAY }]} />
      <Title from={s('unis', 4.0)} to={s('unis', 7.8)} x={150} y={540} lines={[
        { text: 'For students.', size: 96 }, { text: 'And teachers.', size: 96, color: GRAY }]} />
      <Title from={s('offline', 0.8)} to={s('offline', 3.3)} x={190} y={540} lines={[
        { text: 'No signal?', size: 112 }, { text: 'No problem.', size: 112, color: GRAY }]} />
      <Title from={s('offline', 3.7)} to={s('offline', 6.8)} x={190} y={540} lines={[
        { text: 'Dark.', size: 112, color: ink }, { text: 'Or light.', size: 112, color: GRAY }]} />
      <Title from={s('campus', 1.0)} to={s('campus', 11.1)} x={W - 190} y={540} align="right" lines={[
        { text: 'Your campus.', size: 112 }, { text: 'Connected.', size: 112, color: GRAY }]} />
      <Title from={s('omt', 0.3)} to={s('omt', 2.8)} x={W / 2} y={H / 2} align="center" stagger={5} lines={[
        { text: 'One more thing.', size: 96, weight: 600 }]} />
    </>
  );
};

const EndCard: React.FC = () => {
  const f = useCurrentFrame();
  const t0 = Math.round((SC.end[0] + 0.7) * FPS);
  if (f < t0) return null;
  const word = interpolate(f, [t0 + 26, t0 + 50], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EOUT });
  const sub = interpolate(f, [Math.round(97.6 * FPS), Math.round(98.4 * FPS)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EOUT });
  const url = interpolate(f, [Math.round(98.6 * FPS), Math.round(99.4 * FPS)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EOUT });
  const fade = interpolate(f, [Math.round((DURATION - 1.0) * FPS), Math.round(DURATION * FPS) - 1], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', fontFamily: FONT, opacity: fade }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 34, transform: `translateY(${-40 - sub * 30}px)` }}>
        <ParaMark start={t0} size={176} />
        <div style={{ fontSize: 150, fontWeight: 700, color: '#f5f5f7', letterSpacing: '-0.045em', opacity: word,
          transform: `translateX(${(1 - word) * -24}px)`, filter: word < 1 ? `blur(${(1 - word) * 12}px)` : undefined }}>Para</div>
      </div>
      <div style={{ position: 'absolute', top: 690, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 44, fontWeight: 500, color: '#f5f5f7', letterSpacing: '-0.015em', opacity: sub,
          filter: sub < 1 ? `blur(${(1 - sub) * 10}px)` : undefined }}>Coming soon to Google Play</div>
        <div style={{ marginTop: 18, fontSize: 30, fontWeight: 500, color: GRAY, letterSpacing: '0.01em', opacity: url }}>para.skycoax.uz</div>
      </div>
    </AbsoluteFill>
  );
};

export const ParaPromo: React.FC = () => {
  const f = useCurrentFrame();
  const T = f / FPS;
  const [id, t] = sceneOf(T);
  // светлый фон — только после смены темы в сцене offline
  const light = id === 'offline' ? interpolate(t, [THEME_AT, THEME_AT + 0.7], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EIO }) : 0;
  // затемнения между частями
  const fadeIn = interpolate(T, [0, 0.9], [0, 1], { extrapolateRight: 'clamp' });
  const dip = (a: number, d = 0.25) => 1 - interpolate(Math.abs(T - a), [0, d], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const canvasOpacity = Math.min(fadeIn, dip(SC.campus[0], 0.2), id === 'end' ? interpolate(t, [0.25, 0.95], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 1,
    id === 'egg' ? interpolate(t, [0, 0.5], [0, 1], { extrapolateRight: 'clamp' }) : 1);
  const dof = id === 'cold' ? 1 : id === 'reveal' ? interpolate(t, [0, 2.6], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
    : id === 'now' || id === 'together' ? interpolate(t, [0.6, 1.8], [0, 0.55], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0;
  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <Background light={id === 'omt' || id === 'end' ? 0 : light} />
      <AbsoluteFill style={{ opacity: canvasOpacity }}>
        <ThreeCanvas width={W} height={H} camera={{ fov: 22, position: [0, 0, 50], near: 0.1, far: 200 }} gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}>
          <Stage />
        </ThreeCanvas>
      </AbsoluteFill>
      <Dof amount={dof} cx={id === 'together' ? '72%' : id === 'now' ? '74%' : '50%'} cy="50%" />
      <Titles />
      <EndCard />
    </AbsoluteFill>
  );
};
