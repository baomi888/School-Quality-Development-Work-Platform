# -*- coding: utf-8 -*-
"""排班算法 —— 按「格」派活，规则全部可自定义（灵活版）。

**版式基础**：官方样表 B 列=西城、D 列=官渡，每件工作两格。
**分配结果**：{task_id: {"西城": [pid...], "官渡": [pid...]}} —— 每格 0~N 人。

## 规则演进（2026-10-08 部长最新指示）

1. **光华机动**：「那两个光华的也可以干西城的活，反正都是线上的」
   ⇒ 人的 `can_do` 字段决定能干哪几列（光华两位默认 西城+官渡 都能干），
   其他人默认只干主校区。派活时**主校区人优先**，缺人了机动人员补（COST_FLEX）。
2. **搭档制**：「前几周先让他们两个人一起完成一个任务」
   ⇒ 同一格允许放 2 个人（手动把第二个人加进同格并锁定即可）。
   算法默认每格 1 人保证覆盖，加人/减人完全手动、锁定后重摇不动。
3. **人员流动**：停用（active=false）的人不进候选池；人员增删改全在页面人员池里做。

## 优先级（= SORT_CHAIN 的顺序，逐级比较，不是加权求和）

  0. 手动锁定永远赢过一切规则（锁定的人即使 can_do 不含该格也尊重 —— 手动最高）
  1. 防重复 —— 避开「同一件活紧邻上周给了同一个人」
  2. 轮值 + 负载均衡 —— 累计件数（历史 + 本周）少的优先
  3. 主校区人优先（光华机动补缺）
  4. 以上都是平局 → 确定性哈希裁决（sha256(周次|重摇|人员id)，可复现）

**为什么不永久回避做过某活的人**：池子刚好够用，永久回避会出现固定几个人
无限循环。防重复只避「紧邻上周」。
"""

from __future__ import annotations

import hashlib
from typing import Any

from .models import Person, Task, ROLE_ASSIST, ROLE_DEPUTY, ROLE_LEAD

# ---- 官方样表里的两个安排列（导出表 B 列 / D 列）
CAMPUSES = ["西城", "官渡"]

# ---- 排序链（sort chain）：规则**逐级比较**，不是加权求和 ----
#
# 灵感来自 Apache-2.0 项目 Thomblin/duty-roster：它不把每条规则折算成一个"代价分"
# 再加总，而是写成一串 sort —— 先按 A 排，A 一样再按 B 排，B 一样再按 C 排。
#
# 为什么换掉加权求和（2026-10-10 实测驱动，见 _probe_sortchain.py）：
#   · 旧版四个权重常数里，**只有「上周回避」真的在起作用**。常数扰动实验：
#       repeat 0→上周重复 113 次 / 5→23 次 / 80→11 次（下限）；
#       而 once 30→20、more 12→25、flex 25→45 **结果零变化** ——
#       另外三个常数只是装饰，却让人误以为在"调权重"。
#   · 加权求和还有个隐形地雷：轮值项随历史**线性膨胀**（50 周后约 642），
#     会在后期悄悄压过固定的 80，使「上周回避」在学期末隐式失效。
#   · sort 链没有这个问题：每级只在**同级**时才往下比，规则之间不会互相淹没。
#
# 实测对照（50 周，_probe_sortchain.py 全绿）：
#   人均极差 1 件 / 标准差 0.24 / 忙碌度极差 0.00 / 上周重复 11 次 —— 与加权求和**四项全同**；
#   第 11 周逐格对比：相同 18/18 格，差异 0 格。
#   ⇒ 公平性不劣化，但规则变成可读、可增删、不用调权重的东西。
#
# 增删规则 = 在 Assigner 里加一个 `_rule_xxx` 方法，再把名字写进 SORT_CHAIN。
# 顺序即优先级：写在前面的先比。最后一级永远是确定性哈希（见 _hash_int）。
SORT_CHAIN = [
    "avoid_last_week",   # 上周刚做过同一件活 → 排到后面（唯一真在起作用的旧权重）
    "least_loaded",      # 累计件数（历史 + 本周）少的优先 —— 轮值 + 负载均衡合一
    "own_campus_first",  # 能干这一列的优先；缺人了才让机动人员补
]

# 每一级规则的名字（给人看的）
RULE_LABELS = {
    "avoid_last_week": "上周回避",
    "least_loaded": "累计件数",
    "own_campus_first": "本校区优先",
}


