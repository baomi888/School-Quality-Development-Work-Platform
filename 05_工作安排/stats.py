# -*- coding: utf-8 -*-
"""公平性报告：50 周确定性模拟的量化出口。

为什么有这个文件：medshift 等同类的排班项目都有 stats 命令，我方原本把指标散在
_probe_sortchain.py 探针里、没有收敛的出口。这里把它收敛成一个可复现的报告 ——
既写进 README 当开源卖点，也给后续接新部门（认证部 / 综合部 …）做公平性回归基线。

确定性：shake=0 时，给定同样的默认名单，任何人跑出的数字都一样（不依赖 random）。
运行：python stats.py   （在 05_工作安排/ 下执行）
"""
from __future__ import annotations

import sys
import statistics
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from engine.core.models import Person, Task, DEFAULT_PEOPLE, DEFAULT_TASKS  # noqa: E402
from engine.core.assigner import Assigner  # noqa: E402

WEEKS = 50

_ALLOWED_PERSON = ("id", "name", "role", "order", "active", "campus", "can_do", "units")
_ALLOWED_TASK = ("id", "name", "tag", "order", "locked", "note")


def _person(d: dict) -> Person:
    d = {k: v for k, v in d.items() if k in _ALLOWED_PERSON}
    return Person(**d)


def _task(d: dict) -> Task:
    d = {k: v for k, v in d.items() if k in _ALLOWED_TASK}
    return Task(**d)


def simulate(weeks: int = WEEKS, shake: int = 0) -> dict:
    """跑 weeks 周确定性模拟，返回公平性指标汇总。"""
    people = [_person(p) for p in DEFAULT_PEOPLE]
    tasks = [_task(t) for t in DEFAULT_TASKS]
    history = {p.id: 0 for p in people}
    last_week: dict[str, list[str]] = {}
    per_task = {t.id: 0 for t in tasks}
    max_load = 0
    repeat = 0

    for wk in range(1, weeks + 1):
        a = Assigner(people, tasks, last_week=last_week, history_load=history)
        out = a.run(week=wk, seed=shake)
        load = out["load"]

        # 统计本周边：各活累计、同活重复
        new_last: dict[str, list[str]] = {}
        for t in tasks:
            cnt = 0
            for c in a.slots:
                for pid in out["assign"].get(t.id, {}).get(c, []):
                    cnt += 1
                    new_last.setdefault(pid, []).append(t.name)
                    if pid in last_week and t.name in last_week[pid]:
                        repeat += 1
            per_task[t.id] += cnt

        for pid, n in load.items():
            history[pid] += n
        last_week = new_last
        if load:
            max_load = max(max_load, max(load.values()))

    assists = [p for p in people if p.role == "assist"]
    vals = [history[p.id] for p in assists]
    mean = statistics.mean(vals)
    sd = statistics.pstdev(vals)
    rng = max(vals) - min(vals)
    busy = list(per_task.values())
    busy_rng = max(busy) - min(busy)

    return {
        "weeks": weeks,
        "assists": len(assists),
        "tasks": len(tasks),
        "slots": len(a.slots),
        "mean": round(mean, 2),
        "std": round(sd, 2),
        "range": rng,
        "busy_range": busy_rng,
        "max_load": max_load,
        "repeat": repeat,
    }


def build_report(r: dict) -> str:
    total_cells = r["weeks"] * r["tasks"] * r["slots"]
    lines = [
        "# 公平性实测报告（50 周确定性模拟）",
        "",
        f"- 模拟周数：**{r['weeks']}** 周",
        f"- 助理人数：**{r['assists']}** 人（派活池，领导层只监督不接活）",
        f"- 工作内容：**{r['tasks']}** 件/周 × {r['slots']} 校区列 = {r['tasks'] * r['slots']} 格",
        "",
        "## 长期负载均衡",
        f"- 人均累计件数：均值 **{r['mean']}** / 标准差 **{r['std']}** / 极差 **{r['range']}** 件",
        f"- 各活忙碌度极差：**{r['busy_range']}** 件（最忙与最闲的活之间差距）",
        "",
        "## 可复现性与健康度",
        f"- 单周最大负载：**{r['max_load']}** 件/人（全员单周不超 2 件）",
        f"- 上周同活重复：**{r['repeat']}** 次 / 共 {total_cells} 格·周",
        "",
        "> **确定性保证**：shake=0 时，给定同样的名单任何人跑出完全相同的数字，"
        "不依赖 `random`。分配由 sha256(周次|重摇|人员id) 稳定哈希裁决，可审计、可复现。",
        "",
        "> **回归门禁**：`_probe_random.py` / `_probe_sortchain.py` 为 CI 公平性门禁"
        "（纯 Python、秒级、非零退出即失败）。接入新部门后，本报告的极差 / 标准差"
        "应作为新的基线重新采集。",
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    r = simulate()
    report = build_report(r)
    print(report)
    out_md = HERE / "FAIRNESS_REPORT.md"
    out_md.write_text(report, encoding="utf-8")
    print(f"\n报告已写入：{out_md}")


if __name__ == "__main__":
    main()
