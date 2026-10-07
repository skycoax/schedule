"""Звук ролика: музыка (синтез), эффекты (синтез), озвучка, сведение. Всё — из кода, без чужих сэмплов.
python -I audio.py <timeline.json> <clips.json> <flips.json> <vo-папка> <out.wav>
timeline.json — tools/timeline-json.mjs (из src/timeline.ts), clips.json — касания, flips.json — tools/flips.py.
"""
import json, sys, os
import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
rng = np.random.default_rng(7)
TL, CLIPS, FLIPS, VODIR, OUT = sys.argv[1:6]
tl = json.load(open(TL))
clips = json.load(open(CLIPS))
flips = json.load(open(FLIPS))
SC = tl['SC']
DUR = tl['DURATION'] + 1.5
N = int(DUR * SR)


def stereo(n=N):
    return np.zeros((n, 2), dtype=np.float64)


MUS, SFX, VOX, REV = stereo(), stereo(), stereo(), stereo()   # шины; REV — посыл в реверберацию
T = lambda n: np.arange(n) / SR
mtof = lambda m: 440.0 * 2 ** ((m - 69) / 12)


def place(bus, sig, t, gain=1.0, pan=0.0, send=0.0):
    """Положить моно/стерео сигнал в шину с момента t (сек)."""
    if sig.ndim == 1:
        l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
        sig = np.stack([sig * l * 1.4142, sig * r * 1.4142], axis=1)
    i = int(round(t * SR))
    if i >= len(bus) or i + len(sig) <= 0:
        return
    a, b = max(0, i), min(len(bus), i + len(sig))
    bus[a:b] += sig[a - i:b - i] * gain
    if send:
        REV[a:b] += sig[a - i:b - i] * gain * send


def sos(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output='sos')


def filt(x, kind, f, order=2):
    return signal.sosfilt(sos(kind, f, order), x, axis=0)


def sweep_filter(x, f0, f1, kind='bandpass', q=1.2, chunk=480):
    """Фильтр с плавно меняющейся частотой (кусками по 10 мс, с переносом состояния)."""
    out = np.zeros_like(x)
    zi = None
    n = len(x)
    for s in range(0, n, chunk):
        u = s / max(1, n - 1)
        fc = f0 * (f1 / f0) ** u
        if kind == 'bandpass':
            bw = fc / q
            sos_ = signal.butter(1, [max(20, fc - bw / 2), min(SR / 2 - 100, fc + bw / 2)], btype='bandpass', fs=SR, output='sos')
        else:
            sos_ = signal.butter(2, min(SR / 2 - 100, fc), btype=kind, fs=SR, output='sos')
        if zi is None:
            zi = signal.sosfilt_zi(sos_) * 0
        y, zi = signal.sosfilt(sos_, x[s:s + chunk], zi=zi)
        out[s:s + chunk] = y
    return out


def exp_env(n, tau, attack=0.002):
    t = T(n)
    a = np.clip(t / attack, 0, 1) if attack > 0 else 1
    return a * np.exp(-t / tau)


# ───────────────────────── инструменты ─────────────────────────

_tables = {}


