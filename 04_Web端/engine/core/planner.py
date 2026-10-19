# -*- coding: utf-8 -*-
"""
确定性派活内核（纯函数，不依赖 FastAPI）

抽自 `main.do_arrange` 的排序规则，供 Web 接口与智能体工具共用同一份实现，避免两处漂移。

规则（逐级比较，不加权求和，保证可解释）：
    1. 主办学院回避 —— 不能派给活动的主办学院
    2. 上周回避     —— 上周已检查过该批活动的学院降权，避免连续两周同一学院
    3. 负载均衡     —— 本周已派件数少者优先
    4. 名称稳定排序 —— 平局用学院名定序，不用随机数

没有任何随机来源：给定 (活动, 学院池, 上周已派) 永远得到同一张表，可复现、可审计。
"""
from __future__ import annotations

from typing import Dict, List, Sequence, Tuple


def plan_checkers(
    acts: Sequence[dict],
    pool: Sequence[str],
    last_checked: Sequence[str] = (),
    per: int = 2,
) -> Tuple[Dict[int, List[str]], Dict[str, int], List[str]]:
    """为一批活动分配检查学院。

    参数
    ----
    acts          : 活动列表，每项需含 `row`、`name`、`host_college`
    pool          : 本次可派学院池
    last_checked  : 上周已检查过该批活动的学院（降权用）
    per           : 每个活动派几个学院

    返回
    ----
    (plan, load, problems)
        plan      行号 → 受派学院列表
        load      各学院本轮件数
        problems  需要人工看一眼的问题（不是异常，是如实披露）
    """
    last = set(last_checked or [])
    load: Dict[str, int] = {c: 0 for c in pool}
    plan: Dict[int, List[str]] = {}
    problems: List[str] = []

    for a in acts:
        host = a.get("host_college")
        cand = [c for c in pool if c != host]
        if len(cand) < per:
            problems.append(
                f"活动「{a.get('name')}」可选学院不足 {per} 个（主办={host}）")
            continue
        # 逐级比较：上周已派(0/1) → 本轮负载 → 名称
        cand.sort(key=lambda c: (1 if c in last else 0, load[c], c))
        chosen = cand[:per]
        for c in chosen:
            load[c] += 1
        plan[a["row"]] = chosen
        dup = [c for c in chosen if c in last]
        if dup:
            problems.append(
                f"活动「{a.get('name')}」安排了上周已检查的学院：" + "、".join(dup))

    return plan, load, problems


def plan_assistants(
    acts: Sequence[dict],
    pool: Sequence[str],
    last_assigned: Sequence[str] = (),
    per: int = 2,
) -> Tuple[Dict[int, List[str]], Dict[str, int], List[str]]:
    """助理派活：同一套排序链，只是回避对象换成「上周做过同一件事的人」。

    与 `plan_checkers` 分开命名，是为了让两条链的语义在调用处自解释；
    实现刻意共用同一段逻辑，避免有人日后只改了一边。
    """
    return plan_checkers(acts, pool, last_assigned, per)
