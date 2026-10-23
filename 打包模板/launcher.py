# -*- coding: utf-8 -*-
"""一键启动器：同时拉起「周工作平台(8765)」与「工作安排台(8766)」。

设计要点：
- 只用包内自带的 runtime/python，不依赖部长电脑装过 Python
- 先探活；已在运行就直接开浏览器，不重复起
- 两个服务都起来了才开浏览器，避免白屏
- 控制台编码不确定（UTF-8/GBK 都可能），输出走安全通道，绝不因编码崩掉
- 关掉这个黑窗口 = 两个服务一起停（子进程随父进程退出）
"""
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PY = sys.executable

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def out(msg: str = "") -> None:
    """任何控制台编码下都能安全输出。"""
    try:
        print(msg, flush=True)
    except Exception:
        try:
            buf = getattr(sys.stdout, "buffer", None)
            if buf is not None:
                buf.write((msg + "\n").encode("utf-8", "replace"))
                buf.flush()
        except Exception:
            pass


# (显示名, 脚本, 端口, 端口环境变量)
APPS = [
    ("周工作平台", ROOT / "web4" / "main.py", 8765, "PORT"),
    ("工作安排台", ROOT / "engine" / "main.py", 8766, "ZJB_WORK_PORT"),
]
ENTRY = 8766  # 从「部门大厅」进，再跳分支
GUIDE = "http://127.0.0.1:8765/guide"   # 新手引导页（由 04 服务托管）
FIRST_RUN = ROOT / ".first_run_done"    # 首次启动标记：只在第一次弹引导


def healthy(port: int, timeout: float = 1.0) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as r:
            return r.status == 200
    except Exception:
        return False


def open_url(url: str) -> bool:
    """打开浏览器。绝不抛异常——默认浏览器未注册/被安全软件拦截时 webbrowser 会抛，
    一抛就会把启动器整个带崩（黑窗口闪退），所以这里全吞掉。"""
    try:
        webbrowser.open(url)
        return True
    except Exception:
        return False


def wait_healthy(port: int, limit: float = 60.0) -> bool:
    end = time.time() + limit
    while time.time() < end:
        if healthy(port):
            return True
        time.sleep(0.6)
    return False


def main() -> int:
    out("=" * 56)
    out("  质检部 · 工作安排台  启动中，请稍等（首次约 10 秒）")
    out("=" * 56)

    procs = []
    for name, script, port, env_key in APPS:
        if not script.exists():
            out(f"[缺失] 找不到 {script}")
            return 2
        if healthy(port):
            out(f"[跳过] {name} 已在运行（{port}）")
            continue
        env = dict(os.environ)
        env[env_key] = str(port)
        env["PYTHONIOENCODING"] = "utf-8"
        env["PYTHONUTF8"] = "1"
        p = subprocess.Popen(
            [PY, str(script)],
            cwd=str(script.parent),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        procs.append((name, p))
        out(f"[启动] {name} → http://127.0.0.1:{port}")

    ok = True
    for name, _, port, _ in APPS:
        if wait_healthy(port, 60):
            out(f"[就绪] {name}  ({port})")
        else:
            ok = False
            out(f"[超时] {name} 没起来（{port}），请检查是否被防火墙/杀毒软件拦截")

    # 首次启动先开「新手引导」，引导页顶部有「进入工作安排台」按钮；
    # 之后每次直接进系统。想再看引导：浏览器访问 http://127.0.0.1:8765/guide
    opened = False
    if healthy(8765) and not FIRST_RUN.exists():
        opened = open_url(GUIDE)
        try:
            FIRST_RUN.write_text("1", encoding="utf-8")
        except Exception:
            pass
        if opened:
            out("[引导] 已打开新手引导 —— 看完点页面顶部的「进入工作安排台」")
        else:
            out("[引导] 请手动打开 http://127.0.0.1:8765/guide 查看新手引导")
    elif healthy(ENTRY):
        opened = open_url(f"http://127.0.0.1:{ENTRY}")
    elif healthy(8765):
        opened = open_url("http://127.0.0.1:8765")

    out("-" * 56)
    if ok:
        if opened:
            out("浏览器已打开。没看到的话，手动访问：")
        else:
            out("浏览器没能自动打开，请手动在地址栏输入：")
        out("  http://127.0.0.1:8766   （安排台，主入口）")
        out("  http://127.0.0.1:8765   （周工作平台）")
        out("  http://127.0.0.1:8765/guide  （新手引导，随时可看）")
    out("★ 这个黑窗口不要关，关掉服务就停了。用完再关。")
    out("-" * 56)

    try:
        while True:
            time.sleep(1)
            if procs and all(p.poll() is not None for _, p in procs):
                out("所有服务已退出。")
                break
    except KeyboardInterrupt:
        out("\n正在停止服务…")
    finally:
        for name, p in procs:
            if p.poll() is None:
                p.terminate()
        time.sleep(1.2)
        for name, p in procs:
            if p.poll() is None:
                p.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
