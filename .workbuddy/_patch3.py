# -*- coding: utf-8 -*-
"""把自检从「像素比对」升级成「字形轮廓比对」——像素比对会被 hinting/重采样干扰。"""
import io

P = r'E:\cc_study\memo-grad-miniprogram\.workbuddy\build_icons.py'
s = io.open(P, encoding='utf-8').read()

NEW = '''# ---- 1b) 自检：核对码位映射，并用字形轮廓比对证明字形未被改动 ----
from fontTools.pens.recordingPen import RecordingPen

_rd = TTFont(ttf_tmp)
_rd_cmap = _rd.getBestCmap()
_verify = {'bad_cmap': [], 'outline_diff': [], 'blank': []}


def _outline(glyphset, glyphname):
    """取字形的绘制指令（轮廓坐标）。同名字形在不同字体文件里应当完全一致。"""
    pen = RecordingPen()
    glyphset[glyphname].draw(pen)
    return pen.value


_src_gs = _src.getGlyphSet()
_rd_gs = _rd.getGlyphSet()
_f = ImageFont.truetype(ttf_tmp, 64)

for n in names:
    g_new = _rd_cmap.get(cp_of[n])
    if g_new is None:
        _verify['bad_cmap'].append(n)
        continue
    if _outline(_src_gs, glyph_of[n]) != _outline(_rd_gs, g_new):
        _verify['outline_diff'].append(n)
    # 再渲染一次，确保不是空字形 / .notdef
    img = Image.new('L', (112, 112), 0)
    ImageDraw.Draw(img).text((56, 56), chr(cp_of[n]), font=_f, fill=255, anchor='mm')
    if not img.getbbox():
        _verify['blank'].append(n)

'''

start = s.index('# ---- 1b)')
end = s.index('# ---- 2) name -> 字符 映射 ----')
s = s[:start] + NEW + s[end:]

s = s.replace("_verify['render_diff']", "_verify['outline_diff']")

io.open(P, 'w', encoding='utf-8', newline='\n').write(s)
print('patched; outline-based verify installed')