def saw(f, n, detune=0.0, phase=0.0):
    """Пила без алиасинга: волновая таблица (гармоники до 9 кГц) и чтение по фазе."""
    ff = f * 2 ** (detune / 1200)
    kmax = int(max(1, min(40, 9000 // ff)))
    tab = _tables.get(kmax)
    if tab is None:
        x = np.arange(4096) / 4096
        tab = sum(np.sin(2 * np.pi * k * x) / k for k in range(1, kmax + 1)) * (2 / np.pi)
        tab = np.append(tab, tab[0])
        _tables[kmax] = tab
    ph = (phase / (2 * np.pi) + ff * T(n)) % 1.0
    pos = ph * 4096
    i = pos.astype(np.int64)
    fr = pos - i
    return tab[i] * (1 - fr) + tab[i + 1] * fr


def pad_chord(notes, dur, bright=900.0, attack=1.2, release=1.6):
    n = int((dur + release) * SR)
    L = np.zeros(n); R = np.zeros(n)
    for m in notes:
        f = mtof(m)
        L += saw(f, n, -7, rng.random() * 6) + 0.6 * saw(f, n, +5, rng.random() * 6)
        R += saw(f, n, +7, rng.random() * 6) + 0.6 * saw(f, n, -4, rng.random() * 6)
    t = T(n)
    env = np.clip(t / attack, 0, 1) ** 1.5 * np.where(t < dur, 1.0, np.exp(-(t - dur) / (release / 3)))
    y = np.stack([L, R], axis=1) * env[:, None] / (len(notes) * 1.6)
    y = filt(y, 'lowpass', bright, 2)
    return filt(y, 'highpass', 90, 2)


def epiano(m, dur=1.4, vel=1.0, bright=1.0):
    """FM-«пианино»: несущая, модулятор 1:1 со спадающим индексом и тонкий колокольчик 14:1."""
    f = mtof(m)
    n = int(dur * SR)
    t = T(n)
    idx = (1.6 * bright * vel) * np.exp(-t / 0.35) + 0.15
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * t))
    y += 0.12 * vel * np.sin(2 * np.pi * f * 14 * t) * np.exp(-t / 0.05)
    env = np.clip(t / 0.003, 0, 1) * np.exp(-t / (0.55 + 0.25 * (72 - min(m, 84)) / 24))
    return y * env * vel


def bell(m, dur=3.0, vel=1.0, ratio=3.5):
    f = mtof(m)
    n = int(dur * SR)
    t = T(n)
    idx = 2.2 * np.exp(-t / 0.6)
    y = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * ratio * t))
    y += 0.3 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / 0.4)
    return y * np.clip(t / 0.002, 0, 1) * np.exp(-t / (dur / 4)) * vel


def kick(vel=1.0, tone=48):
    n = int(0.55 * SR)
    t = T(n)
    f = tone + (150 - tone) * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sin(ph) * np.exp(-t / 0.28)
    click = filt(rng.standard_normal(n) * np.exp(-t / 0.002), 'highpass', 2500) * 0.25
    return np.tanh((y + click) * 1.4) * vel


def hat(vel=1.0, open_=False):
    n = int((0.22 if open_ else 0.06) * SR)
    t = T(n)
    y = filt(rng.standard_normal(n), 'highpass', 7500, 2) * np.exp(-t / (0.07 if open_ else 0.018))
    return y * vel * 0.5


def clap(vel=1.0):
    n = int(0.35 * SR)
    t = T(n)
    e = np.zeros(n)
    for d in (0.0, 0.011, 0.022):
        e += np.where(t >= d, np.exp(-(t - d) / 0.008), 0) * 0.6
    e += np.where(t >= 0.03, np.exp(-(t - 0.03) / 0.09), 0)
    y = filt(rng.standard_normal(n), 'bandpass', [900, 2600], 2) * e
    return y * vel * 0.8


def bass_note(m, dur, vel=1.0):
    f = mtof(m)
    n = int(dur * SR)
    t = T(n)
    y = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    env = np.clip(t / 0.006, 0, 1) * np.exp(-t / (dur * 0.9))
    return np.tanh(1.6 * y * env) * vel * 0.6


# ───────────────────────── эффекты ─────────────────────────

def clack(vel=1.0):
    """Щелчок перекидной цифры: короткий удар пластика + щелчок + лёгкий низ."""
    n = int(0.09 * SR)
    t = T(n)
    body = filt(rng.standard_normal(n), 'bandpass', [1400, 4200], 2) * np.exp(-t / 0.012)
    tick = filt(rng.standard_normal(n), 'highpass', 6000, 2) * np.exp(-t / 0.0015)
    low = np.sin(2 * np.pi * 210 * t) * np.exp(-t / 0.018) * 0.5
    return (body * 0.9 + tick * 0.6 + low) * vel


def flick(vel=1.0):
    n = int(0.05 * SR)
    t = T(n)
    return filt(rng.standard_normal(n), 'bandpass', [2500, 7000], 2) * np.exp(-t / 0.006) * vel * 0.5


