# -*- coding: utf-8 -*-
"""
生成小程序图标资源：
1) 用 App 的 MaterialCommunityIcons.ttf 子集化出 icons.ttf，base64 内联进 theme/icons.wxss
   —— 页面内图标与 App 形状 100% 一致，且颜色任意（font color 继承）。
2) 用同一字体渲染 tabBar 所需的 PNG（每个 tab 选中/未选中各一张）。
3) 输出 name -> unicode 字符 的映射 JS，供 mg-icon 组件使用。
"""
import os, json, base64, io, sys

from PIL import Image, ImageDraw, ImageFont

ENV = r'E:\cc_study\memo-grad-miniprogram'
TTF = r'E:\cc_study\memo-grad\node_modules\@expo\vector-icons\build\vendor\react-native-vector-icons\Fonts\MaterialCommunityIcons.ttf'
GLYPH = r'E:\cc_study\memo-grad\node_modules\@expo\vector-icons\build\vendor\react-native-vector-icons\glyphmaps\MaterialCommunityIcons.json'

OUT_ASSETS = os.path.join(ENV, 'miniprogram', 'assets', 'icons')
OUT_THEME = os.path.join(ENV, 'miniprogram', 'theme')
WORK = os.path.join(ENV, '.workbuddy')

os.makedirs(OUT_ASSETS, exist_ok=True)
os.makedirs(OUT_THEME, exist_ok=True)

glyphmap = json.load(open(GLYPH, encoding='utf-8'))

# ---- 需要打进子集字体的图标 ----
detected = [n for n, _ in json.load(open(os.path.join(WORK, '_icons_full.json'), encoding='utf-8'))['icons']]
extras = """
volume-high volume-off magnify magnify-close close close-circle-outline check check-circle check-bold
plus plus-box minus pencil pencil-outline pencil-plus delete-outline delete-forever trash-can-outline
arrow-left arrow-right arrow-up-thin arrow-down-thin chevron-left chevron-right chevron-up chevron-down
book-open-page-variant book-open-page-variant-outline book-open-variant book-multiple book-search
book-plus book-check-outline book-education-outline library library-books bookshelf
puzzle account account-plus account-circle-outline card-account-details card-text
refresh reload restart sync shuffle sort sort-variant filter-variant tune
alert-circle-outline alert-circle alert-outline information-outline help-circle-outline
chart-line chart-bar chart-line-variant chart-donut trending-up percent
cog cog-outline tune-variant database-outline cloud-off cloud-sync-outline
auto-fix creation robot-outline lightbulb-outline lightning-bolt lightning-bolt-outline
content-save file-document file-document-outline file-document-edit note-text-outline text-box-outline
format-list-bulleted format-list-numbered format-letter-matches text translate
ear-hearing ear-hearing-off headset headphones microphone-outline account-voice speaker
history clock-outline timer-outline calendar-check play play-circle play-circle-outline
star star-outline crown crown-outline trophy-outline fire school shield shield-crown
eye eye-off lock-outline key-variant logout exit-to-app open-in-new home menu wechat
folders-outline inbox-outline emoticon-happy-outline party-popper thumb-up thumb-down
volume-vibrate white-balance-sunny weather-night theme-light-dark palette-outline brightnes-6 brightness-6
circle-outline checkbox-marked-circle-outline radiobox-marked numeric alpha format-quote-open
flask memory lightning-bolt devices monitor cellphone laptop android api gift receipt shopping
clipboard-text-multiple check-decagram-outline nature restore import export
""".split()

names = []
seen = set()
for n in list(detected) + extras:
    if n in glyphmap and n not in seen:
        seen.add(n)
        names.append(n)

# 兜底必须存在
assert 'alert-circle-outline' in glyphmap

# ---- 1) 子集化字体 + 码位重映射到 BMP 私有区 ----
#
# 为什么要重映射（血的教训，改动前务必读完）：
#   MaterialCommunityIcons 的码位是 5 位十六进制（如 f0708 = U+F0708），落在
#   补充平面 SPUA-A。直接用它有两个坑：
#     a) JS 的 \uXXXX 转义只吃 4 位，'\uf0708' 会被解析成 U+F070 + '8'，
#        图标就渲染成「豆腐块 + 一个字母/数字」；
#     b) 补充平面字符配合 WebView 自定义字体的渲染在部分机型上不可靠。
#   所以统一把字形搬到 U+E000 起的 BMP 私有区，一个图标一个码位。
#   映射表由 cp_of 决定，icons.js / icons.wxs / tabBar PNG 全部以它为准。
from fontTools import subset as ftsubset
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables._c_m_a_p import CmapSubtable

cps = sorted({glyphmap[n] for n in names})

_src = TTFont(TTF)
_src_cmap = _src.getBestCmap()  # codepoint(int) -> glyph name
glyph_of = {}
for n in names:
    g = _src_cmap.get(glyphmap[n])
    if g is None:
        raise RuntimeError('glyphmap 与字体不一致，缺字形: %s (U+%X)' % (n, glyphmap[n]))
    glyph_of[n] = g

BASE_CP = 0xE000
cp_of = {n: BASE_CP + i for i, n in enumerate(names)}

opts = ftsubset.Options()
opts.notdef_outline = True
opts.recalc_bounds = True
opts.drop_tables += ['DSIG']
opts.layout_features = ['*']
opts.name_IDs = ['*']
opts.name_legacy = True

font = ftsubset.load_font(TTF, opts)
s = ftsubset.Subsetter(options=opts)
s.populate(unicodes=cps)
s.subset(font)

