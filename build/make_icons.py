# Gera os ícones do app (PNG, ICO, ICNS e bandeja) sem depender de arquivos externos.
from PIL import Image, ImageDraw, ImageFilter
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
S = 1024

def glyph(d, scale, ox, oy, color, w):
    # "M" + duas barras de áudio (mesmo desenho do logo da interface, viewBox 32)
    P = lambda x, y: (ox + x * scale, oy + y * scale)
    d.line([P(7, 21), P(7, 11), P(12, 17), P(17, 11), P(17, 21)], fill=color, width=w, joint='curve')
    for (x, y0, y1) in [(21, 13, 19), (25, 10.5, 21.5)]:
        d.line([P(x, y0), P(x, y1)], fill=color, width=w)
    r = w / 2
    for (x, y) in [(7, 21), (17, 21), (7, 11), (17, 11), (12, 17), (21, 13), (21, 19), (25, 10.5), (25, 21.5)]:
        cx, cy = P(x, y); d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)

def app_icon(size=S):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    pad = int(size * 0.1); box = size - 2 * pad; rad = int(box * 0.225)
    # sombra
    sh = Image.new('RGBA', (size, size), (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([pad, pad + size * 0.012, pad + box, pad + box + size * 0.012], rad, fill=(0, 0, 0, 90))
    img = Image.alpha_composite(img, sh.filter(ImageFilter.GaussianBlur(size * 0.02)))
    # gradiente
    grad = Image.new('RGBA', (box, box)); gp = grad.load()
    top, bot = (86, 116, 236), (40, 58, 160)
    for y in range(box):
        t = y / box; c = tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3))
        for x in range(box): gp[x, y] = c + (255,)
    mask = Image.new('L', (box, box), 0); ImageDraw.Draw(mask).rounded_rectangle([0, 0, box - 1, box - 1], rad, fill=255)
    img.paste(grad, (pad, pad), mask)
    # brilho sutil
    hl = Image.new('RGBA', (size, size), (0, 0, 0, 0)); hd = ImageDraw.Draw(hl)
    hd.rounded_rectangle([pad, pad, pad + box, pad + box * 0.5], rad, fill=(255, 255, 255, 22))
    img = Image.alpha_composite(img, hl)
    d = ImageDraw.Draw(img)
    scale = box / 32 * 0.86; ox = pad + (box - 32 * scale) / 2; oy = pad + (box - 32 * scale) / 2
    glyph(d, scale, ox, oy, (255, 255, 255, 255), int(scale * 2.7))
    return img

big = app_icon(S)
big.save(os.path.join(OUT, 'icon.png'))
big.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-512.png'))
big.save(os.path.join(OUT, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
big.save(os.path.join(OUT, 'icon.icns'))

def tray(name, size, color, rec=False):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    scale = size / 32 * 1.15; o = (size - 32 * scale) / 2
    glyph(d, scale, o - scale * 1.2, o, color, max(2, int(scale * 2.8)))
    if rec:
        r = size * 0.2; cx, cy = size - r - 1, size - r - 1
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(229, 72, 77, 255) if color[0] else (0, 0, 0, 255))
    img.save(os.path.join(OUT, name))

for suf, sz in [('', 16), ('@2x', 32)]:
    tray(f'trayTemplate{suf}.png', sz, (0, 0, 0, 255))
    tray(f'trayRecTemplate{suf}.png', sz, (0, 0, 0, 255), rec=True)
tray('tray.png', 32, (40, 58, 160, 255)); tray('tray-rec.png', 32, (40, 58, 160, 255), rec=True)
print('ok')