def tap(vel=1.0):
    n = int(0.05 * SR)
    t = T(n)
    y = np.sin(2 * np.pi * 1650 * t) * np.exp(-t / 0.006) + filt(rng.standard_normal(n), 'highpass', 4000) * np.exp(-t / 0.0015) * 0.4
    return y * vel * 0.5


def whoosh(dur=0.9, f0=300, f1=3200, vel=1.0, peak=0.55):
    n = int(dur * SR)
    t = T(n) / dur
    env = np.where(t < peak, (t / peak) ** 2.2, ((1 - t) / (1 - peak)) ** 1.6)
    x = rng.standard_normal(n)
    y = sweep_filter(x, f0, f1, 'bandpass', q=1.5)
    y2 = sweep_filter(rng.standard_normal(n), f0 * 1.3, f1 * 0.8, 'bandpass', q=2.0)
    return np.stack([y * env, y2 * env], axis=1) * vel * 1.6


def boom(vel=1.0, dur=2.6):
    n = int(dur * SR)
    t = T(n)
    f = 34 + 30 * np.exp(-t / 0.25)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    hit = filt(rng.standard_normal(n), 'lowpass', 900) * np.exp(-t / 0.05) * 0.6
    return np.tanh((y + hit) * 1.3) * vel


def riser(dur=1.6, vel=1.0):
    n = int(dur * SR)
    t = T(n) / dur
    x = sweep_filter(rng.standard_normal(n), 400, 6000, 'bandpass', q=2.5)
    tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (t * 2.2)) / SR) * 0.15
    return (x + tone) * t ** 2.5 * vel


def shimmer(vel=1.0):
    y = np.zeros(int(3.5 * SR))
    for i, m in enumerate([81, 88, 93, 97, 100]):
        b = bell(m, 3.0, 0.5, ratio=2.0)
        s = int(i * 0.045 * SR)
        y[s:s + len(b)] += b[:len(y) - s]
    return y * vel


def chime(notes, step=0.11, vel=1.0, ratio=3.0):
    y = np.zeros(int((len(notes) * step + 1.6) * SR))
    for i, m in enumerate(notes):
        b = bell(m, 1.5, 0.7, ratio=ratio)
        s = int(i * step * SR)
        y[s:s + len(b)] += b
    return y * vel


def card(vel=1.0):
    n = int(0.11 * SR)
    t = T(n)
    x = sweep_filter(rng.standard_normal(n), 5200, 1800, 'bandpass', q=1.2)
    return x * np.clip(t / 0.006, 0, 1) * np.exp(-t / 0.035) * vel


def chips(vel=1.0, k=4):
    y = np.zeros(int(0.5 * SR))
    for j in range(k):
        s = int((j * 0.035 + rng.random() * 0.02) * SR)
        n = int(0.12 * SR)
        t = T(n)
        c = sum(np.sin(2 * np.pi * f * (1 + rng.random() * 0.03) * t) * np.exp(-t / d) for f, d in ((3150, 0.03), (4720, 0.02), (6350, 0.012)))
        c += filt(rng.standard_normal(n), 'highpass', 3000) * np.exp(-t / 0.004)
        y[s:s + n] += c * (0.8 - j * 0.12)
    return y * vel * 0.35


def reverb_ir(sec=3.2, damp=0.6):
    n = int(sec * SR)
    t = T(n)
    ir = np.zeros((n, 2))
    for ch in range(2):
        x = rng.standard_normal(n) * np.exp(-t / (sec / 6.5))
        ir[:, ch] = filt(x, 'lowpass', 6500, 1) * (1 - damp) + filt(x, 'lowpass', 2200, 1) * damp
    ir[: int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))[:, None]
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


# ───────────────────────── музыка ─────────────────────────
BPM = 100
BEAT = 60 / BPM
# Gmaj9 | Dadd9/F# | Em9 | A7sus4 (D мажор, I-вариант «вдохновляющей» сетки)
CHORDS = [
    dict(bass=43, pad=[59, 62, 66, 69], arp=[67, 71, 74, 78, 81, 78, 74, 71]),
    dict(bass=42, pad=[57, 62, 64, 66], arp=[66, 69, 74, 76, 78, 76, 74, 69]),
    dict(bass=40, pad=[55, 59, 62, 66], arp=[64, 67, 71, 74, 78, 74, 71, 67]),
    dict(bass=45, pad=[57, 62, 64, 67], arp=[64, 69, 74, 76, 79, 76, 74, 69]),
]


