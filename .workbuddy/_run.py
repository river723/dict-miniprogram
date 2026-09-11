import subprocess, sys
py = r"C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
script = r"E:\cc_study\memo-grad-miniprogram\.workbuddy\build_icons.py"
r = subprocess.run([py, script], capture_output=True)
open(r"E:\cc_study\memo-grad-miniprogram\.workbuddy\_rebuild2.log", "wb").write(
    b"--- stdout ---\n" + r.stdout + b"\n--- stderr ---\n" + r.stderr + b"\n--- rc=" + str(r.returncode).encode() + b"\n")
print("rc", r.returncode)
