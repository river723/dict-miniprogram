import os, re, json, collections

GM = r'E:\cc_study\memo-grad\node_modules\@expo\vector-icons\build\vendor\react-native-vector-icons\glyphmaps\MaterialCommunityIcons.json'
glyphmap = json.load(open(GM, encoding='utf-8'))
names = set(glyphmap.keys())

SRC = [r'E:\cc_study\memo-grad\src', r'E:\cc_study\memo-grad\App.tsx']
counter = collections.Counter()

files = []
for s in SRC:
    if os.path.isfile(s):
        files.append(s)
    else:
        for dp, dn, fns in os.walk(s):
            for fn in fns:
                if fn.endswith(('.tsx', '.ts')):
                    files.append(os.path.join(dp, fn))

tok = re.compile(r"['\"]([a-z0-9][a-z0-9-]{1,40})['\"]")
for p in files:
    try:
        txt = open(p, encoding='utf-8', errors='ignore').read()
    except Exception:
        continue
    for m in tok.finditer(txt):
        t = m.group(1)
        if t in names:
            counter[t] += 1

theme = {
    'errors': 'import PIL failed',
}
try:
    import PIL
    from PIL import Image, ImageDraw, ImageFont
    theme = {'pil': PIL.__version__}
except Exception as e:
    theme = {'pil_error': str(e)}

out = {
    'distinct_icons_used': len(counter),
    'icons': counter.most_common(),
    'pillow': theme,
    'glyph_count': len(names),
}
open(os.path.join(os.path.dirname(__file__), '_icons_full.json'), 'w', encoding='utf-8').write(
    json.dumps(out, ensure_ascii=False, indent=1))
print('done', len(counter))
