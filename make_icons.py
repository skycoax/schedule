# -*- coding: utf-8 -*-
"""
Иконки приложения для site/. Нужны, чтобы Android показал системное окно
установки: без иконок 192 и 512 px браузер кнопку «Установить» не предлагает.

Рисуем то же, что показывает приложение — полосу дня: шесть слотов, часть занята.
"""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'site')
if not os.path.isdir(OUT):
    os.makedirs(OUT)

BG = (255, 255, 255)
SLOTS = [
    (0, (232, 233, 236)),      # свободно
    (1, (0, 122, 255)),        # синий
    (1, (255, 149, 0)),        # оранжевый
    (1, (52, 199, 89)),        # зелёный
    (0, (232, 233, 236)),
    (0, (232, 233, 236)),
]


def draw(size, maskable=False):
    img = Image.new('RGBA', (size, size), BG + (255,))
    d = ImageDraw.Draw(img)
    # У maskable-иконки края обрезаются, поэтому рисунок делаем компактнее.
    pad = size * (0.26 if maskable else 0.17)
    inner = size - pad * 2
    gap = inner * 0.055
    bar_h = (inner - gap * 5) / 6.0
    r = bar_h * 0.36
    for i, (busy, color) in enumerate(SLOTS):
        y0 = pad + i * (bar_h + gap)
        d.rounded_rectangle([pad, y0, pad + inner, y0 + bar_h],
                            radius=r, fill=color + (255,))
    return img


for s in (192, 512):
    draw(s).save(os.path.join(OUT, 'icon-%d.png' % s))
    print('icon-%d.png' % s)

draw(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
print('icon-maskable-512.png')
