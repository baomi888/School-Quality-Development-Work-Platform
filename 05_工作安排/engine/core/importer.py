# -*- coding: utf-8 -*-
"""把历史「第 X 周工作安排表」xlsx 解析并导入台账 / plan。

支持格式（质检部官方样表）：
  A1  质检部第 X 周工作安排表（标题含周次）
  第 1 行：西城 / 官渡 两列标题
  第 2 行起：工作内容 | 西城负责人 | 官渡负责人
  负责人可填多人，用「、，,/」分隔。

导入流程：
  1. 读 xlsx → 抽周次 + 任务名 + 各列人名
  2. 人名按 people.name 精确匹配 → pid
  3. 任务名按 tasks.name 精确匹配 → task_id
  4. 生成 {task_id: {slot: [pid]}} 并 commit（写 ledger + plan）

未匹配到的人 / 任务会返回给前端确认，避免写错台账。
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


def _normalize(text: Any) -> str:
    if text is None:
        return ""
    return str(text).strip().replace("\n", "").replace("\t", "")


def _split_names(value: Any) -> list[str]:
    """把单元格里的多个人名拆开，过滤空值。"""
    if value is None:
        return []
    text = str(value).strip()
    if not text:
        return []
    # 支持「、」「，」「,」「/」以及任意空白
    parts = re.split(r"[\u3001\uFF0C,\/\s]+", text)
    return [p.strip() for p in parts if p.strip()]


def parse_schedule_xlsx(path: str | Path, slots: list[str] | None = None) -> dict:
    """解析历史工作安排表 xlsx。

    返回：
        {
            "week": int | None,
            "slots": ["西城", "官渡"],          # 识别到的列顺序
            "rows": [
                {"task_name": "...", "西城": ["黄以诺", ...], "官渡": ["罗奥妮", ...]},
                ...
            ]
        }
    """
    wb = load_workbook(path, data_only=True)
    ws = wb.active

    # 1. 找周次：优先 A1 标题，其次文件名
    week = _extract_week(_normalize(ws.cell(row=1, column=1).value))

    # 2. 找列标题行（默认第 1 行；若第 1 行没有 slot 关键词，则扫前 5 行）
    slots = slots or ["西城", "官渡"]
    header_row, slot_cols = _find_header(ws, slots)
    if header_row is None:
        raise ValueError(f"没找到列标题（{slots}），请确认表头在第 1~5 行")

    # 3. 从 header 下一行开始读任务 + 各列人名
    rows = []
    for r in range(header_row + 1, ws.max_row + 1):
        task_name = _normalize(ws.cell(row=r, column=1).value)
        if not task_name:
            continue
        row = {"task_name": task_name}
        has_any = False
        for slot in slots:
            col = slot_cols.get(slot)
            if col is None:
                row[slot] = []
                continue
            names = _split_names(ws.cell(row=r, column=col).value)
            row[slot] = names
            if names:
                has_any = True
        # 跳过全空行，但保留「任务名存在但无人」这种占位行
        rows.append(row)

    return {"week": week, "slots": slots, "rows": rows}


def _extract_week(text: str) -> int | None:
    if not text:
        return None
    m = re.search(r"第\s*(\d+)\s*周", text)
    if m:
        return int(m.group(1))
    return None


def _find_header(ws, slots: list[str]) -> tuple[int | None, dict[str, int]]:
    """扫前 5 行，找包含所有 slot 关键词的行。"""
    for r in range(1, min(6, ws.max_row + 1)):
        cols = {}
        for c in range(1, ws.max_column + 1):
            val = _normalize(ws.cell(row=r, column=c).value)
            for slot in slots:
                if slot in val and slot not in cols:
                    cols[slot] = c
        if len(cols) >= len(slots):
            return r, cols
    return None, {}


def match_schedule(rows: list[dict], people: list[dict], tasks: list[dict]) -> dict:
    """把 rows（人名）匹配成 ids，返回 {assign, unmatched}。"""
    name_to_id = {p["name"].strip(): p["id"] for p in people if p.get("name")}
    task_name_to_id = {t["name"].strip(): t["id"] for t in tasks if t.get("name")}

    assign: dict[str, dict[str, list[str]]] = {}
    unmatched_names: set[str] = set()
    unmatched_tasks: set[str] = set()

    for row in rows:
        task_name = row["task_name"].strip()
        task_id = task_name_to_id.get(task_name)
        if not task_id:
            # 容错：部分匹配（任务名在表中 / 任务池中包含对方）
            for tn, tid in task_name_to_id.items():
                if task_name in tn or tn in task_name:
                    task_id = tid
                    break
        if not task_id:
            unmatched_tasks.add(task_name)
            continue

        if task_id not in assign:
            assign[task_id] = {}

        for slot, names in row.items():
            if slot == "task_name":
                continue
            for raw_name in names:
                name = raw_name.strip()
                pid = name_to_id.get(name)
                if not pid:
                    unmatched_names.add(name)
                    continue
                assign[task_id].setdefault(slot, [])
                if pid not in assign[task_id][slot]:
                    assign[task_id][slot].append(pid)

    return {
        "assign": assign,
        "unmatched_names": sorted(unmatched_names),
        "unmatched_tasks": sorted(unmatched_tasks),
    }


def preview_import(path: str | Path, people: list[dict], tasks: list[dict], slots: list[str] | None = None) -> dict:
    """只解析 + 匹配，不写入。用于前端预览确认。"""
    parsed = parse_schedule_xlsx(path, slots)
    matched = match_schedule(parsed["rows"], people, tasks)
    return {**parsed, **matched}


def commit_import(store, week: int, assign: dict, people: list[dict], tasks: list[dict]) -> dict:
    """把 assign 写入 plan.json 和 ledger.json。"""
    from .models import PLAN_FILE

    # 1. 保存完整网格（小助理反查需要）
    store.save_plan(week, assign)

    # 2. 翻转成 ledger 格式 {pid: [task_name, ...]}
    pid_to_name = {p["id"]: p["name"] for p in people}
    tid_to_name = {t["id"]: t["name"] for t in tasks}
    inv: dict[str, list[str]] = {}
    for task_id, slots in assign.items():
        task_name = tid_to_name.get(task_id, task_id)
        for slot, pids in slots.items():
            for pid in pids:
                inv.setdefault(pid, []).append(task_name)

    store.commit_week(str(week), inv)

    return {"week": week, "committed": inv, "plan_file": PLAN_FILE, "assign": assign}