def music_section(t0, t1, start_bar_time, layers, bright_fn, chord_offset=0):
    """Раздел музыки от t0 до t1 по сетке с началом start_bar_time. layers(t) → набор включённых партий."""
    bar = BEAT * 4
    k = int(np.floor((t0 - start_bar_time) / bar))
    while True:
        bt = start_bar_time + k * bar
        if bt >= t1:
            break
        ch = CHORDS[(k + chord_offset) % 4]
        on = layers(max(bt, t0))
        if 'pad' in on and bt + bar > t0:
            p = pad_chord(ch['pad'], bar + 0.05, bright=bright_fn(bt), attack=0.9 if k > 0 else 1.6)
            s = max(bt, t0)
            cut = int((s - bt) * SR)
            seg = p[cut:]
            end = int((t1 - s) * SR)
            if end < len(seg):  # обрыв раздела — мягкий хвост
                fade = np.ones(len(seg)); fade[end:] = np.exp(-np.arange(len(seg) - end) / (0.25 * SR))
                seg = seg * fade[:, None]
            place(MUS, seg, s, 0.55, send=0.35)
        for b in range(4):
            for e in range(2):
                tt = bt + b * BEAT + e * BEAT / 2
                if tt < t0 or tt >= t1:
                    continue
                on = layers(tt)
                step = b * 2 + e
                if 'arp' in on:
                    m = ch['arp'][step]
                    vel = 0.55 if e else 0.75
                    place(MUS, epiano(m, 1.2, vel, bright=0.9), tt, 0.22, pan=-0.35 if step % 2 else 0.35, send=0.4)
                    if 'arp2' in on and e == 1:
                        place(MUS, epiano(m + 12, 0.8, 0.45, bright=0.7), tt + BEAT / 4, 0.12, pan=0.6 if step % 4 == 1 else -0.6, send=0.5)
                if 'kick' in on and e == 0 and (b in (0, 2) or 'four' in on):
                    place(MUS, kick(1.0 if b == 0 else 0.85), tt, 0.62)
                if 'hat' in on:
                    place(MUS, hat(0.9 if e else 0.45), tt + (BEAT / 4 if 'four' in on and e == 0 else 0), 0.13, pan=0.25)
                if 'clap' in on and e == 0 and b in (1, 3):
                    place(MUS, clap(), tt, 0.3, send=0.25)
                if 'bass' in on:
                    place(MUS, bass_note(ch['bass'] + (12 if (e and 'four' in on) else 0), BEAT / 2 * 0.95, 0.9 if e == 0 else 0.6), tt, 0.5)
        k += 1


s = lambda name, d=0.0: SC[name][0] + d
OMT = SC['omt'][0]

# A: от холодного начала до «One more thing»: пэд с первых секунд, сетка от начала reveal
A0 = s('reveal')
def layers_A(t):
    on = {'pad'}
    if t >= A0 + 2.2: on |= {'arp'}
    if t >= s('now'): on |= {'kick', 'hat'}
    if t >= s('day'): on |= {'bass'}
    if t >= s('unis'): on |= {'arp2'}
    if s('offline') <= t < s('offline', 3.4): on -= {'kick', 'bass', 'hat'}
    return on
bright_A = lambda t: 380 if t < A0 else min(2600, 380 + (t - A0) * 300) if t < s('now') else 2600 if t < s('unis') else 3400
music_section(0.0, OMT, A0, layers_A, bright_A)

# B: пасхалка и покер — тот же лад, плотнее
B0 = s('poker')
def layers_B(t):
    if t < B0:
        return {'pad', 'hat'}
    return {'pad', 'arp', 'arp2', 'kick', 'four', 'hat', 'clap', 'bass'}
