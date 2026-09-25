#!/usr/bin/env python3
"""Картинки бренда Para: знак для шапки, иконки главного экрана и превью ссылки.

  python server/hub/make-icons.py

Знак — строчная «p»: петля — кольцо, ножка — вниз от его левого края, а синяя дуга
поверх кольца — отсчёт до пары (на экране запуска она крутится). Рисуем с запасом ×4
и уменьшаем — так края гладкие. Нужен Pillow: pip install pillow
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 4                       # во сколько раз рисуем крупнее, чем нужно
BLUE = (10, 132, 255)        # системный синий iOS (тёмная тема)
BLUE_LIGHT = (0, 122, 255)   # он же для светлой
INK = (28, 28, 30)

# Геометрия знака в квадрате 1000×1000: строчная «p» — кольцо и ножка вниз от него.
# Пропорции сняты с утверждённого эскиза: кольцо по центру, толщина ≈12% стороны,
# синяя дуга поверх белого кольца — это отсчёт до пары (в приложении она крутится).
CX, CY = 500, 440            # центр кольца
R_OUT, R_IN = 312, 193       # кольцо
RING_W = R_OUT - R_IN        # толщина кольца = ширина ножки
STEM_X = CX - R_OUT          # левый край ножки совпадает с левым краем кольца
STEM_BOTTOM = 886
ARC = (-100, 11)             # синяя дуга, градусы (0 — «3 часа», по часовой)

# Рамка знака целиком — нужна, чтобы ставить его по центру иконки.
BOX = (STEM_X, CY - R_OUT, CX + R_OUT, STEM_BOTTOM)


def draw_mark(size, stem_rgba, ring_rgba, accent_rgba=None, scale=1.0, offset=(0, 0)):
    """Слой size×size со знаком. accent_rgba — цвет дуги отсчёта (None — без неё)."""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = size / 1000 * scale
    ox = offset[0] * size / 1000 + (1 - scale) * size / 2
    oy = offset[1] * size / 1000 + (1 - scale) * size / 2
    P = lambda x, y: (ox + x * k, oy + y * k)

    # Ножка: от центра кольца вниз, низ скруглён.
    x0, y0 = P(STEM_X, CY)
    x1, y1 = P(STEM_X + RING_W, STEM_BOTTOM)
    d.rounded_rectangle((x0, y0, x1, y1), radius=RING_W * k / 2, fill=stem_rgba)
    d.rectangle((x0, y0, x1, y0 + RING_W * k / 2), fill=stem_rgba)

    # Кольцо целиком, поверх — дуга отсчёта.
    cx, cy = P(CX, CY)
    bbox = (cx - R_OUT * k, cy - R_OUT * k, cx + R_OUT * k, cy + R_OUT * k)
    d.arc(bbox, start=0, end=360, fill=ring_rgba, width=round(RING_W * k))
    if accent_rgba:
        d.arc(bbox, start=ARC[0], end=ARC[1], fill=accent_rgba, width=round(RING_W * k))
        mid = (R_OUT + R_IN) / 2
        for a in ARC:
            r = math.radians(a)
            px, py = cx + mid * k * math.cos(r), cy + mid * k * math.sin(r)
            rr = RING_W * k / 2
            d.ellipse((px - rr, py - rr, px + rr, py + rr), fill=accent_rgba)
    return img


def down(img, size):
    return img.resize((size, size), Image.LANCZOS)


def icon(size, bg, ink, accent, scale):
    big = size * SS
    base = Image.new('RGBA', (big, big), bg + (255,))
    # Центр рамки знака — в центр иконки.
    bx, by = (BOX[0] + BOX[2]) / 2, (BOX[1] + BOX[3]) / 2
    base.alpha_composite(draw_mark(big, ink + (255,), ink + (255,), accent + (255,), scale,
                                   offset=((500 - bx) * scale, (500 - by) * scale)))
    return down(base, size)


def font(names, size):
    for n in names:
        p = os.path.join('C:/Windows/Fonts', n)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def main():
    white, black = (255, 255, 255), (0, 0, 0)

    # Маска для шапки: форма белым на прозрачном, цвет даёт CSS. Обрезаем по краям знака.
    m = draw_mark(1000, white + (255,), white + (255,), None)
    m = m.crop(m.getbbox())
    h = 132
    m.resize((round(m.width * h / m.height), h), Image.LANCZOS).save(os.path.join(OUT, 'logo-mark.png'), optimize=True)

    icon(192, black, white, BLUE, 0.66).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
    icon(512, black, white, BLUE, 0.66).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
    icon(512, black, white, BLUE, 0.44).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)  # весь знак в круге 80% — безопасная зона Android
    icon(180, black, white, BLUE, 0.66).save(os.path.join(OUT, 'apple-touch-icon-dark.png'), optimize=True)
    icon(180, white, INK, BLUE_LIGHT, 0.66).save(os.path.join(OUT, 'apple-touch-icon-light.png'), optimize=True)

    # Превью ссылки 1200×630: знак слева, название и подпись справа.
    W, H = 1200, 630
    og = Image.new('RGBA', (W * SS, H * SS), (0, 0, 0, 255))
    glow = Image.new('L', (W, H), 0)
    gd = ImageDraw.Draw(glow)
    for r in range(430, 0, -6):
        gd.ellipse((300 - r, 315 - r, 300 + r, 315 + r), fill=int(60 * (1 - r / 430)))
    og.paste(Image.new('RGBA', og.size, BLUE + (255,)), (0, 0), glow.resize(og.size, Image.LANCZOS))
    mark = draw_mark(420 * SS, white + (255,), white + (255,), BLUE + (255,))
    og.alpha_composite(mark, (int((300 - 210) * SS), int((315 - 200) * SS)))
    og = og.resize((W, H), Image.LANCZOS).convert('RGB')
    d = ImageDraw.Draw(og)
    d.text((560, 150), 'Para', font=font(['segoeuib.ttf', 'arialbd.ttf'], 150), fill=white)
    sub = font(['segoeui.ttf', 'arial.ttf'], 38)
    d.text((566, 340), 'Расписание пар вузов —', font=sub, fill=(200, 205, 215))
    d.text((566, 390), 'своя группа и отсчёт до пары', font=sub, fill=(200, 205, 215))
    d.text((566, 480), 'para.skycoax.uz', font=font(['segoeuib.ttf', 'arialbd.ttf'], 34), fill=(100, 170, 255))
    og.save(os.path.join(OUT, 'og.jpg'), quality=88, optimize=True)

    # Баннер для страницы в Google Play, 1024×500. Обязателен, показывается над описанием.
    W, H = 1024, 500
    fg = Image.new('RGBA', (W * 2, H * 2), (0, 0, 0, 255))
    glow = Image.new('L', (W, H), 0)
    gd = ImageDraw.Draw(glow)
    for r in range(360, 0, -5):
        gd.ellipse((250 - r, 250 - r, 250 + r, 250 + r), fill=int(70 * (1 - r / 360)))
    fg.paste(Image.new('RGBA', fg.size, BLUE + (255,)), (0, 0), glow.resize(fg.size, Image.LANCZOS))
    fg.alpha_composite(draw_mark(320 * 2, white + (255,), white + (255,), BLUE + (255,)), (int(110 * 2), int(95 * 2)))
    fg = fg.resize((W, H), Image.LANCZOS).convert('RGB')
    d = ImageDraw.Draw(fg)
    d.text((440, 150), 'Para', font=font(['segoeuib.ttf', 'arialbd.ttf'], 120), fill=white)
    d.text((446, 296), 'Расписание пар вузов', font=font(['segoeui.ttf', 'arial.ttf'], 40), fill=(205, 210, 220))
    d.text((446, 348), 'своя группа и отсчёт до пары', font=font(['segoeui.ttf', 'arial.ttf'], 40), fill=(205, 210, 220))
    fg.save(os.path.join(OUT, 'play-feature.png'), optimize=True)

    print('Готово:', ', '.join(sorted(f for f in os.listdir(OUT) if f.endswith(('.png', '.jpg')))))


if __name__ == '__main__':
    main()
