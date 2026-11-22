import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

W, H = 1440, 1080          # 4:3 画布
CW, CH = 1920, 1080        # 内容设计网格
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'preview', 'cover-4x3.png')
SHOT = os.path.join(ROOT, 'preview', 'source-timeline.png')
FONT_CN_BOLD = 'C:/Windows/Fonts/msyhbd.ttc'
FONT_CN = 'C:/Windows/Fonts/msyh.ttc'
FONT_EN_BOLD = 'C:/Windows/Fonts/arialbd.ttf'
ACCENT = (255, 220, 112)

os.makedirs(os.path.dirname(OUT), exist_ok=True)


def font(path, size):
    return ImageFont.truetype(path, size)


# ── 4:3 背景：渐变 + 柔光 + 暗角 + 水印 ─────────────────────
xs = np.linspace(0, 1, W)
ys = np.linspace(0, 1, H)
X, Y = np.meshgrid(xs, ys)
t = np.clip(X * 0.62 + Y * 0.38, 0, 1)
c1 = np.array([43, 27, 78], float)
c2 = np.array([12, 14, 20], float)
rgb = c1[None, None, :] * (1 - t)[:, :, None] + c2[None, None, :] * t[:, :, None]
img = Image.fromarray(rgb.astype(np.uint8), 'RGB').convert('RGBA')

glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse([int(W * 0.42), 20, int(W * 1.15), H], fill=(104, 74, 255, 70))
img = Image.alpha_composite(img, glow.filter(ImageFilter.GaussianBlur(110)))

yy, xx = np.mgrid[0:H, 0:W]
dist = np.sqrt(((xx - W / 2) / (W * 0.60)) ** 2 + ((yy - H / 2) / (H * 0.60)) ** 2)
v = np.clip((dist - 0.55) / 0.85, 0, 1) * 150
img = Image.composite(Image.new('RGBA', (W, H), (0, 0, 0, 255)), img,
                      Image.fromarray(v.astype(np.uint8), 'L'))

wm = Image.new('RGBA', (1100, 220), (0, 0, 0, 0))
ImageDraw.Draw(wm).text((0, 0), 'HIGHLIGHT', font=font(FONT_EN_BOLD, 150), fill=(255, 255, 255, 28))
img.alpha_composite(wm, (60, 890))

# ── 内容层（1920×1080，最后整体缩放内收） ───────────────────
content = Image.new('RGBA', (CW, CH), (0, 0, 0, 0))
draw = ImageDraw.Draw(content)

draw.rounded_rectangle([100, 118, 204, 128], radius=4, fill=ACCENT + (255,))
draw.text((96, 146), '自定义节拍高亮', font=font(FONT_CN_BOLD, 96), fill=(255, 255, 255, 255))

sub_font = font(FONT_EN_BOLD, 26)
sx = 104
for ch in 'CUSTOM BEAT HIGHLIGHT':
    draw.text((sx, 268), ch, font=sub_font, fill=ACCENT + (255,))
    sx += draw.textlength(ch, font=sub_font) + 4

draw.text((104, 316), '分级网格高亮 · 自定义吸附', font=font(FONT_CN, 24), fill=(192, 192, 202, 255))

# 左侧截图
tx0, ty0, tw = 100, 386, 900
shot = Image.open(SHOT).convert('RGBA')
th = int(round(tw * shot.height / shot.width))
scale = max(tw / shot.width, th / shot.height)
sw, sh = int(round(shot.width * scale)), int(round(shot.height * scale))
shot = shot.resize((sw, sh), Image.LANCZOS)
sx0 = (sw - tw) // 2
sy0 = (sh - th) // 2
shot = shot.crop((sx0, sy0, sx0 + tw, sy0 + th))

mask = Image.new('L', (tw, th), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, tw - 1, th - 1], radius=14, fill=255)
content.paste(shot, (tx0, ty0), mask)
draw = ImageDraw.Draw(content)
draw.rounded_rectangle([tx0, ty0, tx0 + tw, ty0 + th], radius=14, outline=(44, 47, 56, 255), width=2)


