"""Строка состояния (время SB_TIME, по умолчанию 15:45 — как в сцене с парой) для экрана телефона в ролике (1179×177 = 393×59 pt @3x).
python3 statusbar.py <папка>  → statusbar-dark.png, -light.png, -airplane.png, -cover.png (с чёрным фоном)
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont

S = 3          # точек на pt
SS = 4         # сглаживание: рисуем крупнее и уменьшаем
W, H = 393, 59
TIME = os.environ.get('SB_TIME', '15:45')
FONT = '/usr/share/fonts/opentype/inter/InterDisplay-SemiBold.otf'


def draw(fg, bg=None, airplane=False, island=False):
    k = S * SS
    im = Image.new('RGBA', (W * k, H * k), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    p = lambda v: round(v * k)
    cy = 30.5  # середина строки (по центру островка)
    # время
    f = ImageFont.truetype(FONT, p(17.5))
    t = TIME
    bb = d.textbbox((0, 0), t, font=f)
    d.text((p(66) - (bb[2] - bb[0]) / 2 - bb[0], p(cy) - (bb[3] - bb[1]) / 2 - bb[1]), t, font=f, fill=fg)
    if island:
        d.rounded_rectangle([p(133.5), p(11), p(259.5), p(48)], radius=p(18.5), fill=(0, 0, 0, 255))
    # батарея 27×13, кончик 1.5×4.5
    bx, by = 334.5, cy - 6.5
    d.rounded_rectangle([p(bx), p(by), p(bx + 25), p(by + 13)], radius=p(4.2), outline=fg[:3] + (100,), width=p(1.1))
    d.rounded_rectangle([p(bx + 2.2), p(by + 2.2), p(bx + 22.8), p(by + 10.8)], radius=p(2.5), fill=fg)
    d.rounded_rectangle([p(bx + 26.2), p(cy - 2.3), p(bx + 27.8), p(cy + 2.3)], radius=p(1), fill=fg[:3] + (110,))
    if airplane:
        # самолёт: фюзеляж, крылья, хвост
        ax, ay = 308, cy
        d.rounded_rectangle([p(ax - 1.3), p(ay - 8), p(ax + 1.3), p(ay + 7)], radius=p(1.3), fill=fg)
        d.polygon([(p(ax - 1), p(ay - 3)), (p(ax - 9), p(ay + 2)), (p(ax - 9), p(ay + 3.6)), (p(ax), p(ay + 0.6)),
                   (p(ax + 9), p(ay + 3.6)), (p(ax + 9), p(ay + 2)), (p(ax + 1), p(ay - 3))], fill=fg)
        d.polygon([(p(ax - 0.8), p(ay + 4)), (p(ax - 4.5), p(ay + 7.2)), (p(ax - 4.5), p(ay + 8.2)), (p(ax), p(ay + 6.6)),
                   (p(ax + 4.5), p(ay + 8.2)), (p(ax + 4.5), p(ay + 7.2)), (p(ax + 0.8), p(ay + 4))], fill=fg)
    else:
        # сигнал: 4 столбика
        for i in range(4):
            h = 4 + i * 2.6
            x = 287 + i * 4.6
            d.rounded_rectangle([p(x), p(cy + 5.5 - h), p(x + 3.1), p(cy + 5.5)], radius=p(1), fill=fg)
        # wi-fi: три дуги и точка
        wx, wy = 316.5, cy + 5.2
        for r, wd in ((12.5, 2.4), (8.3, 2.4), (4.2, 2.4)):
            d.arc([p(wx - r), p(wy - r), p(wx + r), p(wy + r)], start=225, end=315, fill=fg, width=p(wd))
        d.pieslice([p(wx - 2.2), p(wy - 2.2), p(wx + 2.2), p(wy + 2.2)], start=225, end=315, fill=fg)
    return im.resize((W * S, H * S), Image.LANCZOS)


out = sys.argv[1]
os.makedirs(out, exist_ok=True)
draw((255, 255, 255, 255)).save(os.path.join(out, 'statusbar-dark.png'))
draw((0, 0, 0, 255)).save(os.path.join(out, 'statusbar-light.png'))
draw((255, 255, 255, 255), airplane=True).save(os.path.join(out, 'statusbar-airplane.png'))
draw((255, 255, 255, 255), bg=(0, 0, 0, 255)).save(os.path.join(out, 'statusbar-cover.png'))
print('ok')
