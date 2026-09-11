import os, re, json, collections

ROOT = r'E:\cc_study\memo-grad\src'
pat_attr = re.compile(r'name\s*=\s*["\']([a-z0-9-]+)["\']')
pat_brace = re.compile(r'name\s*=\s*\{\s*["\']([a-z0-9-]+)["\']\s*\}')
pat_import_icon = re.compile(r'from\s+[\'"][^\'"]*vector-icons[\'"]')

counter = collections.Counter()

for dirpath, dirnames, filenames in os.walk(ROOT):
    for fn in filenames:
        if not fn.endswith(('.tsx', '.ts')):
            continue
        p = os.path.join(dirpath, fn)
        try:
            txt = open(p, encoding='utf-8').read()
        except Exception:
            continue
        if 'MaterialCommunityIcons' not in txt:
            continue
        for m in pat_brace.finditer(txt):
            counter[m.group(1)] += 1
        for m in pat_attr.finditer(txt):
            counter[m.group(1)] += 1

out = {
    'total_distinct': len(counter),
    'icons': counter.most_common(),
}
open(os.path.join(os.path.dirname(__file__), '_icons.json'), 'w', encoding='utf-8').write(
    json.dumps(out, ensure_ascii=False, indent=1)
)
print('distinct:', len(counter))
