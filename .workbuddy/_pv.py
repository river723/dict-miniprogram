import re
p = r"E:\cc_study\memo-grad-miniprogram\.workbuddy\preview\phase1.html"
s = open(p, encoding="utf-8").read()
print("icons:", s.count('class="ic"'))
print("swatches:", s.count('class="sw"'))
print("tabs:", s.count('class="tabitem"'))
print("rows:", s.count("<tr>"))
print("unreplaced-placeholder:", "{{" in s)
