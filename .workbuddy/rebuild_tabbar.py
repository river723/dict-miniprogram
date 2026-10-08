# -*- coding: utf-8 -*-
"""
重建 tabBar 的 8 张 PNG（4 tab × 选中/未选中）。

背景：Pillow 默认 save() 只写 IHDR/IDAT/IEND，不带色彩块；
微信开发者工具部分版本对缺色彩块的 PNG 会渲染成「灰色占位方块 / 图片占位符」。
本脚本重画并显式补 gAMA + sRGB，且强制标准 8-bit RGBA、非交错。

⚠️ 历史教训：上一版只补了 sRGB、漏了 gAMA（文档写了却没实现），
   在某些开发者工具版本下仍会被判为「不合规图片」→ 占位方块。本版两者都补。

源字体用 App 自带的 MaterialCommunityIcons 子集字体（保证形状与 App 一致），
码位取子集字体重映射后的 BMP 私有区，与 theme/icons.js 同源。
"""
import os
import zlib

from PIL import Image, ImageDraw, ImageFont

ENV = r'E:\cc_study\memo-grad-miniprogram'
SUBSET_TTF = os.path.join(ENV, '.workbuddy', 'mci-subset.ttf')
OUT = os.path.join(ENV, 'miniprogram', 'assets', 'icons')
ICONS_JS = os.path.join(ENV, 'miniprogram', 'theme', 'icons.js')

SIZE = 81  # 官方推荐 tabBar 图标尺寸；实测非 81×81 在部分开发者工具版本会渲染成「灰色方块」
NORMAL = (0x8A, 0x8E, 0x89, 255)
ACTIVE = (0x2E, 0x5E, 0x4E, 255)

TABS = [
    ('study', 'book-open-page-variant'),
    ('read', 'book-open-page-variant-outline'),
    ('practice', 'puzzle'),
    ('profile', 'account'),
]

# ---- 取每个图标名 -> BMP 私有区码位：直接从已生成的 icons.js 读，保证同源 ----
src = open(ICONS_JS, encoding='utf-8').read()
start = src.index('ICONS')
start = src.index('{', start)
end = src.index('};', start)
body = src[start + 1:end]

cp_of = {}
for pair in body.split(','):
    pair = pair.strip()
    if not pair or ':' not in pair:
        continue
    k, v = pair.split(':', 1)
    k = k.strip().strip("'").strip('"')
    v = v.strip().strip("'").strip('"').replace('\\u', '')
    try:
        cp_of[k] = int(v, 16)
    except ValueError:
        pass

need = [n for _, n in TABS]
missing = [n for n in need if n not in cp_of]
if missing:
    raise SystemExit('icons.js 缺少图标码位: %s' % missing)

ttf_used = SUBSET_TTF


def render(cp, color):
    """把某个码位渲染成 SIZE×SIZE、居中、留白的 RGBA 图，返回 Image。"""
    big = SIZE * 6
    f = ImageFont.truetype(ttf_used, big)
    ch = chr(cp)
    img = Image.new('RGBA', (big * 2, big * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((big, big), ch, font=f, fill=color)
    bbox = img.getbbox()
    if not bbox:
        raise RuntimeError('空字形: U+%04X' % cp)
    img = img.crop(bbox)
    target = int(SIZE * 0.86)
    w, h = img.size
    scale = target / max(w, h)
    img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(img, ((SIZE - img.width) // 2, (SIZE - img.height) // 2), img)
    return canvas


def png_chunk(ctype, payload):
    c = ctype + payload
    return (len(payload)).to_bytes(4, 'big') + c + (zlib.crc32(c) & 0xffffffff).to_bytes(4, 'big')


def add_color_chunks(path):
    """在 IHDR 之后插入 gAMA + sRGB（顺序符合 PNG 规范：IHDR → gAMA → sRGB → IDAT）。"""
    with open(path, 'rb') as f:
        data = bytearray(f.read())

    if b'gAMA' in data and b'sRGB' in data:
        return False

    # gAMA = gamma*100000；sRGB 的推荐值 45455（约 1/2.2）
    # sRGB chunk payload = 1 字节 rendering intent（0 = Perceptual）
    gama = png_chunk(b'gAMA', (45455).to_bytes(4, 'big'))
    srgb = png_chunk(b'sRGB', b'\x00')

    # 找 IHDR 结束位置：8(sig) + 4(len) + 4(type) + 13(data) + 4(crc)
    pos = 8 + 12 + 13
    data[pos:pos] = gama + srgb
    with open(path, 'wb') as f:
        f.write(bytes(data))
    return True


os.makedirs(OUT, exist_ok=True)
made = []
for key, icon in TABS:
    p1 = os.path.join(OUT, 'tab-%s.png' % key)
    p2 = os.path.join(OUT, 'tab-%s-active.png' % key)
    render(cp_of[icon], NORMAL).save(p1, format='PNG', optimize=False, compress_level=6)
    render(cp_of[icon], ACTIVE).save(p2, format='PNG', optimize=False, compress_level=6)
    for p in (p1, p2):
        add_color_chunks(p)
        made.append((os.path.basename(p), os.path.getsize(p)))

print('字体: %s' % ttf_used)
for n, s in made:
    print('  %-28s %6d B' % (n, s))
print('done')
