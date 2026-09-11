# -*- coding: utf-8 -*-
"""独立校验：新字体（BMP 重映射）渲染出的图标，与 App 原字体是否一致。
对比方式：渲染 -> 裁剪到墨迹 -> 归一到 32x32 -> 计算平均绝对差(MAD)。
同时输出两张网格图（原字体 / 新字体），可直接肉眼比对。"""
import io, json, os, re
from PIL import Image, ImageDraw, ImageFont

B = r'E:\cc_study\memo-grad-miniprogram\.workbuddy'
MP = r'E:\cc_study\memo-grad-miniprogram\miniprogram'
V = r'E:\cc_study\memo-grad\node_modules\@expo\vector-icons\build\vendor\react-native-vector-icons'
TTF_OLD = os.path.join(V, 'Fonts', 'MaterialCommunityIcons.ttf')
TTF_NEW = os.path.join(B, 'mci-subset.ttf')
GLYPH = os.path.join(V, 'glyphmaps', 'MaterialCommunityIcons.json')

gm = json.load(io.open(GLYPH, encoding='utf-8'))
js = io.open(os.path.join(MP, 'theme', 'icons.js'), encoding='utf-8').read()
block = js[js.index('const ICONS'):js.index('function iconChar')]
pairs = re.findall(r"'([a-z0-9-]+)':\s*'\\u([0-9a-fA-F]{4,6})'", block)


def norm(path, ch, size=96, n=32):
    f = ImageFont.truetype(path, size)
    img = Image.new('L', (240, 240), 0)
    ImageDraw.Draw(img).text((120, 120), ch, font=f, fill=255, anchor='mm')
    bb = img.getbbox()
    if not bb:
        return None
    return img.crop(bb).resize((n, n), Image.LANCZOS)


mad_list, empties = [], []
for name, hexcp in pairs:
    cp_new = int(hexcp, 16)
    cp_old = gm.get(name)
    a = norm(TTF_OLD, chr(cp_old)) if cp_old is not None else None
    b = norm(TTF_NEW, chr(cp_new))
    if a is None or b is None:
        empties.append(name)
        continue
    pa, pb = a.tobytes(), b.tobytes()
    mad_list.append((name, sum(abs(x - y) for x, y in zip(pa, pb)) / len(pa)))

mad_list.sort(key=lambda t: -t[1])
mads = [m for _, m in mad_list]
summary = {
    'mapped': len(pairs),
    'empty_render': empties,
    'codepoint_lt_0x10000': all(int(h, 16) < 0x10000 for _, h in pairs),
    'cp_min': 'U+%04X' % min(int(h, 16) for _, h in pairs),
    'cp_max': 'U+%04X' % max(int(h, 16) for _, h in pairs),
    'mad_avg': round(sum(mads) / len(mads), 2),
    'mad_max': round(mads[0], 2),
    'mad_over_12': [n for n, m in mad_list if m > 12],
    'worst8': [(n, round(m, 2)) for n, m in mad_list[:8]],
}
io.open(os.path.join(B, '_verify_icons.json'), 'w', encoding='utf-8').write(
    json.dumps(summary, ensure_ascii=False, indent=1))


def grid(ttf, path, color, cp_of):
    """cp_of: name -> 该字体里对应的码位（原字体用 glyphmap，新字体用重映射后的）。"""
    CELL, COLS, FONT = 60, 12, 46
    rows = (len(pairs) + COLS - 1) // COLS
    img = Image.new('L', (COLS * CELL, rows * CELL), 255)
    f = ImageFont.truetype(ttf, FONT)
    d = ImageDraw.Draw(img)
    for i, (name, _h) in enumerate(pairs):
        x, y = (i % COLS) * CELL, (i // COLS) * CELL
        d.text((x + CELL // 2, y + CELL // 2), chr(cp_of(name)), font=f, fill=color, anchor='mm')
    img.save(path)
    return path


grid(TTF_OLD, os.path.join(B, 'grid_before.png'), 60, lambda n: gm[n])
grid(TTF_NEW, os.path.join(B, 'grid_after.png'), 0, lambda n: int(dict(pairs)[n], 16))
print('ok')
