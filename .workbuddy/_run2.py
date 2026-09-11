import subprocess, sys, io
py = r"C:\Users\Administrator\.workbuddy\binaries\python\envs\default\Scripts\python.exe"
r = subprocess.run([py, r"E:\cc_study\memo-grad-miniprogram\.workbuddy\_patch.py"], capture_output=True)
io.open(r"E:\cc_study\memo-grad-miniprogram\.workbuddy\_patch.log","wb").write(r.stdout + b"|ERR|" + r.stderr)
r2 = subprocess.run([py, r"E:\cc_study\memo-grad-miniprogram\.workbuddy\build_icons.py"], capture_output=True)
io.open(r"E:\cc_study\memo-grad-miniprogram\.workbuddy\_rebuild3.log","wb").write(b"--- stdout ---\n" + r2.stdout + b"\n--- stderr ---\n" + r2.stderr + b"\n--- rc=" + str(r2.returncode).encode())
print("rc", r2.returncode)
