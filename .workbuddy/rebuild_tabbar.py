# -*- coding: utf-8 -*-
"""
重建 tabBar 的 8 张 PNG（4 tab × 选中/未选中）。

背景：Pillow 默认 save() 只写 IHDR/IDAT/IEND，不带 sRGB 块；
微信开发者工具部分版本对缺 sRGB 的 PNG 会渲染成「图片占位符」。
本脚本重画并显式补 sRGB + gAMA，且强制标准 8-bit RGBA、非交错。

源字体用 App 自带的 MaterialCommunityIcons.ttf（保证形状与 App 一致），
码位取子集字体重映射后的 BMP 私有区，与 icons.js 同源。
"""
import os
import json

from PIL import Image, ImageDraw, ImageFont

ENV = r'E:\cc_study\memo-grad-miniprogram'
SUBSET_TTF = os.path.join(ENV, '.workbuddy', 'mci-subset.ttf')
SRC_TTF = r'E:\cc_study\memo-grad\node_modules\@expo\vector-icons\build\vendor\react-native-vector-icons\Fonts\MaterialCommunityIcons.ttf'
GLYPH = r'E:\cc_study\memo-grad\node_modules\@expo\vector-icons\build\vendor\react-native-vector-icons\glyphmaps\MaterialCommunityIcons.json'
OUT = os.path.join(ENV, 'miniprogram', 'assets', 'icons')
ICONS_JS = os.path.join(ENV, 'miniprogram', 'theme', 'icons.js')

SIZE = 96
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
    v = v.strip()
    # 形如 '\ue000' 或 '\\ue000'
    m = v.strip("'").strip('"').replace('\\u', '')
    try:
        cp_of[k] = int(m, 16)
    except ValueError:
        pass

need = [n for _, n in TABS]
missing = [n for n in need if n not in cp_of]
if missing:
    raise SystemExit('icons.js 缺少图标码位: %s' % missing)

# ---- 字体：必须用子集字体（BMP 私有区码位只在子集里有） ----
ttf_used = SUBSET_TTF
glyphmap = json.load(open(GLYPH, encoding='utf-8'))


def render(cp, color, out_path):
    """把某个码位渲染成 SIZE×SIZE、居中、留白的 PNG，补 sRGB 块。"""
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

    # 关键：显式写 sRGB + gAMA，并关掉一切可能引入非标准块的选项
    canvas.save(
        out_path,
        format='PNG',
        optimize=False,
        compress_level=6,
        icc_profile=None,
    )
    # Pillow 的 pnginfo 方式补块（save 之后再补，不能用，故用下面 rebuild 方式）
    return canvas


def add_srgb_chunk(path):
    """在 IHDR 之后插入 sRGB chunk（rendering intent = 0）。"""
    with open(path, 'rb') as f:
        data = bytearray(f.read())

    if b'sRGB' in data:
        return False

    import zlib

    def chunk(ctype, payload):
        c = ctype + payload
        return (len(payload)).to_bytes(4, 'big') + c + (zlib.crc32(c) & 0xffffffff).to_bytes(4, 'big')

    srgb = chunk(b'sRGB', b'\x00')

    # 找 IHDR 结束位置：8(sig) + 4(len) + 4(type) + 13(data) + 4(crc)
    pos = 8 + 12 + 13
    data[pos:pos] = srgb
    with open(path, 'wb') as f:
        f.write(bytes(data))
    return True


os.makedirs(OUT, exist_ok=True)
made = []
for key, icon in TABS:
    p1 = os.path.join(OUT, 'tab-%s.png' % key)
    p2 = os.path.join(OUT, 'tab-%s-active.png' % key)
    render(cp_of[icon], NORMAL, p1)
    render(cp_of[icon], ACTIVE, p2)
    for p in (p1, p2):
        add_srgb_chunk(p)
        made.append((os.path.basename(p), os.path.getsize(p)))

print('字体: %s' % ttf_used)
for n, s in made:
    print('  %-28s %6d B' % (n, s))
print('done')
