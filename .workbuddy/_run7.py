import subprocess, io
py = r"C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
node = r"C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe"
B = r"E:\cc_study\memo-grad-miniprogram\.workbuddy"
r1 = subprocess.run([py, B + r"\build_preview.py"], capture_output=True)
r2 = subprocess.run([node, B + r"\check_syntax.cjs"], capture_output=True)
io.open(B + r"\_final.log", "wb").write(
    b"--- preview ---\n" + r1.stdout + r1.stderr + b" rc=" + str(r1.returncode).encode() +
    b"\n--- check ---\n" + r2.stdout + r2.stderr + b" rc=" + str(r2.returncode).encode())
print("preview", r1.returncode, "check", r2.returncode)
