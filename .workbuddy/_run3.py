import subprocess, io
py = r"C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
B = r"E:\cc_study\memo-grad-miniprogram\.workbuddy"
r1 = subprocess.run([py, B + r"\_patch2.py"], capture_output=True)
r2 = subprocess.run([py, B + r"\build_icons.py"], capture_output=True)
io.open(B + r"\_run3.log", "wb").write(
    b"--- patch ---\n" + r1.stdout + r1.stderr +
    b"\n--- build ---\n" + r2.stdout + b"|" + r2.stderr +
    b"\n--- rc=" + str(r2.returncode).encode())
print("patch", r1.returncode, "build", r2.returncode)
