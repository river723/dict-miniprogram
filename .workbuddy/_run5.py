import subprocess, io, json
py = r"C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
B = r"E:\cc_study\memo-grad-miniprogram\.workbuddy"
r1 = subprocess.run([py, B + r"\_patch4.py"], capture_output=True)
r2 = subprocess.run([py, B + r"\build_icons.py"], capture_output=True)
io.open(B + r"\_run5.log", "wb").write(
    b"--- patch ---\n" + r1.stdout + r1.stderr +
    b"\n--- build ---\n" + r2.stdout + b"|" + r2.stderr +
    b"\n--- rc=" + str(r2.returncode).encode())
try:
    rep = json.load(io.open(B + r"\_icons_report.json", encoding="utf-8"))
    v = rep["verify"]
    io.open(B + r"\_verify_summary.txt", "w", encoding="utf-8").write(json.dumps({
        "codepoint_range": rep.get("codepoint_range"),
        "ttf_bytes": rep.get("ttf_bytes"),
        "wxss_bytes": rep.get("wxss_bytes"),
        "verify_ok": rep.get("verify_ok"),
        "counts": {"bad_cmap": len(v["bad_cmap"]), "outline_diff": len(v["outline_diff"]), "blank": len(v["blank"])},
        "samples": {"bad_cmap": v["bad_cmap"][:6], "outline_diff": v["outline_diff"][:6], "blank": v["blank"][:6]},
    }, ensure_ascii=False, indent=1))
except Exception as e:
    io.open(B + r"\_verify_summary.txt", "w", encoding="utf-8").write("ERR " + repr(e))
print("rc", r2.returncode)
