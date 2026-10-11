# -*- coding: utf-8 -*-
"""校素拓 · 工作安排台 —— 多部门引擎。

单端口同时提供 API 与前端静态页。核心变化（2026-10-10）：
  不再硬编码「质检部」，改为「部门注册表」驱动 —— 顶栏选部门，
  整个台账 / 任务池 / 导出版式随部门切换。接一个新部门 = 填一份 OrgDef，
  原则上零代码改动（内核 assigner.py 只认 slots 列维度）。

  GET  /api/health           健康检查
  GET  /api/orgs             部门清单
  POST /api/orgs             新建部门（完整版：页面可建、可选手版式）
  GET  /api/bootstrap?dept   一次性拉齐人员/工作内容/台账（含部门元信息）
  POST /api/people?dept      保存人员池
  POST /api/tasks?dept       保存工作内容池
  POST /api/assign?dept      分配（支持 seed / locked / explain）
  POST /api/commit?dept      确认本周安排并写入台账
  POST /api/clear-week?dept  撤销某周台账
  GET  /api/ledger?dept      查看台账
  POST /api/export?dept      导出 xlsx
"""

from __future__ import annotations

import os
import shutil
import sys
import time
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))

from core.models import (  # noqa: E402
    ROLE_ASSIST, ROLE_DEPUTY, ROLE_LABEL, ROLE_LEAD, Person, Store, Task,
    OrgRegistry, ORG_SEED,
)
from core import duty as duty_data  # noqa: E402
from core import exporter  # noqa: E402
from core.assigner import Assigner, load_stats  # noqa: E402

