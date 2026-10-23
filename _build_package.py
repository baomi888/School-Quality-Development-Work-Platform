# -*- coding: utf-8 -*-
"""组装「质检部工作安排台」免安装包目录。

产出：<项目根>/排班工作台打包/  ← 直接就是包内容，随后用 _zip.py 压成 zip

包含：
  新手引导.html / README.txt / 启动.bat / 停止.bat / launcher.py
  engine/   ← 05 工作安排台（8766）
  web4/     ← 04 周工作平台（8765）
  runtime/python/ ← 从旧包复用内置 Python（含 fastapi/uvicorn/openpyxl）
数据默认清空，避免把历史真实台账带给别人。
"""
import json
import shutil
import sys
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STAGE = ROOT / "排班工作台打包"
OLD_ZIP = ROOT / "质检部工作安排台（免安装）.zip"
TPL = ROOT / "打包模板"
SRC05 = ROOT / "05_工作安排" / "engine"
SRC04 = ROOT / "04_Web端" / "engine"

SKIP_DIR_NAMES = {"__pycache__", "output", "preview", "work", "node_modules", "bin", "history"}
SKIP_FILE_NAMES = {".pyc", ".pyo", ".bak", "_server.log"}


def log(msg):
    print(msg)


def copy_tree(src: Path, dst: Path, skip_dirs=(), skip_files=()):
    """复制目录，跳过 __pycache__/产物目录。"""
    if not src.exists():
        return
    dst.mkdir(parents=True, exist_ok=True)
    for item in src.iterdir():
        if item.is_dir():
            if item.name in SKIP_DIR_NAMES or item.name in skip_dirs:
                continue
            copy_tree(item, dst / item.name, skip_dirs, skip_files)
        else:
            if item.suffix in SKIP_FILE_NAMES or item.name in skip_files:
                continue
            if item.name in skip_files:
                continue
            shutil.copy2(item, dst / item.name)


def copy_files(src: Path, dst: Path, names, optional=()):
    dst.mkdir(parents=True, exist_ok=True)
    for n in names:
        s = src / n
        if s.exists():
            shutil.copy2(s, dst / n)
        elif n not in optional:
            log(f"  ! 缺少 {s}")


def write_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    if STAGE.exists():
        shutil.rmtree(STAGE)
    STAGE.mkdir(parents=True)

    # ---------- 1. 内置 Python 运行环境 ----------
    log("[1/6] 解出内置 runtime/python …")
    if not OLD_ZIP.exists():
        log("  ! 找不到旧包，无法复用 runtime；改用手动放置")
        return 1
    prefix = "质检部工作安排台/runtime/"
    n = 0
    with zipfile.ZipFile(OLD_ZIP) as z:
        for info in z.infolist():
            name = info.filename
            if not name.startswith(prefix) or name.endswith("/"):
                continue
            rel = name[len(prefix):]
            out = STAGE / "runtime" / rel
            out.parent.mkdir(parents=True, exist_ok=True)
            with z.open(info) as fsrc, open(out, "wb") as fdst:
                shutil.copyfileobj(fsrc, fdst)
            n += 1
    log(f"      runtime 文件 {n} 个")

    # ---------- 2. 05 工作安排台 ----------
    log("[2/6] 复制 05 安排台 → engine/ …")
    eng = STAGE / "engine"
    copy_files(SRC05, eng, ["main.py", "requirements.txt"])
    copy_tree(SRC05 / "core", eng / "core")
    copy_tree(SRC05 / "web_dist", eng / "web_dist")

    # ---------- 3. 05 数据：只留质检部 + 清空台账 ----------
    log("[3/6] 清洗 05 数据（去认证部 / 清台账 / 删口令文件）…")
    d05 = eng / "data"
    copy_tree(SRC05 / "data", d05, skip_dirs={"rzb"}, skip_files={"manage_key.txt", "plan.json"})
    for junk in ("manage_key.txt", "plan.json", "ledger.json", "people.json", "tasks.json"):
        p = d05 / junk
        if p.exists() and junk in ("manage_key.txt", "plan.json"):
            p.unlink()
    # 顶层 legacy ledger 清空
    write_json(d05 / "ledger.json", {"weeks": {}, "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    write_json(d05 / "zjb" / "ledger.json", {"weeks": {}, "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")})
    # orgs.json 只留质检部
    orgs_p = d05 / "orgs.json"
    if orgs_p.exists():
        orgs = json.loads(orgs_p.read_text(encoding="utf-8"))
        orgs = [o for o in orgs if o.get("id") == "zjb"]
        write_json(orgs_p, orgs)
        log(f"      orgs.json 保留 {[o['id'] for o in orgs]}")
    # rzb 残留
    if (d05 / "rzb").exists():
        shutil.rmtree(d05 / "rzb")

    # ---------- 4. 04 周工作平台 ----------
    log("[4/6] 复制 04 周工作平台 → web4/ …")
    w4 = STAGE / "web4"
    copy_files(SRC04, w4, ["main.py", "requirements.txt", "merge_tool.html",
                           "agent_demo.html"], optional={"agent_demo.html"})
    copy_tree(SRC04 / "core", w4 / "core")
    copy_tree(SRC04 / "web_dist", w4 / "web_dist")
    d04 = w4 / "data"
    d04.mkdir(parents=True, exist_ok=True)
    write_json(d04 / "ledger.json", {"version": 1, "weeks": {}})
    write_json(d04 / "registry.json", {})
    # 便携模式标记：让 04 只读包内 data/，不读开发机的共享技能台账
    (w4 / ".portable").write_text("1", encoding="utf-8")
    for need in ("work", "output", "preview"):
        (w4 / need).mkdir(exist_ok=True)

    # ---------- 5. 引导与启动器 ----------
    log("[5/6] 放入引导 / 启动器 …")
    for f in ("00-新手引导.html", "README.txt", "启动.bat", "停止.bat", "launcher.py"):
        s = TPL / f
        if not s.exists():
            log(f"  ! 缺少模板 {f}")
            return 1
        shutil.copy2(s, STAGE / f)

    # ---------- 6. 汇总 ----------
    log("[6/6] 完成，清单：")
    total = 0
    for p in sorted(STAGE.rglob("*")):
        if p.is_file():
            total += p.stat().st_size
    for item in sorted(STAGE.iterdir()):
        if item.is_dir():
            cnt = sum(1 for _ in item.rglob("*") if _.is_file())
            log(f"      {item.name}/  ({cnt} 个文件)")
        else:
            log(f"      {item.name}")
    log(f"  合计 {total/1e6:.1f} MB  → {STAGE}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    raise SystemExit(main())
