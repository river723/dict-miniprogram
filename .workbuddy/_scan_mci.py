import os, json
base = r'E:\cc_study\memo-grad\node_modules\@expo\vector-icons'
res = []
for dirpath, dirnames, filenames in os.walk(base):
    for fn in filenames:
        if 'materialcommunity' in fn.lower():
            res.append(os.path.join(dirpath, fn))
open(os.path.join(os.path.dirname(__file__), '_mci.json'), 'w', encoding='utf-8').write(
    json.dumps(res, ensure_ascii=False, indent=1))
print(len(res))
