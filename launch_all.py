#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一键同时拉起 04_Web端(8765) 与 05_工作安排(8766)。"""

import os
import sys
import time
import pathlib
import subprocess
import urllib.request
import webbrowser

ROOT = pathlib.Path(__file__).resolve().parent

# 优先使用用户机器上已知的 Python；找不到就退回到当前解释器。
PY = pathlib.Path(r"C:\Users\HUAWEI\AppData\Local\Programs\Python\Python313\python.exe")
if not PY.exists():
    PY = pathlib.Path(sys.executable)

APPS = [
    {
        "name": "Web端",
        "dir": ROOT / "04_Web端" / "engine",
        "main": "main.py",
        "port": 8765,
        "log": ROOT / "04_web.log",
    },
    {
        "name": "工作安排台",
        "dir": ROOT / "05_工作安排" / "engine",
        "main": "main.py",
        "port": 8766,
        "log": ROOT / "05_web.log",
    },
]


def banner():
    print()
    print("  " + "=" * 60)
    print("     校素拓 · 工作安排平台 综合启动")
    print("     同时拉起：Web端(8765) + 工作安排台(8766)")
    print("  " + "=" * 60)
    print()


def kill_old_engines():
    """清理还在跑的旧引擎（CommandLine 含 main.py 的 python.exe）。"""
    ps_cmd = (
        "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
        "Where-Object { $_.CommandLine -match 'main\\\\.py' } | "
        "ForEach-Object { $_.ProcessId }"
    )
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command", ps_cmd],
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
        )
        pids = [line.strip() for line in out.stdout.splitlines() if line.strip().isdigit()]
        killed = []
        for pid in pids:
            r = subprocess.run(
                ["taskkill", "/F", "/PID", pid],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if r.returncode == 0:
                killed.append(pid)
        return killed
    except Exception:
        return []


def health(port: int, timeout: float = 2.0) -> bool:
    try:
        urllib.request.urlopen(
            f"http://127.0.0.1:{port}/api/health",
            timeout=timeout,
        )
        return True
    except Exception:
        return False


def main():
    banner()

    # 1. 释放端口
    print("  [1/5] 释放端口 8765 / 8766（清理旧引擎）...")
    killed = kill_old_engines()
    if killed:
        print(f"        已清理 {len(killed)} 个旧引擎进程")
    time.sleep(1)

    # 2. 启动两个引擎
    print()
    processes = []
    for app in APPS:
        log_path = app["log"]
        print(f"  [2/5] 启动 {app['name']} -> http://127.0.0.1:{app['port']} ...")
        log = open(log_path, "w", encoding="utf-8")
        p = subprocess.Popen(
            [str(PY), app["main"]],
            cwd=str(app["dir"]),
            stdout=log,
            stderr=subprocess.STDOUT,
            encoding="utf-8",
        )
        processes.append({"app": app, "proc": p, "log": log})
        print(f"        pid={p.pid}")

    # 3. 等待就绪
    print()
    print("  [3/5] 等待两个平台就绪...")
    ready = {app["port"]: False for app in APPS}
    for _ in range(40):
        for item in processes:
            app = item["app"]
            if not ready[app["port"]] and health(app["port"]):
                ready[app["port"]] = True
                print(f"        ✓ {app['name']}({app['port']}) 已就绪")
        if all(ready.values()):
            break
        time.sleep(1)
    else:
        for item in processes:
            app = item["app"]
            if not ready[app["port"]]:
                print(f"        ✗ {app['name']}({app['port']}) 启动超时")

    # 4. 打开浏览器
    print()
    print("  [4/5] 打开浏览器...")
    if ready.get(8766):
        webbrowser.open("http://127.0.0.1:8766/")
    if ready.get(8765):
        webbrowser.open("http://127.0.0.1:8765/")

    # 5. 提示
    print()
    print("  [5/5] 启动完成")
    print()
    print("    主入口：http://127.0.0.1:8766/")
    print("          （选 质检部 -> 工作安排类 / Web端）")
    print("    直接进入 Web 端：http://127.0.0.1:8765/")
    print()
    test_mode = "--test" in sys.argv
    try:
        if test_mode:
            print("    [test mode] 3 秒后自动退出")
            time.sleep(3)
        else:
            print("    按 Enter 键停止所有服务并退出...")
            input()
    except KeyboardInterrupt:
        pass
    finally:
        print()
        print("  正在停止服务...")
        for item in processes:
            p = item["proc"]
            log = item["log"]
            p.terminate()
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                p.kill()
                p.wait(timeout=3)
            log.close()
        print("  所有服务已停止。")


if __name__ == "__main__":
    main()