# 丢掉原 cmap，换成只有 BMP 私有区新码位的 format 4 表
missing = [n for n in names if glyph_of[n] not in font.getGlyphOrder()]
if missing:
    raise RuntimeError('子集后字形丢失: %s' % ', '.join(missing[:5]))

font['cmap'].tables = []
_sub = CmapSubtable.newSubtable(4)
_sub.platformID, _sub.platEncID, _sub.language = 3, 1, 0
_sub.cmap = {cp_of[n]: glyph_of[n] for n in names}
font['cmap'].tables.append(_sub)

ttf_tmp = os.path.join(WORK, 'mci-subset.ttf')
ftsubset.save_font(font, ttf_tmp, opts)

raw = open(ttf_tmp, 'rb').read()
b64 = base64.b64encode(raw).decode('ascii')

# ---- 1b) 自检：核对码位映射，并用字形轮廓比对证明字形未被改动 ----
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

# ---- 1c) 写出内联 base64 字体的 WXSS ----
wxss = """/* 由脚本生成，请勿手改 —— 图标字体（MaterialCommunityIcons 子集）。
 * 形状与 memo-grad App 完全一致；颜色直接由 color 控制，字号由 font-size 控制。 */
@font-face {
  font-family: 'mgIcons';
  src: url('data:font/truetype;charset=utf-8;base64,%s') format('truetype');
  font-weight: normal;
  font-style: normal;
}

.mg-icon {
  font-family: 'mgIcons';
  font-weight: normal;
  font-style: normal;
  display: inline-block;
  line-height: 1;
  text-align: center;
  speak: none;
  -webkit-font-smoothing: antialiased;
}

.mg-icon--disabled { opacity: 0.35; }
""" % b64

# ---- 2) name -> 字符 映射 ----
pairs = ',\n  '.join("'%s': '\\u%04x'" % (n, cp_of[n]) for n in names)
js = """/**
 * 图标名 -> 字符 映射（由脚本生成，请勿手改）。
 * 与 memo-grad App 使用的 MaterialCommunityIcons 同名同形。
 * 字体见 theme/icons.wxss（@import 后在 WXML 里用 <mg-icon name="..." />）。
 */
const ICONS = {
  %s
};

const FALLBACK = 'alert-circle-outline';

/** 取图标字符；未知名字回退到警示图标。 */
function iconChar(name) {
  return ICONS[name] || ICONS[FALLBACK];
}

module.exports = { ICONS, iconChar, FALLBACK, COUNT: %d };
""" % (pairs, len(names))

open(os.path.join(OUT_THEME, 'icons.js'), 'w', encoding='utf-8').write(js)

# ---- 2b) WXS 版本（WXML 里可直接 {{ic.icon('plus')}} 使用） ----
wxs_pairs = ', '.join("'%s': '%s'" % (n, chr(cp_of[n])) for n in names)
wxs = """/* 由脚本生成，请勿手改 —— 图标名 -> 字符（WXS 版）。
 * 用法：<wxs src="../../utils/icons.wxs" module="ic" />
 *       <text class="mg-icon" style="font-size:40rpx">{{ic.icon('plus-box')}}</text>
 */
var ICONS = { %s };

function icon(name) {
  var c = ICONS[name];
  return c ? c : ICONS['alert-circle-outline'];
}

module.exports = { icon: icon, ICONS: ICONS };
""" % wxs_pairs
os.makedirs(os.path.join(ENV, 'miniprogram', 'utils'), exist_ok=True)
open(os.path.join(ENV, 'miniprogram', 'utils', 'icons.wxs'), 'w', encoding='utf-8').write(wxs)


# ---- 3) tabBar PNG ----
TABS = [
    ('study', 'book-open-page-variant'),
    ('read', 'book-open-page-variant-outline'),
    ('practice', 'puzzle'),
    ('profile', 'account'),
]
NORMAL = (0x8A, 0x8E, 0x89, 255)
ACTIVE = (0x2E, 0x5E, 0x4E, 255)
SIZE = 96


def render(name, color, out_path):
    ch = chr(cp_of[name])
    big = SIZE * 6
    f = ImageFont.truetype(ttf_tmp, big)
    img = Image.new('RGBA', (big * 2, big * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.text((big, big), ch, font=f, fill=color)
    bbox = img.getbbox()
    if not bbox:
        raise RuntimeError('empty glyph: ' + name)
    img = img.crop(bbox)
    target = int(SIZE * 0.86)
    w, h = img.size
    scale = target / max(w, h)
    img = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS)
    canvas = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(img, ((SIZE - img.width) // 2, (SIZE - img.height) // 2), img)
    canvas.save(out_path)


pngs = []
for key, icon in TABS:
    p1 = os.path.join(OUT_ASSETS, 'tab-%s.png' % key)
    p2 = os.path.join(OUT_ASSETS, 'tab-%s-active.png' % key)
    render(icon, NORMAL, p1)
    render(icon, ACTIVE, p2)
    pngs += [os.path.basename(p1), os.path.basename(p2)]

report = {
    'font_glyphs': len(names),
    'ttf_bytes': len(raw),
    'wxss_bytes': len(wxss),
    'codepoint_range': 'U+%04X - U+%04X' % (BASE_CP, BASE_CP + len(names) - 1),
    'verify': _verify,
    'verify_ok': not (_verify['bad_cmap'] or _verify['outline_diff'] or _verify['blank']),
    'tabbar_pngs': pngs,
    'assets_dir': OUT_ASSETS,
    'theme_dir': OUT_THEME,
}
open(os.path.join(WORK, '_icons_report.json'), 'w', encoding='utf-8').write(
    json.dumps(report, ensure_ascii=False, indent=1))
print('ok')
