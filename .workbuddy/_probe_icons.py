import re, json
p = r"E:\cc_study\memo-grad-miniprogram\miniprogram\theme\icons.js"
raw = open(p, encoding="utf-8").read()
# 取前几行看实际字节
lines = raw.split("\n")[5:12]
out = []
for ln in lines:
    out.append(repr(ln))
open(r"E:\cc_study\memo-grad-miniprogram\.workbuddy\_probe_icons.txt","w",encoding="utf-8").write("\n".join(out))
# 统计：字面转义 vs 真实字符
esc = len(re.findall(r"\\u[0-9a-fA-F]+", raw))
real = sum(1 for ch in raw if 0xE000 <= ord(ch) <= 0xFFFF or 0xF0000 <= ord(ch) <= 0xFFFFD)
print("literal-backslash-u:", esc, "real-pua-chars:", real)
