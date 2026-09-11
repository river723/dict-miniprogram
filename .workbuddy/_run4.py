import subprocess, io, json
py = r"C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
B = r"E:\cc_study\memo-grad-miniprogram\.workbuddy"
r1 = subprocess.run([py, B + r"\_patch3.py"], capture_output=True)
r2 = subprocess.run([py, B + r"\build_icons.py"], capture_output=True)
io.open(B + r"\_run4.log", "wb").write(
    b"--- patch ---\n" + r1.stdout + r1.stderr +
    b"\n--- build ---\n" + r2.stdout + b"|" + r2.stderr +
    b"\n--- rc=" + str(r2.returncode).encode())
rep = json.load(io.open(B + r"\_icons_report.json", encoding="utf-8"))
io.open(B + r"\_verify_summary.txt", "w", encoding="utf-8").write(json.dumps({
    "range": rep.get("codepoint_range"), "ok": rep.get("verify_ok"),
    "bad_cmap": rep["verify"]["bad_cmap"][:8],
    "outline_diff": rep["verify"]["outline_diff"][:8],
    "blank": rep["verify"]["blank"][:8],
    "n_bad": len(rep["verify"]["bad_cmap"]),
    "n_diff": len(rep["verify"]["outline_diff"]),
    "n_blank": len(rep["verify"]["blank"]),
}, ensure_ascii=False, indent=1))
print("rc", r2.returncode)