DATA_DIR = Path(os.environ.get("ZJB_WORK_DATA", BASE / "data"))
OUTPUT_DIR = Path(os.environ.get("ZJB_WORK_OUT", BASE / "output"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="校素拓 · 工作安排台", version="2.0.0")

# 部门注册表（落盘 data/orgs.json，首启动播种质检部）
registry = OrgRegistry(DATA_DIR)


def _migrate_legacy_data() -> None:
    """一次性迁移：旧版真实数据在 data/*.json（无部门层），
    现需落到 data/zjb/*.json。仅复制不删除，原有文件保留作备份。"""
    legacy = DATA_DIR
    target = DATA_DIR / "zjb"
    if target.exists():
        return
    moved = False
    for fn in ("people.json", "tasks.json", "ledger.json"):
        src = legacy / fn
        if src.exists():
            target.mkdir(parents=True, exist_ok=True)
            shutil.copy(src, target / fn)
            moved = True
    if moved:
        print(f"[迁移] 旧版 data/ 已复制到 data/zjb/（原文件保留）")


_migrate_legacy_data()

WEEK_NO = 11          # 默认周次（排班周次，不随部门变化）


# ------------------------------------------------------------ 数据装配

def get_store(dept: str) -> Store:
    """取某部门的独立数据目录（data/<dept_id>/）。不存在则按该部门种子数据创建。"""
    if registry.get(dept) is None:
        raise HTTPException(404, f"部门不存在：{dept}")
    seed = ORG_SEED.get(dept, ([], []))
    return Store(DATA_DIR / dept, default_people=seed[0], default_tasks=seed[1])


def _person_row(p: dict) -> dict:
    """人员原始行 → 规范化 dict（补齐 can_do 等新字段，兼容旧 people.json）。"""
    obj = Person(**{k: v for k, v in p.items() if k in Person.__dataclass_fields__})
    d = asdict(obj)
    d.pop("last_week_tasks", None)
    d.pop("assigned", None)
    return d


def _people_rows(store: Store) -> list[dict]:
    return [_person_row(p) for p in store.people()]


def _people_objs(store: Store) -> list[Person]:
    return [Person(**p) for p in _people_rows(store)]


def _task_objs(store: Store) -> list[Task]:
    rows = store.tasks()
    out = []
    for i, r in enumerate(rows, start=1):
        out.append(Task(
            id=r.get("id") or f"t_{i:02d}",
            name=r.get("name", ""),
            tag=r.get("tag", "routine"),
            order=i,
            note=r.get("note", ""),
        ))
    return out


def _history_load(store: Store) -> dict[str, int]:
    load, _ = load_stats(store.ledger())
    return load


def _name_map(store: Store) -> dict[str, str]:
    return {p.id: p.name for p in _people_objs(store)}


def _prev_week(store: Store, week: int) -> dict[str, list[str]]:
    """找最近一个已有台账的周次（当前周没存就往前找），作为「上周」。"""
    weeks = store.ledger().get("weeks", {})
    for w in sorted((int(k) for k in weeks.keys()), reverse=True):
        if w < week:
            return weeks.get(str(w), {})
    return {}


def _default_plan(slots: list[str], name: str) -> dict:
    """为新部门生成一个朴素的导出版式：每件活按列展开到 B/D/F…"""
    work_cols = {s: 2 + i * 2 for i, s in enumerate(slots)}
    col_width: dict[str, int] = {"A": 26}
    for i in range(len(slots)):
        col_width[chr(ord("B") + i * 2)] = 14
        if len(slots) > 1:
            col_width[chr(ord("B") + i * 2 + 1)] = 14
    return {
        "title_prefix": name,
        "work_cols": work_cols,
        "assist_cols": dict(work_cols),
        "col_width": col_width,
        "assist_labels": list(slots),
    }


# ------------------------------------------------------------ 请求体

class AssignReq(BaseModel):
    week: int = WEEK_NO
    seed: int | None = None
    # 锁定：{task_id: {列标签: [pid...]}} —— 每格 0~N 人（搭档制）
    locked: dict[str, dict[str, list[str]]] = Field(default_factory=dict)
    explain: bool = False


class PeopleReq(BaseModel):
    rows: list[dict[str, Any]]


class TasksReq(BaseModel):
    rows: list[dict[str, Any]]


class CommitReq(BaseModel):
    week: int
    # {task_id: {列标签: [pid...]}}
    assign: dict[str, dict[str, list[str]]] = Field(default_factory=dict)


class ExportReq(BaseModel):
    week: int = WEEK_NO
    # {task_id: {列标签: [pid...]}}（前端按格拆好）
    assign: dict[str, dict[str, list[str]]] = Field(default_factory=dict)


class OrgCreateReq(BaseModel):
    id: str
    name: str
    archetype: str = "task_x_slot"
    slots: list[str] = Field(default_factory=list)
    slot_alias: dict[str, str] = Field(default_factory=dict)
    export: dict = Field(default_factory=dict)
    assist_block: dict[str, list[str]] = Field(default_factory=dict)
    has_duty: bool = False


# ------------------------------------------------------------ API

@app.get("/api/health")
def health():
    return {"ok": True, "service": "zjb-work", "time": time.strftime("%Y-%m-%d %H:%M:%S")}


@app.get("/api/orgs")
def list_orgs():
    out = []
    for o in registry.list():
        st = get_store(o["id"])
        led = st.ledger().get("weeks", {})
        weeks = sorted(int(w) for w in led.keys() if str(w).isdigit())
        rows = _people_rows(st)
        out.append({
            **o,
            "stats": {
                "people": len(rows),
                "assists": len([r for r in rows if r.get("role") == ROLE_ASSIST and r.get("active", True)]),
                "tasks": len(st.tasks()),
                "weeks_stored": len(weeks),
                "last_week": weeks[-1] if weeks else None,
            },
        })
    return {"orgs": out}


@app.post("/api/orgs")
def create_org(req: OrgCreateReq):
    payload = req.dict()
    if not payload.get("export"):
        payload["export"] = _default_plan(payload.get("slots", []), payload.get("name", "部门"))
    try:
        registry.create(payload)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # 立即建好该部门的数据目录（空名单），避免首次派活时才初始化
    get_store(payload["id"])
    return {"ok": True, "org": payload}


@app.get("/api/bootstrap")
def bootstrap(dept: str = "zjb"):
    store = get_store(dept)
    org = registry.get(dept)
    slots = org.get("slots", [])
    slot_alias = org.get("slot_alias", {})
    campus_assist = org.get("assist_block", {}) or {}
    if org.get("has_duty"):
        duty_daily = {c: duty_data.daily_people(c, dept) for c in slots}
    else:
        duty_daily = {}
    return {
        "org_id": dept,
        "org_name": org.get("name", dept),
        "archetype": org.get("archetype", "task_x_slot"),
        "slots": slots,
        "slot_alias": slot_alias,
        "week": WEEK_NO,
        "people": _people_rows(store),
        "tasks": store.tasks(),
        "duty_daily": duty_daily,
        "campus_assist": campus_assist,
        "ledger": store.ledger(),
        "role_label": ROLE_LABEL,
        "prev_week": _prev_week(store, WEEK_NO),
        "history_load": _history_load(store),
    }


@app.post("/api/people")
def save_people(req: PeopleReq, dept: str = "zjb"):
    store = get_store(dept)
    org = registry.get(dept)
    valid = set(org.get("slots", []))
    rows = []
    for i, r in enumerate(req.rows):
        name = (r.get("name") or "").strip()
        if not name:
            continue
        rows.append({
            "id": r.get("id") or f"u_{i+1}",
            "name": name,
            "role": r.get("role") if r.get("role") in (ROLE_LEAD, ROLE_DEPUTY, ROLE_ASSIST) else ROLE_ASSIST,
            "order": i,
            "active": bool(r.get("active", True)),
            "campus": (r.get("campus") or "").strip(),
            # 可派列：只认本部门的 slots；空 = 只干主校区
            "can_do": [c for c in (r.get("can_do") or []) if c in valid],
            # 分管单位：包干制输入数据，内核不读，供回避/负荷展示
            "units": [str(x).strip() for x in (r.get("units") or [])],
            # 所属学院：认证部回避用（college == 活.scope 时硬排除）
            "college": (r.get("college") or "").strip(),
        })
    store.save_people(rows)
    return {"ok": True, "rows": rows}


@app.post("/api/tasks")
def save_tasks(req: TasksReq, dept: str = "zjb"):
    store = get_store(dept)
    rows = []
    for i, r in enumerate(req.rows):
        name = (r.get("name") or "").strip()
        if not name:
            continue
        rows.append({
            "id": r.get("id") or f"t_{i+1:02d}",
            "name": name,
            "tag": "heavy" if r.get("tag") == "heavy" else "routine",
            "note": r.get("note", ""),
            # 该活针对的学院：认证部回避用（非空时排除 college 相同的助理）
            "scope": (r.get("scope") or "").strip(),
        })
    store.save_tasks(rows)
    return {"ok": True, "rows": rows}


@app.post("/api/assign")
def assign(req: AssignReq, dept: str = "zjb"):
    store = get_store(dept)
    org = registry.get(dept)
    people = _people_objs(store)
    tasks = _task_objs(store)
    assists = [p for p in people if p.role == ROLE_ASSIST and p.active]
    if not assists:
        raise HTTPException(400, "没有可派活的助理（请在人员池里至少设一位 role=助理 且启用的人）")
    if not tasks:
        raise HTTPException(400, "工作内容池为空")

    a = Assigner(
        people, tasks,
        last_week=_prev_week(store, req.week),
        history_load=_history_load(store),
        slots=org.get("slots"),
        slot_alias=org.get("slot_alias"),
        avoid_self_college=bool(org.get("avoid_self_college", False)),
    )
    # week 进确定性平局裁决：同一周 + 同一重摇次数 ⇒ 同一张表，可复现、可解释
    res = a.run(seed=req.seed, locked=req.locked, week=req.week, explain=req.explain)

    # 需拍板的活：派给助理执行，但页面提示领导签字（导出表按官方版式不标红）
    nm = _name_map(store)
    todo = [
        {"task_id": t.id, "task": t.name,
         "assignees": t.assignees,
         "names": [nm.get(i, i) for i in t.assignees]}
        for t in tasks if t.tag == "heavy" and t.assignees
    ]

    return {
        "ok": True,
        "week": req.week,
        "assign": res["assign"],
        "load": res["load"],
        "campus_load": res["campus_load"],
        "warnings": res["warnings"],
        # 复现凭证：同一周 + 同一 shake 必然排出同一张表
        "shake": res["shake"],
        "explain": res.get("explain"),
        "need_confirm": todo,
        "leaders": [
            {"id": p.id, "name": p.name, "role": p.role, "campus": p.campus,
             "label": p.label, "count": 0, "assigned": []}
            for p in people if p.role in (ROLE_LEAD, ROLE_DEPUTY)
        ],
        "people": [
            {"id": p.id, "name": p.name, "role": p.role, "campus": p.campus, "label": p.label,
             "can_do": list(p.can_do or []),
             "assigned": p.assigned, "count": len(p.assigned),
             "last_week": p.last_week_tasks}
            for p in people
        ],
        "tasks": [
            {"id": t.id, "name": t.name, "tag": t.tag,
             "assignees": t.assignees, "locked": bool(req.locked.get(t.id))}
            for t in tasks
        ],
    }


@app.post("/api/commit")
def commit(req: CommitReq, dept: str = "zjb"):
    store = get_store(dept)
    names = _name_map(store)
    tasks = _task_objs(store)
    # 嵌套 {task_id: {列: [pid]}} 翻转成台账口径 {person_id: [任务名]}
    inv: dict[str, list[str]] = {}
    for t in tasks:
        row = req.assign.get(t.id) or {}
        for ids in row.values():
            for pid in ids:
                lst = inv.setdefault(pid, [])
                if t.name not in lst:
                    lst.append(t.name)
    store.commit_week(req.week, inv)
    return {"ok": True, "week": req.week, "committed": {names.get(k, k): v for k, v in inv.items()}}


@app.post("/api/clear-week")
def clear_week(req: CommitReq, dept: str = "zjb"):
    store = get_store(dept)
    store.clear_week(req.week)
    return {"ok": True, "week": req.week}


@app.get("/api/ledger")
def ledger(dept: str = "zjb"):
    store = get_store(dept)
    return {"ok": True, "ledger": store.ledger()}


@app.post("/api/export")
def export(req: ExportReq, dept: str = "zjb"):
    store = get_store(dept)
    org = registry.get(dept)
    people = _people_objs(store)
    tasks = _task_objs(store)
    by_id = {p.id: p for p in people}
    if not req.assign:
        raise HTTPException(400, "没有可导出的分配结果")

    # 前端已按格拆好：{task_id: {列标签: [pid...]}} ⇒ 换成姓名
    assign_by_campus: dict[str, dict[str, list[str]]] = {}
    for t in tasks:
        row = req.assign.get(t.id) or {}
        per: dict[str, list[str]] = {}
        for c, ids in row.items():
            ns = [by_id[pid].name for pid in ids if pid in by_id]
            if ns:
                per[c] = ns
        assign_by_campus[t.id] = per

    campus_assist = org.get("assist_block", {}) or {}
    data = exporter.build(
        week=req.week,
        tasks=[{"id": t.id, "name": t.name} for t in tasks],
        assign_by_campus=assign_by_campus,
        campus_assist=campus_assist,
        plan=org.get("export"),
    )
    prefix = (org.get("export") or {}).get("title_prefix") or org.get("name") or "部门"
    fname = exporter.filename(req.week, prefix=prefix)
    (OUTPUT_DIR / fname).write_bytes(data)
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": exporter.content_disposition(req.week, prefix=prefix)},
    )


# ------------------------------------------------------------ 前端静态页

WEB_DIST = BASE / "web_dist"
if WEB_DIST.exists():
    class _NoCacheStatic(StaticFiles):
        async def get_response(self, path, scope):
            resp = await super().get_response(path, scope)
            resp.headers["Cache-Control"] = "no-store, must-revalidate"
            return resp

    app.mount("/", _NoCacheStatic(directory=str(WEB_DIST), html=True), name="web")
else:
    @app.get("/")
    def _no_web():
        return JSONResponse({
            "message": "前端尚未构建，请先运行 web 目录下的 npm run build",
            "api": "/api/health",
        }, status_code=200)


# ------------------------------------------------------------ 启动入口

def main() -> None:
    import uvicorn
    port = int(os.environ.get("ZJB_WORK_PORT", "8766"))
    host = os.environ.get("ZJB_WORK_HOST", "127.0.0.1")
    print(f"校素拓 · 工作安排台 → http://{host}:{port}")
    print(f"数据目录 {DATA_DIR}")
    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    main()