music_section(s('egg', 0.2), s('end', 0.3), B0, layers_B, lambda t: 1800 if t < B0 else 3800)

# C: финал — большой аккорд на логотипе и тихие ноты
END = s('end')
LOGO = END + 0.7 + 24 / 30
p = pad_chord([50, 57, 62, 66, 69, 74], 7.5, bright=2400, attack=0.25, release=2.5)
place(MUS, p, LOGO - 0.05, 0.6, send=0.45)
place(MUS, bass_note(38, 4.0, 1.0), LOGO, 0.6)
for i, m in enumerate([74, 78, 81, 86]):
    place(MUS, epiano(m, 2.5, 0.6, bright=0.7), LOGO + 0.9 + i * BEAT, 0.2, pan=(-0.4, 0.4, -0.2, 0.2)[i], send=0.6)
for i, m in enumerate([69, 74, 78]):
    place(MUS, epiano(m, 3.0, 0.5, bright=0.6), 97.6 + i * BEAT * 1.5, 0.16, pan=(-0.3, 0.3, 0)[i], send=0.7)

# «One more thing»: тишина и одна нота
place(MUS, bell(62, 5.0, 0.7, ratio=2.0), OMT + 0.35, 0.35, send=0.8)
place(MUS, pad_chord([38, 45, 50], 2.6, bright=500, attack=1.0, release=1.4), OMT + 0.2, 0.5, send=0.3)

# ───────────────────────── эффекты по событиям ─────────────────────────
FL = lambda arr: [a for i, a in enumerate(arr) if i == 0 or a - arr[i - 1] > 0.5]

# перекидные часы: холодное начало громко, дальше тише
for f in FL(flips['clock']):
    t = f
    if t >= s('day'):
        break
    g = 0.9 if t < A0 else 0.55 if t < s('now') else 0.4
    place(SFX, flick(1.0), t, g * 0.7, pan=0.15, send=0.15)
    place(SFX, clack(1.0), t + 0.15, g, pan=0.15, send=0.2)
for f in FL(flips['offline']):
    if f < 3.4:
        place(SFX, clack(0.6), s('offline', f + 0.15), 0.3, send=0.15)
for f in FL(flips['clocklight']):
    tt = s('offline', 3.4 + f - 0.4)
    if s('offline', 3.4) < tt < s('campus'):
        place(SFX, clack(0.6), tt + 0.15, 0.25, send=0.15)
for f in FL(flips['egg']):
    place(SFX, clack(1.0), s('egg', f + 0.15), 0.5 if f < 1.9 else 0.8, send=0.25)

# касания (кадр клипа → время на экране)
def taps_of(clip, scene, offset=0.0):
    for tp in clips[clip]['taps']:
        place(SFX, tap(1.0), s(scene, tp['frame'] / 30 + offset), 0.6, pan=0.1)
taps_of('week', 'week'); taps_of('changes', 'changes'); taps_of('unis', 'unis'); taps_of('feed', 'campus')
taps_of('moments', 'campus', 5.6 - 0.15); taps_of('profile', 'campus', 8.9); taps_of('egg', 'egg')

# движения телефона
for t, d, g in [(s('reveal'), 2.6, 0.35), (s('now'), 1.4, 0.3), (s('day'), 0.9, 0.45), (s('week'), 0.9, 0.45),
                (s('together'), 1.4, 0.28), (s('changes'), 0.9, 0.45), (s('unis'), 0.9, 0.45), (s('unis', 2.6), 1.0, 0.4),
                (s('offline'), 0.9, 0.42), (s('campus'), 0.9, 0.45), (s('egg'), 1.0, 0.35), (s('end', 0.2), 1.4, 0.5)]:
    place(SFX, whoosh(d, 250, 3000), t - d * 0.45, g, send=0.25)
place(SFX, riser(1.8, 1.0), A0 - 1.8, 0.25, send=0.3)

# удары
place(SFX, boom(0.9), s('reveal', 2.15), 0.55, send=0.35)
place(SFX, boom(1.0, 3.2), LOGO, 0.7, send=0.4)
place(SFX, shimmer(0.8), LOGO + 0.05, 0.22, send=0.8)
place(SFX, chime([79, 86], 0.09, 0.6), 97.55, 0.18, send=0.6)

