import os, json, glob

ROOT = r'E:\cc_study\memo-grad'
hits = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    # 跳过明显无关目录以加速
    low = dirpath.lower()
    for fn in filenames:
        if fn.lower().endswith(('.ttf', '.otf')):
            if 'materialcommunity' in fn.lower() or 'material' in fn.lower():
                hits.append(os.path.join(dirpath, fn))
# 另外找 glyphMap json
gm = []
for dirpath, dirnames, filenames in os.walk(ROOT):
    for fn in filenames:
        if 'glyphmap' in fn.lower() and fn.endswith('.json'):
            gm.append(os.path.join(dirpath, fn))

out = {'fonts': hits, 'glyphmaps': gm[:20]}
open(os.path.join(os.path.dirname(__file__), '_fonts.json'), 'w', encoding='utf-8').write(
    json.dumps(out, ensure_ascii=False, indent=1))
print('fonts', len(hits), 'gm', len(gm))
