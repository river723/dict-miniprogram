import io, re, shutil, os
B = r"E:\cc_study\memo-grad-miniprogram\.workbuddy"
P = os.path.join(B, "preview")
os.makedirs(P, exist_ok=True)
shutil.copy(os.path.join(B, "grid_before.png"), os.path.join(P, "icons_before.png"))
shutil.copy(os.path.join(B, "grid_after.png"), os.path.join(P, "icons_after.png"))
h = io.open(os.path.join(P, "phase1.html"), encoding="utf-8").read()
ents = [int(x, 16) for x in re.findall(r"&#x([0-9a-fA-F]+);", h)]
chars = [ord(c) for c in h if 0xE000 <= ord(c) <= 0xF8FF]
allcp = ents + chars
uniq = sorted(set(allcp))
io.open(os.path.join(B, "_preview_check.txt"), "w", encoding="utf-8").write(
    "entities=%d pua_literals=%d\nmin=U+%04X max=U+%04X\nover_bmp=%s\nplaceholder_left=%s\n" % (
        len(ents), len(chars), min(uniq), max(uniq),
        [hex(c) for c in uniq if c > 0xFFFF][:5], "{{" in h))