# уведомление и смена темы
place(SFX, chime([84, 91], 0.12, 0.9, ratio=2.0), s('changes', 0.6), 0.32, send=0.35)
place(SFX, whoosh(0.4, 900, 3500, 0.6), s('changes', 2.25), 0.2)
place(SFX, shimmer(1.0), s('offline', 3.35), 0.3, send=0.7)
place(SFX, whoosh(0.8, 500, 7000, 0.6, peak=0.7), s('offline', 3.0), 0.25)

# «One more thing» — низкий подъём
place(SFX, boom(0.5, 3.0), OMT + 0.15, 0.25, send=0.5)

# покер (куски записи: A 83.3, B 86.3, C 88.3)
P = s('poker')
place(SFX, chips(0.8, 3), P + 0.4, 0.8, pan=0.2)
place(SFX, card(1.0), P + 0.55, 0.6, pan=-0.2); place(SFX, card(1.0), P + 0.72, 0.6, pan=0.2)
place(SFX, card(0.7), P + 1.15, 0.5)
place(SFX, tap(1.0), P + 2.55, 0.6)
place(SFX, whoosh(0.35, 800, 2500, 0.6), P + 3.05, 0.25)
place(SFX, chips(1.0, 5), P + 4.2, 0.9, pan=-0.2)
place(SFX, boom(0.8, 1.6), P + 5.55, 0.45, send=0.3)
place(SFX, chips(1.0, 6), P + 5.6, 0.8)
place(SFX, chime([74, 78, 81, 86, 90], 0.07, 0.9), P + 6.35, 0.3, send=0.5)
place(SFX, chips(1.0, 7), P + 6.45, 0.9, pan=0.15)

# ───────────────────────── озвучка ─────────────────────────
for name, t in tl['VO']:
    v, sr = sf.read(os.path.join(VODIR, name + '.wav'))
    if v.ndim > 1:
        v = v.mean(axis=1)
    v = signal.resample_poly(v, SR, sr)
    v = filt(v, 'highpass', 80)
    # лёгкая «присутственность»: подъём 3–5 кГц
    v = v + 0.25 * filt(v, 'bandpass', [3000, 6000], 2)
    place(VOX, v, t, 1.0, send=0.06)

# ───────────────────────── сведение ─────────────────────────
ir = reverb_ir()
wet = np.stack([signal.fftconvolve(REV[:, c], ir[:, c])[:N] for c in range(2)], axis=1)

def rms_db(x):
    return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)

# нормировать шины до опорных уровней
vox_act = VOX[np.abs(VOX).max(axis=1) > 1e-3]
VOX *= 10 ** ((-19 - rms_db(vox_act)) / 20)
MUS *= 10 ** ((-27 - rms_db(MUS[: int(OMT * SR)])) / 20)
wet *= 10 ** ((-31 - rms_db(wet)) / 20)
sfx_act = SFX[np.abs(SFX).max(axis=1) > 1e-3]
SFX *= 10 ** ((-26 - rms_db(sfx_act)) / 20)

# музыка уходит под голос (огибающая голоса: атака 60 мс, спад 500 мс)
env = np.abs(VOX).max(axis=1)
env = signal.sosfiltfilt(sos('lowpass', 3), env)
env = np.clip(env / (np.percentile(env[env > 1e-3], 90) + 1e-9), 0, 1)
duck = 1 - 0.45 * env
MUS *= duck[:, None]
wet *= (1 - 0.3 * env)[:, None]

mix = MUS + SFX * 0.9 + wet + VOX
mix = filt(mix, 'highpass', 25, 2)
peak = np.max(np.abs(mix))
mix = np.tanh(mix / peak * 1.2) / np.tanh(1.2) * 0.89
fade = np.ones(N); fn = int(1.2 * SR); fade[-fn:] = np.linspace(1, 0, fn)
mix *= fade[:, None]
sf.write(OUT, mix.astype(np.float32), SR, subtype='FLOAT')
print('ok', OUT, round(N / SR, 2), 's')
