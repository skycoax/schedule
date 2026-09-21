#!/usr/bin/env python3
"""Картинки бренда нового вуза из его логотипа (см. server/tenants/README.md).

  python server/tenants/_tools/brand-images.py --logo знак.png --out server/tenants/tatu \\
      --title "Расписание ТАТУ" --subtitle "Пары своей группы и отсчёт до начала — на телефоне" \\
      --host tatu.skycoax.uz [--og-logo полный-логотип.png]

--logo     знак вуза без надписи по кругу: цветной на белом или прозрачном фоне.
           Всё, что темнее фона, станет формой логотипа (цвет потом даёт тема приложения).
--og-logo  необязательно: цветной логотип целиком для превью ссылки (иначе — знак белым).
Нужны Pillow и numpy: pip install pillow numpy
"""
import argparse
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def shape_of(path):
    """Форма знака 0..1: насколько пиксель темнее белого фона, с учётом прозрачности."""
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float32)
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    m = np.clip((245 - lum) / 95, 0, 1) * (a[..., 3] / 255)
    ys, xs = np.where(m > 0.05)
    if not len(ys):
        raise SystemExit('В логотипе не нашлось тёмных пикселей: нужен цветной знак на светлом или прозрачном фоне')
    return m[ys.min():ys.max() + 1, xs.min():xs.max() + 1]


def mask_image(m, height):
    width = max(1, round(m.shape[1] * height / m.shape[0]))
    return Image.fromarray((m * 255).astype(np.uint8), 'L').resize((width, height), Image.LANCZOS)


def bounded_mask(m, max_width, max_height):
    """Маска, которая целиком помещается в заданную область.

    В OG-карточке слева есть только квадратная зона: текст начинается справа.
    У горизонтальных wordmark-логотипов нельзя задавать лишь высоту — иначе
    вычисленная ширина уедет под заголовок.
    """
    h, w = m.shape
    k = min(max_width / w, max_height / h)
    return Image.fromarray((m * 255).astype(np.uint8), 'L').resize(
        (max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)


def icon(m, size, bg, fg, frac):
    """Квадратная иконка: знак занимает frac стороны, по центру, на сплошном фоне."""
    h, w = m.shape
    k = frac * size / max(h, w)
    L = Image.fromarray((m * 255).astype(np.uint8), 'L').resize(
        (max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), bg + (255,))
    out.paste(Image.new('RGBA', L.size, fg + (255,)), ((size - L.width) // 2, (size - L.height) // 2), L)
    return out


def font(names, size):
    for d in ('C:/Windows/Fonts', '/usr/share/fonts/truetype/dejavu', '/Library/Fonts', '/System/Library/Fonts'):
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def wrap(draw, text, fnt, width):
    lines, line = [], ''
    for word in text.split():
        probe = (line + ' ' + word).strip()
        if draw.textlength(probe, font=fnt) <= width or not line:
            line = probe
        else:
            lines.append(line)
            line = word
    return lines + ([line] if line else [])


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--logo', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--title', required=True)
    ap.add_argument('--subtitle', default='')
    ap.add_argument('--host', required=True)
    ap.add_argument('--og-logo')
    ap.add_argument('--only-og', action='store_true', help='пересоздать только og.jpg, не трогая иконки')
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    out = lambda name: os.path.join(args.out, name)

    m = shape_of(args.logo)
    black, white = (0, 0, 0), (255, 255, 255)

    if not args.only_og:
        # Маска для шапки: форма белым на прозрачном, цвет даёт CSS.
        mask = mask_image(m, 132)
        logo = Image.new('RGBA', mask.size, (255, 255, 255, 0))
        logo.putalpha(mask)
        logo.save(out('logo-mark.png'), optimize=True)

        # Иконки главного экрана — контрастные: белый знак на чёрном и чёрный на белом.
        icon(m, 192, black, white, 0.62).save(out('icon-192.png'), optimize=True)
        icon(m, 512, black, white, 0.62).save(out('icon-512.png'), optimize=True)
        icon(m, 512, black, white, 0.48).save(out('icon-maskable-512.png'), optimize=True)  # безопасная зона Android
        icon(m, 180, black, white, 0.62).save(out('apple-touch-icon-dark.png'), optimize=True)
        icon(m, 180, white, black, 0.62).save(out('apple-touch-icon-light.png'), optimize=True)

    # Превью ссылки 1200×630.
    W, H = 1200, 630
    og = Image.new('RGB', (W, H), (9, 16, 30))
    glow = Image.new('L', (W, H), 0)
    gd = ImageDraw.Draw(glow)
    for r in range(420, 0, -6):
        gd.ellipse((290 - r, 315 - r, 290 + r, 315 + r), fill=int(46 * (1 - r / 420)))
    og.paste(Image.new('RGB', (W, H), (40, 110, 220)), (0, 0), glow)
    if args.og_logo:
        big = Image.open(args.og_logo).convert('RGBA')
        big.thumbnail((400, 400), Image.LANCZOS)
        og.paste(big, (290 - big.width // 2, 315 - big.height // 2), big)
    else:
        bm = bounded_mask(m, 360, 360)
        og.paste(Image.new('RGB', bm.size, white), (290 - bm.width // 2, 315 - bm.height // 2), bm)
    d = ImageDraw.Draw(og)
    title_font = font(['segoeuib.ttf', 'DejaVuSans-Bold.ttf', 'Arial Bold.ttf'], 72)
    sub_font = font(['segoeui.ttf', 'DejaVuSans.ttf', 'Arial.ttf'], 34)
    host_font = font(['segoeuib.ttf', 'DejaVuSans-Bold.ttf', 'Arial Bold.ttf'], 32)
    y = 170
    for line in wrap(d, args.title, title_font, 600):
        d.text((560, y), line, font=title_font, fill=white)
        y += 88
    y += 12
    for line in wrap(d, args.subtitle, sub_font, 600):
        d.text((562, y), line, font=sub_font, fill=(176, 190, 210))
        y += 48
    d.text((562, max(y + 40, 440)), args.host, font=host_font, fill=(100, 165, 255))
    og.save(out('og.jpg'), quality=88, optimize=True)

    print('Готово:', ', '.join(sorted(f for f in os.listdir(args.out) if f.endswith(('.png', '.jpg')))))


if __name__ == '__main__':
    main()