def _key(name: str) -> str:
    return str(name).strip()


def _hash_int(*parts: Any) -> int:
    """确定性哈希：同样的输入永远得到同样的整数。

    用来取代 random.random()。区别是它**可复现、可审计**：
    给定周次和重摇次数，任何人都能算出同一张表，而不是「系统随机的」。
    """
    raw = "|".join(str(x) for x in parts)
    return int(hashlib.sha256(raw.encode("utf-8")).hexdigest()[:12], 16)


def campus_for_duty(p: Person) -> str:
    """主校区（兼容旧调用）：光华 → 官渡（官方表只有西城、官渡两列）。

    新代码请用 Assigner.campus_for_duty 实例方法（尊重部门的 slot_alias）。
    """
    c = (p.campus or "").strip()
    return {"光华": "官渡"}.get(c, c) or CAMPUSES[-1]


class Assigner:
    """每件活两格、每格 0~N 人。领导（部长/副部长）监督但不接活。

    slots / slot_alias 是部门级的配置：
      · slots       = 列维度（质检部是 ["西城","官渡"]；认证部会是各校级组织）
      · slot_alias   = 主校区归并（如 光华 → 官渡），空则不开
    不传时回退到质检部默认，保证旧调用与回归探针结果逐格不变。
    """

    def __init__(
        self,
        people: list[Person],
        tasks: list[Task],
        last_week: dict[str, list[str]] | None = None,
        history_load: dict[str, int] | None = None,
        slots: list[str] | None = None,
        slot_alias: dict[str, str] | None = None,
        avoid_self_college: bool = False,
    ):
        self.slots = list(slots) if slots else list(CAMPUSES)
        self.slot_alias = dict(slot_alias) if slot_alias else {"光华": "官渡"}
        # 回避开关：认证部「不能查自己学院」这类角色冲突，做成硬过滤（见 _blocked）。
        self.avoid_self_college = avoid_self_college
        self.people = people
        self.tasks = tasks
        self.last_week = {k: [_key(x) for x in v] for k, v in (last_week or {}).items()}
        self.history_load = dict(history_load or {})
        self.by_id = {p.id: p for p in people}

        # 领导层：只监督，不进候选池
        self.leads = sorted(
            [p for p in people if p.role in (ROLE_LEAD, ROLE_DEPUTY) and p.active],
            key=lambda p: (p.role == ROLE_DEPUTY, p.order),
        )
        # 派活池：只要启用中的助理
        self.pool = sorted(
            [p for p in people if p.role == ROLE_ASSIST and p.active],
            key=lambda p: p.order,
        )
        if not self.pool:
            raise ValueError("没有可派活的助理（role=assist 且 active 的人为空）")

        # 每格的候选池：can_do 含该格的人（空 can_do = 只干主校区）
        self.slot_pool: dict[str, list[Person]] = {
            c: [p for p in self.pool if c in self.can_do(p)] for c in self.slots
        }
        self.empty_slots = [c for c in self.slots if not self.slot_pool[c]]

    def campus_for_duty(self, p: Person) -> str:
        """主校区（尊重部门的 slot_alias 归并）。"""
        c = (p.campus or "").strip()
        return self.slot_alias.get(c, c) or self.slots[-1]

    # ------------------------------------------------------------ 工具
    def can_do(self, p: Person) -> list[str]:
        """能干哪几列。can_do 为空 = 只干主校区（按部门的 slot_alias 归并）。"""
        cds = [c for c in (p.can_do or []) if c in self.slots]
        return cds or [self.campus_for_duty(p)]

    def _did_last_week(self, person: Person, task_name: str) -> bool:
        return _key(task_name) in self.last_week.get(person.id, [])

    def _load(self) -> dict[str, int]:
        return {p.id: len(p.assigned) for p in self.pool}

    def _campus_load(self) -> dict[str, int]:
        """按主校区口径统计本周件数（页面展示用）。"""
        out: dict[str, int] = {c: 0 for c in self.slots}
        for p in self.pool:
            n = len(p.assigned)
            if n:
                out[self.campus_for_duty(p)] = out.get(self.campus_for_duty(p), 0) + n
        return out

    # ---------------------------------------------------------- 排序链
    def _rule_avoid_last_week(self, task: Task, p: Person, slot: str, load: dict) -> tuple:
        """第 1 级：上周刚做过同一件活 → 排到后面。只避「紧邻上周」。"""
        hit = self._did_last_week(p, task.name)
        return (1 if hit else 0,
                f"上周{'做过' if hit else '没做过'}这件活")

    def _rule_least_loaded(self, task: Task, p: Person, slot: str, load: dict) -> tuple:
        """第 2 级：累计件数（历史 + 本周）少的优先。

        ⚠️ 历史教训（2026-10-09）：轮值项与本周负载项曾经**分开计价**（历史一步 30、
        本周多派一件只 +12），结果轮空者会被连派 3 件才被追平。现在合并成一个数：
        total = 历史累计 + 本周已派，本周内每多派一件就 +1，天然压住轮空优势。
        """
        hist = self.history_load.get(p.id, 0)
        cur = load.get(p.id, 0)
        return (hist + cur, f"累计 {hist + cur} 件（历史 {hist} + 本周 {cur}）")

    def _rule_own_campus_first(self, task: Task, p: Person, slot: str, load: dict) -> tuple:
        """第 3 级：能干这一列的优先，缺人了才让机动人员补。

        ⚠️ 这里必须用 can_do 判，不能用主校区判 —— 否则光华两位（主校区被归到官渡）
        会被官渡列优先吸走，西城 8 人就得长期多扛一件活。
        实测 50 周：用主校区判 → 西城 54~55 件 vs 官渡/光华 51~52 件；
        改用 can_do 判 → 两列都对他们等价，去哪边由负载决定，长期自动均衡。
        """
        ok = slot in self.can_do(p)
        return (0 if ok else 1,
                "本校区" if ok else f"机动支援（{p.campus or '?'} → {slot}）")

    def _chain(self, task: Task, p: Person, slot: str, load: dict) -> list[dict]:
        """按 SORT_CHAIN 逐级算值，返回 [{rule, level, value, note}]。

        每级只产出「数值 + 人话」，不做加权 —— 比较发生在 _pick 的元组排序里。
        """
        out: list[dict] = []
        for name in SORT_CHAIN:
            fn = getattr(self, "_rule_" + name, None)
            if fn is None:
                continue
            v, note = fn(task, p, slot, load)
            out.append({"rule": name, "level": RULE_LABELS.get(name, name),
                        "value": v, "note": note})
        return out

    @staticmethod
    def _rank(chain: list[dict]) -> tuple:
        return tuple(c["value"] for c in chain)

    def _pick(
        self, t: Task, c: str, cands: list[Person], load: dict[str, int],
        week: int, shake: int,
    ) -> tuple[Person, list[dict]]:
        """在该格的候选里排一次序，返回（选中者, 完整排名）。

        排序主键是**逐级比较的元组**（SORT_CHAIN），全部同级才落到确定性哈希 —— 不用 random。
        """
        scored: list[dict] = []
        for p in cands:
            chain = self._chain(t, p, c, load)
            scored.append({
                "p": p, "chain": chain, "rank": self._rank(chain),
                "tie": _hash_int(week, shake, p.id),
            })
        scored.sort(key=lambda x: (x["rank"], x["tie"]))
        return scored[0]["p"], scored

    def _explain(self, picks: dict) -> dict[str, dict]:
        """把每一格的「为什么是他」整理成可展示的结构。

        sort 链没有"总分"这个概念，所以解释方式是**逐级说**：先列他每一级的值，
        再指出是在第几级胜过次优的；如果每一级都并列，就明说是确定性哈希裁决的。
        """
        out: dict[str, dict] = {}
        for (tid, c), scored in picks.items():
            top = scored[0]
            line = " · ".join(x["note"] for x in top["chain"])
            runner = scored[1] if len(scored) > 1 else None

            # 找出第一级「分出胜负」的地方
            decided = None
            if runner is not None and top["rank"] != runner["rank"]:
                for i, (a, b) in enumerate(zip(top["rank"], runner["rank"])):
                    if a != b:
                        decided = i
                        break

            if runner is None:
                reason = f"{line} —— 该格只有 1 个候选人"
            elif decided is not None:
                lv = top["chain"][decided]["level"]
                reason = (f"{line} —— 在第 {decided + 1} 级「{lv}」胜出"
                          f"（{top['chain'][decided]['note']}"
                          f" vs {runner['p'].name} {runner['chain'][decided]['note']}）")
            else:
                reason = f"{line} —— 各项完全并列，按本周确定性序列裁决（可复现）"

            # 「并列」= 每一级的值都跟他一样的人（这些人之间是靠哈希定的）
            tied = sum(1 for s in scored if s["rank"] == top["rank"])
            out.setdefault(tid, {})[c] = {
                "picked": top["p"].id,
                "picked_name": top["p"].name,
                "detail": reason,
                "candidates": len(scored),
                "tied": tied,
                "chain": [
                    {"level": x["level"], "value": x["value"], "note": x["note"]}
                    for x in top["chain"]
                ],
                "runner_up": ({
                    "name": runner["p"].name,
                    "gap": (decided + 1) if decided is not None else 0,
                    "note": (
                        f"在第 {decided + 1} 级「{top['chain'][decided]['level']}」落后"
                        f"（{runner['chain'][decided]['note']} vs {top['chain'][decided]['note']}）"
                        if decided is not None else
                        "各项完全并列，靠确定性序列分先后"
                    ),
                } if runner else None),
            }
        return out

    # ------------------------------------------------------------ 主流程
    def run(
        self,
        seed: int | None = None,
        locked: dict[str, dict[str, list[str]]] | None = None,
        week: int = 0,
        explain: bool = False,
    ) -> dict[str, Any]:
        """返回 {task_id: {校区: [pid...]}} + 统计 + 提醒（+ 分配理由）。

        ## 关于「随机」（2026-10-09 重写，实测驱动）

        旧实现用 `random.Random(seed)` 打平局。实测暴露三个问题：
          · seed 为 None 时按系统时间播种 → 同一批输入每次排出不同的表，事后无法还原
          · 首周台账为空、人人代价都是 0 → 83% 的格纯靠随机定；换个 seed 89% 的格会变
          · 遍历顺序固定 → 18 格派给 17 人时，「多干一件」的位置永远落在清单最后一件活
            （实测：前 8 件活的负责人当周累计 1.03~1.07 件，第 9 件高达 1.61 件）

        现在改为**确定性平局裁决**：
          · 平局用 sha256(week|shake|person_id) 比较 —— 随周次变化，长期均匀；
            但给定周次与重摇次数，任何人都能复现同一张表
          · 待分配的格按稳定哈希乱序 —— 「哪件活承担多出来的一件」每周轮换，
            不再钉死在清单最后一件
          · 不再依赖 random 模块：同样的输入，永远同样的输出
        """
        shake = 0 if seed is None else int(seed)
        week = int(week or 0)
        locked = {k: {c: list(v) for c, v in (per or {}).items()}
                  for k, per in (locked or {}).items()}

        for p in self.people:
            p.assigned = []
            p.last_week_tasks = list(self.last_week.get(p.id, []))

        # 锁定解析：手动锁定永远赢过规则。
        # 只过滤「不存在 / 非助理 / 已停用」—— can_do 不含该格也接受（用户手动安排优先）。
        fixed: dict[str, dict[str, list[Person]]] = {}
        for t in self.tasks:
            per: dict[str, list[Person]] = {}
            for c, ids in (locked.get(t.id) or {}).items():
                if c not in self.slots:
                    continue
                ok: list[Person] = []
                for pid in ids:
                    p = self.by_id.get(pid)
                    if p and p.role == ROLE_ASSIST and p.active and p not in ok:
                        ok.append(p)
                if ok:
                    per[c] = ok
            fixed[t.id] = per

        slots_of: dict[str, dict[str, list[Person]]] = {}
        picks: dict[tuple[str, str], list[dict]] = {}

        def place(t: Task, c: str, ps: list[Person], scored: list[dict] | None = None):
            slots_of.setdefault(t.id, {})[c] = list(ps)
            for p in ps:
                p.assigned.append(t.name)
            if scored:
                picks[(t.id, c)] = scored

        def taken_ids(t: Task) -> set[str]:
            """同一件活不派同一个人两次（乱序后两格不再相邻，必须显式防住）。"""
            return {p.id for ps in slots_of.get(t.id, {}).values() for p in ps}

        # 手动锁定先落位
        for t in self.tasks:
            for c in self.slots:
                lp = fixed.get(t.id, {}).get(c)
                if lp:
                    place(t, c, lp)

        # 收集待自动分配的格
        pending: list[tuple[Task, str]] = []
        for t in self.tasks:
            for c in self.slots:
                if fixed.get(t.id, {}).get(c):
                    continue
                if not self.slot_pool.get(c):
                    slots_of.setdefault(t.id, {})[c] = []
                    continue
                pending.append((t, c))

        # 稳定乱序：消除「清单靠前的活先挑闲人」带来的顺序偏差
        pending.sort(key=lambda it: _hash_int(week, shake, "slot", it[0].id, it[1]))

        # 第一轮：只派本周还没有活的人 —— 保证人人有活
        rest: list[tuple[Task, str]] = []
        for t, c in pending:
            load = self._load()
            taken = taken_ids(t)
            zero = [p for p in self.slot_pool[c]
                    if load.get(p.id, 0) == 0 and p.id not in taken
                    and not self._blocked(p, t)]
            if not zero:
                rest.append((t, c))
                continue
            chosen, scored = self._pick(t, c, zero, load, week, shake)
            place(t, c, [chosen], scored)

        # 第二轮：剩下的格在全体候选里挑代价最小的 ——
        # 历史最闲的人承担多出来的那件，而不是清单最后一件活的人
        for t, c in rest:
            load = self._load()
            taken = taken_ids(t)
            cands = [p for p in self.slot_pool[c] if p.id not in taken
                     and not self._blocked(p, t)]
            if not cands:
                slots_of.setdefault(t.id, {})[c] = []
                continue
            chosen, scored = self._pick(t, c, cands, load, week, shake)
            place(t, c, [chosen], scored)

        assign: dict[str, dict[str, list[str]]] = {}
        for t in self.tasks:
            per = slots_of.get(t.id, {})
            assign[t.id] = {c: [p.id for p in per.get(c, [])] for c in self.slots}
            t.assignees = [p.id for ps in per.values() for p in ps]

        warnings = self._warnings(assign)
        out: dict[str, Any] = {
            "assign": assign,
            "load": self._load(),
            "campus_load": self._campus_load(),
            "warnings": warnings,
            "week": week,
            "shake": shake,
        }
        if explain:
            out["explain"] = self._explain(picks)
        return out

    # ------------------------------------------------------------ 硬过滤（回避）
    def _blocked(self, p: Person, t: Task) -> bool:
        """认证部「不能查自己学院」这类角色冲突：做成硬过滤，而非可加权的软偏好。

        触发条件（三者同时）：
          · 机构开了 avoid_self_college
          · 这件活标注了 scope（针对某学院）
          · 该助理的 college 与 scope 相同
        —— 不是因为不会干，而是利益冲突（怕给自己学院加素拓分放水）。
        """
        if not self.avoid_self_college:
            return False
        return bool(t.scope and p.college and p.college == t.scope)

    # ------------------------------------------------------------ 体检
    def _warnings(self, assign: dict[str, dict[str, list[str]]]) -> list[dict]:
        warn: list[dict] = []
        for c in self.empty_slots:
            warn.append({
                "task": "（全校）", "kind": "no_pool",
                "text": f"{c}列没有可派的人（可在人员池里把某人的「可派」勾上{c}）",
            })
        for t in self.tasks:
            per = assign.get(t.id) or {}
            for c in self.slots:
                if not per.get(c):
                    warn.append({
                        "task": t.name, "kind": "slot_empty",
                        "text": f"「{t.name}」的 {c} 格空着 —— 手动点人补上，或就让它空着",
                    })
            for ids in per.values():
                for pid in ids:
                    p = self.by_id.get(pid)
                    if p and self._did_last_week(p, t.name):
                        warn.append({
                            "task": t.name, "kind": "repeat",
                            "text": f"{p.name} 上周也做「{t.name}」，本周又派给他了",
                        })
        # 个人负载倾斜
        load = self._load()
        if load:
            mx = max(load.values())
            if mx >= 3:
                names = [p.name for p in self.pool if load[p.id] == mx]
                warn.append({
                    "task": "（全校）", "kind": "load_tilt",
                    "text": f"本周有 {mx} 件的人：{'、'.join(names)}（可点「换人」调开）",
                })
        return warn


def load_stats(ledger: dict) -> tuple[dict[str, int], int]:
    """从台账算每个人历史累计件数 + 已排周数（用于轮值排序）。"""
    load: dict[str, int] = {}
    for assign in ledger.get("weeks", {}).values():
        for pid, tasks in assign.items():
            load[pid] = load.get(pid, 0) + len(tasks)
    return load, len(ledger.get("weeks", {}))