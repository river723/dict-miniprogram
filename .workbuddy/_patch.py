# -*- coding: utf-8 -*-
"""打补丁：确保 build_icons.py 顶部有 PIL import。"""
import io

P = r'E:\cc_study\memo-grad-miniprogram\.workbuddy\build_icons.py'
src = io.open(P, encoding='utf-8').read()

OLD = "import os, json, base64, io, sys\n"
NEW = ("import os, json, base64, io, sys\n"
       "\n"
       "from PIL import Image, ImageDraw, ImageFont\n")

assert OLD in src, 'anchor not found'
assert 'from PIL import Image' not in src.split(OLD)[0], 'already patched'

# 移除后面残留的重复 import（若有）
src = src.replace("# ---- 3) tabBar PNG ----\nfrom PIL import Image, ImageDraw, ImageFont\n\nTABS = [",
                  "# ---- 3) tabBar PNG ----\nTABS = [")
# 移除无用的占位
src = src.replace("_UNI = Image.new('L', (1, 1))\n", "")

src = src.replace(OLD, NEW, 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(src)

chk = io.open(P, encoding='utf-8').read()
lines = [i + 1 for i, l in enumerate(chk.split('\n')) if l.startswith('from PIL')]
print('PIL-import-lines:', lines)
print('has-top-import:', 'import os, json, base64, io, sys\n\nfrom PIL' in chk)