# 右侧倾斜设置面板
def build_panel():
    pw, ph = 780, 720
    p = Image.new('RGBA', (pw, ph), (0, 0, 0, 0))
    d = ImageDraw.Draw(p)
    d.rounded_rectangle([1, 1, pw - 2, ph - 2], radius=18, fill=(27, 29, 36, 255), outline=(46, 49, 58, 255), width=2)
    d.text((28, 18), '自定义节拍高亮', font=font(FONT_CN_BOLD, 27), fill=(240, 240, 243, 255))
    d.text((pw - 48, 14), '×', font=font(FONT_EN_BOLD, 30), fill=(150, 150, 162, 255))
    d.line([0, 66, pw, 66], fill=(46, 49, 58, 255), width=2)

    hf = font(FONT_CN, 19)
    d.text((32, 82), '拍型', font=hf, fill=(150, 150, 160, 255))
    d.text((312, 82), '是否高亮', font=hf, fill=(150, 150, 160, 255))
    d.text((452, 82), '颜色', font=hf, fill=(150, 150, 160, 255))
    d.text((520, 82), '粗细', font=hf, fill=(150, 150, 160, 255))

    rows = [
        ('整拍 1/1', True, (242, 239, 233), '1.8'),
        ('1/2', True, (255, 77, 77), '1.6'),
        ('1/3', False, (74, 174, 255), '1.2'),
        ('1/4', True, (255, 194, 61), '1.2'),
        ('1/6', False, (177, 140, 255), '1.0'),
        ('1/8', False, (61, 214, 160), '1.0'),
        ('1/12', False, (255, 127, 150), '1.0'),
        ('1/16', False, (182, 240, 74), '0.8'),
    ]
    name_f = font(FONT_CN, 22)
    val_f = font(FONT_EN_BOLD, 18)
    for i, (name, on, color, thick) in enumerate(rows):
        ry = 118 + i * 70
        d.rounded_rectangle([18, ry - 6, pw - 18, ry + 52], radius=10, fill=(33, 35, 42, 255))
        d.text((34, ry + 8), name, font=name_f, fill=(212, 212, 220, 255))
        tx = 312
        if on:
            d.rounded_rectangle([tx, ry + 6, tx + 58, ry + 34], radius=14, fill=ACCENT + (255,))
            d.ellipse([tx + 31, ry + 8, tx + 57, ry + 32], fill=(38, 38, 42, 255))
        else:
            d.rounded_rectangle([tx, ry + 6, tx + 58, ry + 34], radius=14, fill=(68, 68, 76, 255))
            d.ellipse([tx + 1, ry + 8, tx + 27, ry + 32], fill=(182, 182, 192, 255))
        d.rounded_rectangle([452, ry + 6, 492, ry + 34], radius=6, fill=color + (255,))
        d.text((520, ry + 11), thick, font=val_f, fill=(190, 190, 200, 255))
    return p


panel = build_panel()
rotated = panel.rotate(-6, expand=True, resample=Image.BICUBIC)
shadow_mask = rotated.split()[-1]
shadow = Image.new('RGBA', rotated.size, (0, 0, 0, 0))
shadow.paste((0, 0, 0, 155), (0, 0), shadow_mask)
shadow = shadow.filter(ImageFilter.GaussianBlur(22))
content.alpha_composite(shadow, (1078, 200))
content.alpha_composite(rotated, (1066, 176))

# ── 缩放内收，居中放到 4:3 画布 ─────────────────────────────
margin = 60
scale = (W - 2 * margin) / CW
scaled = content.resize((int(CW * scale), int(CH * scale)), Image.LANCZOS)
img.alpha_composite(scaled, (margin, (H - scaled.height) // 2))

img.convert('RGB').save(OUT, quality=95)
print(OUT)
print(img.size)
