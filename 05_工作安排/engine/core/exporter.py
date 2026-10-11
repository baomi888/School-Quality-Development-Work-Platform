# -*- coding: utf-8 -*-
"""导出「第X周工作安排表」—— 对齐官方样表的**周安排部分**。

官方样表《质检部日常工作安排表.xlsx》的实际结构（已逐格解析核对）：

    A1      质检部第x周工作安排表      ← 标题，横向居中
    B1 西城        D1 官渡               ← 工作区的两个安排列
    A2..A8  七件工作内容
    B2..B8  西城负责人    D2..D8 官渡负责人

    A14 校区助理分布                    ← 固定在第 14 行
    B14 西城   C14 官渡   D14 光华
    B15..      三校区助理名单

样式：**纯文本，宋体 11，非加粗，无边框、无底色、无合并单元格**。
所以本模块不做任何 merge / fill / border —— 这是刻意保持与样表一致。

**值班检查区块（F/G/I 列）已按用户要求去掉（2026-10-08）**：
值班表一学期固定一次，每周转抄一遍是冗余，导出表只管「本周谁做什么」。

「待部长确认」「本周合计」等自造区块也已去掉 —— 只保留工作安排 + 校区助理分布。
"""

from __future__ import annotations

import io
from typing import Any
from urllib.parse import quote

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font

FONT = "宋体"
FS = 11

# 官方样表只显式设了 A 列宽，其余为默认。
# C/E 是官方留空的过渡列，压窄；D 兼作「官渡负责人」列和「光华」列，给够宽度。
COL_WIDTH = {
    "A": 26,    # 工作内容（样表 25.64）
    "B": 14,    # 西城负责人 / 校区助理分布·西城
    "C": 14,    # 校区助理分布·官渡
    "D": 14,    # 官渡负责人 / 校区助理分布·光华
    "E": 6,     # （官方留空）
}

# 「校区助理分布」区块固定起始行（官方样表就是第 14 行；工作区更长时顺延）
ASSIST_BLOCK_ROW = 14

# 默认版式 = 质检部官方样表的精确复刻。其他部门通过 OrgDef.export 传入自己的版式。
DEFAULT_PLAN = {
    "title_prefix": "质检部",
    "work_cols": {"西城": 2, "官渡": 4},
    "assist_cols": {"西城": 2, "官渡": 3, "光华": 4},
    "col_width": {"A": 26, "B": 14, "C": 14, "D": 14, "E": 6},
    "assist_labels": ["西城", "官渡", "光华"],
}


def _put(ws, row: int, col: int, value: Any, *, center: bool = False):
    """写一个单元格。样式 = 宋体 11，非加粗，无边框无填充。"""
    c = ws.cell(row=row, column=col, value=value)
    c.font = Font(name=FONT, size=FS, bold=False)
    if center:
        # 样表里只有 A1 是横向居中，其余都是默认对齐
        c.alignment = Alignment(horizontal="center")
    return c


def build(
    week: int,
    tasks: list[dict],
    assign_by_campus: dict[str, dict[str, list[str]]],
    campus_assist: dict[str, list[str]] | None = None,
    plan: dict | None = None,
) -> bytes:
    """生成 xlsx 字节流。

    tasks            [{id, name}]                      按 A 列顺序
    assign_by_campus {task_id: {列标签: [姓名...]}}     已按列拆好
    campus_assist    {列标签: [助理名]}                  可选（校区助理分布区块）
    plan             部门导出版式（见 DEFAULT_PLAN）      不传 = 质检部默认版式
    """
    plan = plan or DEFAULT_PLAN
    tp = plan.get("title_prefix", "部门")
    work_cols: dict = plan.get("work_cols", {"西城": 2, "官渡": 4})
    assist_cols: dict = plan.get("assist_cols", work_cols)
    col_width: dict = plan.get("col_width", {"A": 26})
    assist_labels: list = plan.get("assist_labels", list(assist_cols.keys()))

    wb = Workbook()
    ws = wb.active
    ws.title = f"第{week}周工作安排表"

    campus_assist = campus_assist or {}

    for col, w in col_width.items():
        ws.column_dimensions[col].width = w

    # ============================================================ 行1 表头
    _put(ws, 1, 1, f"{tp}第{week}周工作安排表", center=True)
    for label, col in work_cols.items():
        _put(ws, 1, col, label)

    # ============================================================ 工作区（A + 各列）
    row = 2
    for t in tasks:
        per = assign_by_campus.get(t["id"]) or {}
        _put(ws, row, 1, t["name"])
        for label, col in work_cols.items():
            names = per.get(label) or []
            _put(ws, row, col, "、".join(names) if names else None)
        row += 1
    last_task_row = max(row - 1, 1)

    # ============================================================ 校区助理分布（A14 起）
    if campus_assist:
        arow = max(ASSIST_BLOCK_ROW, last_task_row + 2)
        _put(ws, arow, 1, "校区助理分布")
        for label in assist_labels:
            col = assist_cols.get(label)
            if col:
                _put(ws, arow, col, label)
        depth = max((len(v) for v in campus_assist.values()), default=0)
        for k in range(depth):
            for label in assist_labels:
                col = assist_cols.get(label)
                lst = campus_assist.get(label)
                if col and lst:
                    _put(ws, arow + 1 + k, col, lst[k] if k < len(lst) else None)

    # 样表是默认视图：不关网格线、不冻结、不设行高
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def filename(week: int, prefix: str = "质检部") -> str:
    return f"{prefix}第{week}周工作安排表.xlsx"


def content_disposition(week: int, prefix: str = "质检部") -> str:
    return f"attachment; filename*=UTF-8''{quote(filename(week, prefix))}"