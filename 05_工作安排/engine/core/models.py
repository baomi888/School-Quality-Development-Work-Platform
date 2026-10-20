# -*- coding: utf-8 -*-
"""工作分配数据模型与默认配置。

质检部第X周工作安排表的数据层：
  People   —— 人员池（部长 / 副部长 / 助理 / 助理），可增删改
  Tasks    —— 工作内容池，一周要干的活
  Ledger   —— 排班台账，记录每周谁做了什么（用于避免连续重复）
  Plan     —— 某一周的分配结果（可被手动纠正）
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------- 角色定义

# role 决定派活顺序：助理组绑定优先，其次部长/副部长轮值
ROLE_LEAD = "lead"        # 部长
ROLE_DEPUTY = "deputy"    # 副部长
ROLE_ASSIST = "assist"    # 助理（两人绑定成组同做一份活）

ROLE_LABEL = {
    ROLE_LEAD: "部长",
    ROLE_DEPUTY: "副部长",
    ROLE_ASSIST: "助理",
}


@dataclass
class Person:
    id: str
    name: str
    role: str                      # lead / deputy / assist
    order: int = 0                 # 轮值顺序，越小越优先
    active: bool = True            # 停用后不参与派活，但保留在名单（人员流动用）
    campus: str = ""               # 主校区：西城 / 官渡 / 光华
    # 可派校区：能干哪些列的活（空 = 只干主校区）。
    # 部长 2026-10-08 指示：光华两位「也可以干西城的活，反正都是线上的」
    # ⇒ 光华默认 ["西城","官渡"] 机动支援；其余人默认只干主校区。
    can_do: list[str] = field(default_factory=list)
    units: list[str] = field(default_factory=list)   # 分管单位（包干制输入数据，供回避/负荷展示，内核不读）
    # 所属学院（认证部回避用）：助理不能负责「收自己学院表」这种活。
    # 与 `campus`（主校区）是两回事 —— campus 是西城/官渡/光华，college 是具体学院。
    college: str = ""
    # 该人员上周做过的活（运行期由台账填入，不落盘到 people 里）
    last_week_tasks: list[str] = field(default_factory=list)
    # 本次分配的活
    assigned: list[str] = field(default_factory=list)

    @property
    def label(self) -> str:
        return f"{ROLE_LABEL.get(self.role, self.role)}·{self.name}"


@dataclass
class Task:
    id: str
    name: str
    # tag 用于导出/提示：heavy=需要领导拍板/对外, routine=执行/琐碎
    tag: str = "routine"
    order: int = 0                # 清单顺序，影响派活先后与导出 A 列行序
    locked: bool = False           # 锁定后重摇不改变该项
    assignees: list[str] = field(default_factory=list)   # 人员 id 列表（西城一人 + 官渡一人）
    note: str = ""
    # 该活针对的学院（认证部回避用）：非空时，college 与之相同的助理被硬排除。
    # 空 = 无特定学院，不触发回避。
    scope: str = ""

    @property
    def is_pair(self) -> bool:
        return len(self.assignees) >= 2


# ---------------------------------------------------------------- 台账

LEDGER_FILE = "ledger.json"
PEOPLE_FILE = "people.json"
TASKS_FILE = "tasks.json"
PLAN_FILE = "plan.json"          # 某周「完整分配网格」，供小助理只读反查「本周我负责」

# ⚠️ 已移除硬编码 DEPARTMENT = "质检部"：部门改为可配置的注册表（见 OrgRegistry）。

# 人员池数据说明（**开源示例数据，已脱敏**）
#
# ⚠️ 隐私红线：本仓库是开源的，这里的姓名**一律是占位示例**，不得填入任何真实同学姓名。
#    真实名单只存在本机 `engine/data/people.json`，该文件已被 .gitignore 排除，
#    永远不会进入版本库。首次启动会生成下面的示例数据，请在页面「人员池」里替换成
#    你所在机构的真实名单。
#
# 结构说明（改结构看这里，改名单去页面）：
#   role   —— lead 部长 / deputy 副部长 / assist 助理；只有 assist 参与派活，
#             部长副部长只监督（派活池 `Assigner.pool` 只收 role==assist）
#   campus —— 主校区；光华在导出表里归入官渡列（官方表只有西城、官渡两列）
#   can_do —— 能干哪几列；空 = 只干主校区；填 ["西城","官渡"] = 两列机动
#   order  —— 名单顺序，同时用作稳定排序的基准
#
# 示例配置：4 位领导（不接活）+ 17 名助理（派活池），共 21 人。
# ⚠️ 改这里不会自动生效，必须删掉 data/people.json 重新播种。
DEFAULT_PEOPLE = [
    # ---- 西城：部长 1 + 副部长 1
    {"id": "u_lead",  "name": "示例·西城部长",   "role": ROLE_LEAD,   "order": 0, "campus": "西城"},
    {"id": "u_dep_1", "name": "示例·西城副部长", "role": ROLE_DEPUTY, "order": 1, "campus": "西城"},
    # ---- 官渡：副部长 2
    {"id": "u_dep_2", "name": "示例·官渡副部长A", "role": ROLE_DEPUTY, "order": 2, "campus": "官渡"},
    {"id": "u_dep_3", "name": "示例·官渡副部长B", "role": ROLE_DEPUTY, "order": 3, "campus": "官渡"},
    # ---- 西城校区助理（8）
    {"id": "u_xc_1", "name": "示例·西城甲", "role": ROLE_ASSIST, "order": 4,  "campus": "西城"},
    {"id": "u_xc_2", "name": "示例·西城乙", "role": ROLE_ASSIST, "order": 5,  "campus": "西城"},
    {"id": "u_xc_3", "name": "示例·西城丙", "role": ROLE_ASSIST, "order": 6,  "campus": "西城"},
    {"id": "u_xc_4", "name": "示例·西城丁", "role": ROLE_ASSIST, "order": 7,  "campus": "西城"},
    {"id": "u_xc_5", "name": "示例·西城戊", "role": ROLE_ASSIST, "order": 8,  "campus": "西城"},
    {"id": "u_xc_6", "name": "示例·西城己", "role": ROLE_ASSIST, "order": 9,  "campus": "西城"},
    {"id": "u_xc_7", "name": "示例·西城庚", "role": ROLE_ASSIST, "order": 10, "campus": "西城"},
    {"id": "u_xc_8", "name": "示例·西城辛", "role": ROLE_ASSIST, "order": 11, "campus": "西城"},
    # ---- 官渡校区助理（7）
    {"id": "u_gd_1", "name": "示例·官渡甲", "role": ROLE_ASSIST, "order": 12, "campus": "官渡"},
    {"id": "u_gd_2", "name": "示例·官渡乙", "role": ROLE_ASSIST, "order": 13, "campus": "官渡"},
    {"id": "u_gd_3", "name": "示例·官渡丙", "role": ROLE_ASSIST, "order": 14, "campus": "官渡"},
    {"id": "u_gd_4", "name": "示例·官渡丁", "role": ROLE_ASSIST, "order": 15, "campus": "官渡"},
    {"id": "u_gd_5", "name": "示例·官渡戊", "role": ROLE_ASSIST, "order": 16, "campus": "官渡"},
    {"id": "u_gd_6", "name": "示例·官渡己", "role": ROLE_ASSIST, "order": 17, "campus": "官渡"},
    {"id": "u_gd_7", "name": "示例·官渡庚", "role": ROLE_ASSIST, "order": 18, "campus": "官渡"},
    # ---- 光华校区助理（2）：机动，两列都能干
    {"id": "u_gh_1", "name": "示例·光华甲", "role": ROLE_ASSIST, "order": 19, "campus": "光华",
     "can_do": ["西城", "官渡"]},
    {"id": "u_gh_2", "name": "示例·光华乙", "role": ROLE_ASSIST, "order": 20, "campus": "光华",
     "can_do": ["西城", "官渡"]},
]

# 校区助理分布（官方样表 A14 起，用于导出表的「校区助理分布」区块）
DEFAULT_CAMPUS_ASSIST = {
    "西城": ["示例·西城甲", "示例·西城乙", "示例·西城丙", "示例·西城丁",
             "示例·西城戊", "示例·西城己", "示例·西城庚", "示例·西城辛"],
    "官渡": ["示例·官渡甲", "示例·官渡乙", "示例·官渡丙", "示例·官渡丁",
             "示例·官渡戊", "示例·官渡己", "示例·官渡庚"],
    "光华": ["示例·光华甲", "示例·光华乙"],
}

# 工作内容池：**A 列顺序严格照官方样表**（收集空闲时间表 … 收集打包活动登记表）
# 前 7 项来自官方样表 A2:A8；t_08/t_09 是本部门实际还在做的事，接在后面。
# heavy = 需领导拍板/对外的活（导出表不再单独标红，只在页面提示）
DEFAULT_TASKS = [
    {"id": "t_01", "name": "收集空闲时间表",       "tag": "routine"},
    {"id": "t_02", "name": "安排二级学院检查活动", "tag": "heavy"},
    {"id": "t_03", "name": "安排助理检查活动",     "tag": "routine"},
    {"id": "t_04", "name": "发布值班请假登记表",   "tag": "routine"},
    {"id": "t_05", "name": "整理邮箱",             "tag": "routine"},
    {"id": "t_06", "name": "与规划部交接",         "tag": "heavy"},
    {"id": "t_07", "name": "收集打包活动登记表",   "tag": "routine"},
    {"id": "t_08", "name": "记录活动登记表",       "tag": "routine"},
    {"id": "t_09", "name": "整理办公室蓝盒子",     "tag": "routine"},
]


# ---------------------------------------------------------------- 部门注册表

@dataclass
class OrgDef:
    """一个「部门 / 机构」的可配置描述。

    平台最终形态：顶栏选部门 → 整个台账 / 任务池 / 导出版式随部门切换。
    内核（assigner.py）只认 `slots`（列维度），所以接一个新部门 = 填一份 OrgDef，
    原则上零代码改动（这就是 P2「≤30 分钟且不需改代码」门禁的落点）。
    """
    id: str
    name: str
    # 版式原型（决定行维度怎么理解）：
    #   task_x_slot 派活型（任务 × 列，如质检部/认证部）
    #   date_x_slot 排班型（日期 × 节次，如综合部，适配中）
    #   task_x_deadline 排期型（稿件 × deadline，如宣传部，适配中）
    #   event_x_quota 招募型（场次 × 名额，如竞赛部，适配中）
    archetype: str = "task_x_slot"
    # 列维度（派活型下 = 每一件活的「格」标签；质检部是 西城/官渡）
    slots: list[str] = field(default_factory=list)
    # 主校区归并：如 光华 → 官渡。空 = 不归并
    slot_alias: dict[str, str] = field(default_factory=dict)
    # 导出版式（见 exporter.ExportPlan）；质检部是官方样表的精确复刻
    export: dict = field(default_factory=dict)
    # 校区助理分布区块（可选；质检部有，其他部门可留空）
    assist_block: dict[str, list[str]] = field(default_factory=dict)
    # 是否有「值班检查」参考表（仅质检部）
    has_duty: bool = False
    # 回避开关：开启后，college 与某活 scope 相同的助理被硬排除（认证部「不能查自己学院」）。
    # 这是「角色冲突」而不是「技能维度」——不能查自己学院是怕给自己学院加素拓分放水，
    # 不是因为不会干。所以做成硬过滤，而非可加权排序的软偏好。
    avoid_self_college: bool = False

    @staticmethod
    def zjb_export() -> dict:
        """质检部官方样表的精确版式：B=西城、D=官渡，第 14 行起校区助理分布。"""
        return {
            "title_prefix": "质检部",
            "work_cols": {"西城": 2, "官渡": 4},
            "assist_cols": {"西城": 2, "官渡": 3, "光华": 4},
            "col_width": {"A": 26, "B": 14, "C": 14, "D": 14, "E": 6},
            "assist_labels": ["西城", "官渡", "光华"],
        }


# 质检部 = 平台首个、也是默认部门。其余部门在页面「新建部门」时写入 orgs.json。
DEFAULT_ZJB = OrgDef(
    id="zjb",
    name="质检部",
    archetype="task_x_slot",
    slots=["西城", "官渡"],
    slot_alias={"光华": "官渡"},
    export=OrgDef.zjb_export(),
    assist_block=DEFAULT_CAMPUS_ASSIST,
    has_duty=True,
)

# 各部门首次启动时的种子数据。
#   zjb → 沿用既有示例（脱敏）；其他部门 → 空名单，由用户在页面填写。
# ⚠️ 真实名单只在 engine/data/<dept_id>/ 下，已被 .gitignore 排除。
ORG_SEED: dict[str, tuple[list, list]] = {
    "zjb": (DEFAULT_PEOPLE, DEFAULT_TASKS),
}


class OrgRegistry:
    """部门清单：落盘在 data/orgs.json，可被页面动态创建。"""

    def __init__(self, data_dir: Path):
        self.path = Path(data_dir) / "orgs.json"
        self._lock = threading.RLock()
        self._seed()

    def _seed(self) -> None:
        with self._lock:
            if not self.path.exists():
                self._write([asdict(DEFAULT_ZJB)])

    def _read(self) -> list[dict]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return [asdict(DEFAULT_ZJB)]

    def _write(self, rows: list[dict]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.path)

    def list(self) -> list[dict]:
        return self._read()

    def get(self, org_id: str) -> dict | None:
        for o in self._read():
            if o.get("id") == org_id:
                return o
        return None

    def create(self, payload: dict) -> dict:
        rows = self._read()
        if any(o.get("id") == payload.get("id") for o in rows):
            raise ValueError(f"部门 id「{payload.get('id')}」已存在")
        rows.append(payload)
        self._write(rows)
        return payload


# ---------------------------------------------------------------- Store

class Store:
    """轻量 JSON 持久化。单进程单文件锁，避免并发写坏。

    default_people / default_tasks 仅在该部门数据文件「尚不存在」时用于播种——
    质检部沿用既有脱敏示例；其他部门播种空名单，由用户在页面填写。
    """

    def __init__(
        self,
        data_dir: Path,
        default_people: list | None = None,
        default_tasks: list | None = None,
    ):
        self.dir = Path(data_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()   # 可重入：commit_week 持锁后再调 ledger() 不会自我死锁
        self._default_people = list(default_people) if default_people else []
        self._default_tasks = list(default_tasks) if default_tasks else []
        self._seed()

    # ---- 基础读写
    def _path(self, name: str) -> Path:
        return self.dir / name

    def _read(self, name: str, default: Any) -> Any:
        p = self._path(name)
        if not p.exists():
            return json.loads(json.dumps(default))
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            # 文件损坏时回退默认值，但保留损坏副本便于排查
            try:
                p.rename(p.with_suffix(p.suffix + ".broken"))
            except Exception:
                pass
            return json.loads(json.dumps(default))

    def _write(self, name: str, data: Any) -> None:
        p = self._path(name)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(p)

    def _seed(self) -> None:
        with self._lock:
            if not self._path(PEOPLE_FILE).exists():
                self._write(PEOPLE_FILE, self._default_people)
            if not self._path(TASKS_FILE).exists():
                self._write(TASKS_FILE, self._default_tasks)
            if not self._path(LEDGER_FILE).exists():
                self._write(LEDGER_FILE, {"weeks": {}})

    # ---- 人员
    def people(self) -> list[dict]:
        with self._lock:
            return self._read(PEOPLE_FILE, [])

    def save_people(self, rows: list[dict]) -> None:
        with self._lock:
            self._write(PEOPLE_FILE, rows)

    # ---- 工作内容
    def tasks(self) -> list[dict]:
        with self._lock:
            return self._read(TASKS_FILE, [])

    def save_tasks(self, rows: list[dict]) -> None:
        with self._lock:
            self._write(TASKS_FILE, rows)

    # ---- 台账
    def ledger(self) -> dict:
        with self._lock:
            return self._read(LEDGER_FILE, {"weeks": {}})

    def week_record(self, week: str) -> dict:
        """返回 {person_id: [task_name, ...]}"""
        return self.ledger().get("weeks", {}).get(str(week), {})

    def commit_week(self, week: str, assign: dict[str, list[str]]) -> None:
        """把某一周的分配写入台账。"""
        with self._lock:
            data = self.ledger()
            data.setdefault("weeks", {})[str(week)] = assign
            data["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
            self._write(LEDGER_FILE, data)

    def clear_week(self, week: str) -> None:
        with self._lock:
            data = self.ledger()
            data.get("weeks", {}).pop(str(week), None)
            self._write(LEDGER_FILE, data)

    # ---- 本周完整分配网格（含校区/搭档），供小助理只读反查 / 04↔05 联动
    def save_plan(self, week: int | str, assign: dict) -> None:
        """保存某一周「完整分配网格」{task_id: {列: [pid...]}}。

        按周存储：plan.json = {weeks: {str(week): assign, ...}}，
        这样联动可以精确取「第 7 周」的网格，而不被后续提交覆盖。
        兼容旧格式 {week, assign}（迁移进 weeks）。"""
        with self._lock:
            data = self._read(PLAN_FILE, {"weeks": {}})
            if not isinstance(data, dict) or "weeks" not in data:
                # 旧格式 {week, assign} → 迁进来
                old_assign = data.get("assign") if isinstance(data, dict) else None
                old_week = data.get("week", week) if isinstance(data, dict) else week
                data = {"weeks": {str(old_week): old_assign} if old_assign is not None else {}}
            data.setdefault("weeks", {})[str(week)] = assign
            self._write(PLAN_FILE, data)

    def load_plan(self, week: int | str | None = None) -> dict | None:
        """取分配网格 {task_id: {列: [pid...]}}。

        week 指定 → 返回该周；week=None → 返回已存的最新一周。
        旧格式 {week, assign} 也兼容（直接返回 assign）。无数据返回 None。"""
        with self._lock:
            data = self._read(PLAN_FILE, None)
            if not data or not isinstance(data, dict):
                return None
            weeks = data.get("weeks")
            if isinstance(weeks, dict) and weeks:
                if week is not None:
                    return weeks.get(str(week))
                latest = max((int(w) for w in weeks.keys() if str(w).isdigit()), default=None)
                return weeks.get(str(latest)) if latest is not None else None
            # 旧格式
            if "assign" in data:
                return data.get("assign")
            return None

    def plan_weeks(self) -> list[int]:
        """已存计划的周次列表（升序），供联动校验"""
        with self._lock:
            data = self._read(PLAN_FILE, None)
            if not data or not isinstance(data, dict):
                return []
            weeks = data.get("weeks")
            if isinstance(weeks, dict):
                return sorted(int(w) for w in weeks.keys() if str(w).isdigit())
            if "assign" in data:
                return [int(data.get("week", 0))]
            return []
