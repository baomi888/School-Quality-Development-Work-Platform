# -*- coding: utf-8 -*-
"""值班表查询（只读，不进派活算法）。

**隐私红线**：真实值班花名册**不写进源码**，只放在 gitignore 的
``engine/data/<dept_id>/duty_roster.json``（本地数据，不入库）。
本模块从该 JSON 读取；文件缺失时返回空结构，开源克隆也能正常启动
（只是没有值班数据可展示）。

原表是「节次 × 周几」粒度：
    行 = 一二节 / 三四节 / 五六节 / 七八节
    列 = 周一 ~ 周五
    格内 = 该节次值班的学生姓名（换行分隔）

工具里汇总到「天」维度：同一天四个节次的人合并去重。
导出安排表时自动填「值班检查」区块。

**值班与派活无关**：值班只用于填导出表，不进派活算法（不参与轮值计算）。

JSON 结构（示例见 duty_roster.json）：
    {
      "guanghua_in_guandu": {"姓名": {"campus": "光华", "day": "周二", "period": "七八节"}},
      "campus_duty": {"西城": {<按 节次×周几>}, "官渡": {<按 节次×周几>}}
    }
"""

from __future__ import annotations

import json
import os
from functools import lru_cache

# 光华校区来官渡值班的两位助理：备注用，导出表里不额外标注校区。
# 由 duty_roster.json 的 guanghua_in_guandu 字段提供，这里只留类型说明。

DAYS = ["周一", "周二", "周三", "周四", "周五"]

# 节次行名（原表 A 列）
PERIODS = ["一二节", "三四节", "五六节", "七八节"]

_DATA_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "data"))


@lru_cache(maxsize=None)
def load_roster(dept_id: str = "zjb") -> dict:
    """读取 gitignore 的外部值班花名册；不存在或损坏则返回空结构。

    返回：{"guanghua_in_guandu": {...}, "campus_duty": {"西城": {...}, "官渡": {...}}}
    """
    path = os.path.join(_DATA_DIR, dept_id, "duty_roster.json")
    if not os.path.exists(path):
        return {"guanghua_in_guandu": {}, "campus_duty": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            "guanghua_in_guandu": data.get("guanghua_in_guandu", {}) or {},
            "campus_duty": data.get("campus_duty", {}) or {},
        }
    except Exception:
        return {"guanghua_in_guandu": {}, "campus_duty": {}}


def guanghua_in_guandu(dept_id: str = "zjb") -> dict:
    """光华校区来官渡值班的两位助理（备注用，导出表里不显示）。"""
    return load_roster(dept_id).get("guanghua_in_guandu", {})


def daily_people(campus: str, dept_id: str = "zjb") -> dict[str, list[str]]:
    """{周几: 当天全部值班人（四个节次合并去重，保持原表顺序）}。"""
    table = load_roster(dept_id).get("campus_duty", {}).get(campus, {})
    out: dict[str, list[str]] = {}
    for day in DAYS:
        seen: list[str] = []
        for period in PERIODS:
            for name in table.get(day, {}).get(period, []):
                if name and name not in seen:
                    seen.append(name)
        out[day] = seen
    return out


def all_duty(dept_id: str = "zjb") -> list[dict]:
    """导出用：[{day, campus, people:[...]}]，按 周一~周五 × 西城/官渡 展开。"""
    out: list[dict] = []
    for campus in ("西城", "官渡"):
        daily = daily_people(campus, dept_id)
        for day in DAYS:
            people = daily.get(day, [])
            if people:
                out.append({"day": day, "campus": campus, "people": people})
    return out


def summary_line(dept_id: str = "zjb") -> list[str]:
    """给导出表页脚用的概览，如「西城 周一 3 人 / 官渡 周一 2 人」。"""
    lines = []
    for campus in ("西城", "官渡"):
        daily = daily_people(campus, dept_id)
        lines.append(f"{campus}：" + "、".join(
            f"{d} {len(daily[d])}人" for d in DAYS if daily.get(d)
        ))
    return lines
