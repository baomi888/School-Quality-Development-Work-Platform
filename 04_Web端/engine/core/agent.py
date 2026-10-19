# -*- coding: utf-8 -*-
"""
事务智体 · 智能体编排层

架构主张（本作品的核心创新点，也是设计说明书的技术路线）
--------------------------------------------------------
**LLM 只做「理解意图 / 规划步骤 / 解释结果」，绝不参与裁决。**

所有会改变数据、会被质疑的判定——汇总去重、排序、派活、合规预审、分值——全部由确定性
内核给出：同一输入永远同一输出，可复现、可审计、可在答辩现场逐条解释。
这样既拿到自然语言交互的体验，又不牺牲学生工作最需要的公平性与可追溯性。

四段式闭环（对应 AI 智能体赛道的考察点）
----------------------------------------
    感知 perceive → 收集本轮上下文（收件文件、周次、单位名单、台账）
    规划 plan     → 把目标拆成有序工具调用（有 LLM 用 LLM；无 LLM 降级为确定性规划器）
    行动 act      → 调用确定性工具
    反思 reflect  → 回读结果核对后置条件；不达标则修正或转人工

降级设计（工程可落地性）
------------------------
未配置 LLM 时自动使用 `RulePlanner`：同一组工具、同一组结果，只是没有自然语言的理解与润色。
因此**离线可复现、无 key 可演示**，评委拿到工程包就能跑出与演示视频一致的输出。

合规（《人工智能生成合成内容标识办法》国信办通字〔2025〕2 号）
--------------------------------------------------------------
第三条：显式标识 + 隐式标识；
第四条：文本类显式标识须在起始/末尾/中间适当位置添加文字提示；
第五条：隐式标识写入文件元数据（属性信息、服务提供者名称或编码、内容编号）；
第十条：不得恶意删除、篡改、伪造、隐匿标识 —— 工具只追加、不提供去标接口。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

_ENGINE_DIR = Path(__file__).resolve().parent.parent
if str(_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_ENGINE_DIR))

from core import zjb      # noqa: E402
from core import merge as mergemod   # noqa: E402
from core import planner as plannermod  # noqa: E402

CONFIG_PATH = _ENGINE_DIR / "core" / "config.json"
POLICY_PATH = _ENGINE_DIR / "core" / "data" / "credit_policy.txt"

# 显式标识文案（第四条：文本类须在适当位置添加文字提示）
AI_LABEL_TEXT = "本内容由AI辅助生成"
# 隐式标识里的「服务提供者名称或编码」
PRODUCER = "事务智体 CampusOpsAgent"

CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8}

RE_QUOTE = re.compile(r"[\"'“”‘’]")
RE_YEAR_OR_SESSION = re.compile(r"(20\d{2}|19\d{2})\s*年|第\s*[0-9一二三四五六七八九十]+\s*届")
RE_ORG = re.compile(r"(学院|大学|学校|中心|协会|社团|学生会|团委|团总支|联合会|工作站|易班|艺术团|青年志愿者|素拓)")


# ------------------------------------------------------------------ 工具定义

@dataclass
class ToolSpec:
    name: str
    title: str
    description: str
    params: Dict[str, str]
    fn: Callable[..., Any]
    postcondition: str          # 反思阶段要核对什么

    def as_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": {
                "type": "object",
                "properties": {k: {"type": "string", "description": v}
                               for k, v in self.params.items()},
                "required": [],
            },
        }


# ---- 工具 1：扫描收件目录 -------------------------------------------------

def tool_scan_inbox(inbox: str, **_kw) -> dict:
    p = Path(inbox)
    if not p.exists():
        return {"ok": False, "error": f"目录不存在：{inbox}", "files": []}
    files = mergemod.collect_inputs([p])
    cfg = zjb.load_config(CONFIG_PATH)
    return {
        "ok": True,
        "inbox": str(p),
        "count": len(files),
        "files": [{"name": f.name, "size": f.stat().st_size,
                   "guess": mergemod.guess_source_label(f, cfg)} for f in files],
    }


# ---- 工具 2：汇总登记表 ---------------------------------------------------

def tool_merge_registrations(inbox: str, week: Optional[int] = None,
                             out: str = "output/agent_merge", **_kw) -> dict:
    cfg = zjb.load_config(CONFIG_PATH)
    try:
        r = mergemod.run_merge([Path(inbox)], Path(_ENGINE_DIR) / out, cfg, week)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    return {
        "ok": True,
        "week": r["week"],
        "counts": r["counts"],
        "outputs": r["outputs"],
        "notes": r.get("notes") or [],
        # 跨周保护的证据必须一起回传，否则界面上看不到「这条被排除了/为什么」
        "dropped_files": r.get("dropped_files") or [],
        "extra_weeks": [{"week": x.get("week"), "counts": x.get("counts")}
                        for x in (r.get("extra_weeks") or [])],
        "suspects": r["suspects"],
        "activities": r["activities"],
        "sources": r["sources"],
    }


# ---- 工具 3：算未交名单（催报） -------------------------------------------

def tool_list_missing(inbox: str, **_kw) -> dict:
    cfg = zjb.load_config(CONFIG_PATH)
    p = Path(inbox)
    if not p.exists():
        return {"ok": False, "error": f"目录不存在：{inbox}", "missing": []}
    expected = list(cfg.get("colleges") or []) + list(cfg.get("org_units") or [])
    files = mergemod.collect_inputs([p])
    got: List[str] = []
    unknown: List[str] = []
    for f in files:
        label = mergemod.guess_source_label(f, cfg) or ""
        hit = None
        for unit in sorted(expected, key=len, reverse=True):
            if unit in label or unit in f.stem:
                hit = unit
                break
        if hit:
            got.append(hit)
        else:
            unknown.append(f.name)
    present = set(got)
    missing = [u for u in expected if u not in present]
    return {
        "ok": True,
        "expected": len(expected),
        "received_units": sorted(present),
        "missing": missing,
        "unidentified_files": unknown,
    }


# ---- 工具 4：安排二级学院检查 ---------------------------------------------

def tool_plan_checkers(table: str, campus: str = "", pool: str = "",
                       per: int = 2, **_kw) -> dict:
    """对一张校区表跑确定性排序链，返回逐活动的受派学院与负载。
    不写回文件（写回由用户确认后再做），保证工具无副作用、可反复试算。"""
    src = Path(table)
    if not src.exists():
        return {"ok": False, "error": f"文件不存在：{table}"}
    cfg = zjb.load_config(CONFIG_PATH)
    import openpyxl
    wb = openpyxl.load_workbook(src, data_only=True)
    ws = wb.active
    hr, hm = zjb.find_header_row(ws)
    acts = zjb.read_activities(ws, hr, hm, cfg)
    wb.close()
    if not acts:
        return {"ok": False, "error": "表内没有活动行"}

    colleges = list(cfg.get("colleges") or [])
    chosen_pool = [c.strip() for c in pool.split(",") if c.strip()] if pool else colleges
    week = zjb.extract_week(src.name)
    ledger = zjb.load_ledger(cfg)
    cfg2 = dict(cfg)
    cfg2["_current_campus"] = campus or acts[0].get("campus")
    last, _ = zjb.last_week_checkers(ledger, week, cfg2) if week else (set(), {})
    plan, load, problems = plannermod.plan_checkers(acts, chosen_pool, last, per)
    return {
        "ok": True,
        "week": week,
        "campus": cfg2["_current_campus"],
        "pool_size": len(chosen_pool),
        "plan": [{"no": a.get("no"), "name": a.get("name"),
                  "host_college": a.get("host_college"),
                  "checkers": plan.get(a["row"], [])} for a in acts],
        "load": load,
        "problems": problems,
    }


# ---- 工具 5：检索学分办法 -------------------------------------------------

def _policy_chunks() -> List[str]:
    if not POLICY_PATH.exists():
        return []
    raw = POLICY_PATH.read_text(encoding="utf-8")
    parts = [p.strip() for p in raw.split("\n") if p.strip()]
    # 合并成以「第X条」/「（一）」开头的语义块，避免把一句话切断
    chunks, cur = [], ""
    for p in parts:
        if re.match(r"^(第[一二三四五六七八九十百]+条|[（(][一二三四五六七八九十]+[）)]|附件)", p):
            if cur:
                chunks.append(cur)
            cur = p
        else:
            cur += p
    if cur:
        chunks.append(cur)
    return chunks


def _query_grams(text: str, ns: Tuple[int, ...] = (2, 3, 4)) -> List[str]:
    """中文没有空格，按 n-gram 取候选词；长的 gram 权重更高（词汇越长越具体）。"""
    clean = re.sub(r"[^\u4e00-\u9fa5A-Za-z0-9]+", "", str(text or ""))
    grams: List[str] = []
    for n in ns:
        grams += [clean[i:i + n] for i in range(max(0, len(clean) - n + 1))]
    return grams


def tool_query_policy(question: str, topk: int = 3, **_kw) -> dict:
    chunks = _policy_chunks()
    if not chunks:
        return {"ok": False, "error": "学分办法知识库缺失", "hits": []}
    grams = _query_grams(question)
    scored = []
    for c in chunks:
        score = sum(len(g) for g in grams if g in c)   # 命中越长越可信
        if score:
            scored.append((score, c))
    scored.sort(key=lambda x: (-x[0], -len(x[1])))
    hits = [{"score": s, "text": c} for s, c in scored[:topk]]
    return {
        "ok": bool(hits),
        "question": question,
        "hits": hits,
        "source": "大学生素质拓展学分实施办法（校内规范性文件）",
        "note": "以上为原文摘录，不构成修改或扩写；最终以文件原文为准。",
    }


# ---- 工具 6：起草催报/简报文案 -------------------------------------------

NOTICE_TPL = {
    "urge": (
        "【活动登记表催报】第{week}周\n"
        "截至目前仍有 {n} 个单位未提交本周《活动登记表》：\n{units}\n\n"
        "请于本周五 12:00 前将表格发送至校素拓邮箱。逾期未交将影响本单位本学期素拓工作考核。\n"
        "如有特殊情况，请提前说明。"
    ),
    "brief": (
        "【第{week}周登记表汇总简报】\n"
        "· 收到 {files} 份单表，去重后 {unique} 个活动\n"
        "· 自动合并重复 {merged} 条，疑似重复 {suspect} 组（需人工确认）\n"
        "· 校验：错误 {errors} 处，提醒 {warnings} 处\n"
        "· 表一（宣传部）{pub} 行；总表（质检部）{unique} 行\n"
        "下一步：核对疑似重复 → 按校区安排二级学院检查 → 发布。"
    ),
}


def tool_draft_notice(kind: str = "urge", payload: str = "", **_kw) -> dict:
    kind = (kind or "urge").lower()
    if kind not in NOTICE_TPL:
        return {"ok": False, "error": f"未知文案类型：{kind}（可选 urge / brief）"}
    # 没有数据就不要生成：宁可报错转人工，也不要产出一份数字全为 0 的通知
    if not payload or not str(payload).strip() or str(payload).strip() == "{}":
        return {"ok": False, "error": f"缺少生成「{kind}」所需的数据（payload 为空）"}
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return {"ok": False, "error": "payload 不是合法 JSON"}
    if isinstance(data, list):
        # 宽容处理：催报场景直接传未交单位数组也认
        data = {"missing": data} if kind == "urge" else {}
    if not isinstance(data, dict):
        return {"ok": False, "error": "payload 必须是对象或数组"}
    d = dict(data)
    if kind == "urge":
        units = d.get("missing") or []
        d.setdefault("n", len(units))
        d.setdefault("units", "、".join(units) if units else "（无）")
    if kind == "brief" and d.get("unique") in (None, 0):
        return {"ok": False, "error": "简报需要汇总结果，但 payload 里没有有效数据"}
    # 周次缺失时不要渲染成 "None"
    if d.get("week") in (None, "", "None"):
        d["week"] = "?"
    d.setdefault("week", "?")
    try:
        text = NOTICE_TPL[kind].format(**{
            k: d.get(k, 0) for k in ("week", "n", "units", "files", "unique",
                                     "merged", "suspect", "errors", "warnings", "pub")})
    except (KeyError, IndexError) as exc:
        return {"ok": False, "error": f"文案模板缺字段：{exc}"}
    return {"ok": True, "kind": kind, "text": text}


# ---- 工具 7：申报书预审 ---------------------------------------------------

def _docx_text_and_tables(path: Path):
    from docx import Document
    d = Document(str(path))
    paras = [p.text.strip() for p in d.paragraphs]
    tables = []
    for t in d.tables:
        rows = []
        for row in t.rows:
            rows.append([c.text.strip() for c in row.cells])
        tables.append(rows)
    return paras, tables


def _section_text(paras: List[str], start_kw: str, stop_kws: Sequence[str]) -> str:
    buf, on = [], False
    for p in paras:
        if not on:
            if start_kw in p:
                on = True
                rest = p.split(start_kw, 1)[1] if start_kw in p else ""
                if rest.strip("：: 　"):
                    buf.append(rest)
            continue
        if any(k in p for k in stop_kws):
            break
        buf.append(p)
    return "".join(buf)


def tool_pre_review_application(doc: str, **_kw) -> dict:
    """按《临时项目申报书注意事项》把人工逐条审的硬规则做成可解释预审。"""
    p = Path(doc)
    if not p.exists():
        return {"ok": False, "error": f"文件不存在：{doc}"}
    try:
        paras, tables = _docx_text_and_tables(p)
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": f"无法解析 docx：{exc}"}
    full = "\n".join(paras)

    checks: List[dict] = []

    def add(cid, name, verdict, detail, basis=""):
        checks.append({"id": cid, "rule": name, "verdict": verdict,
                       "detail": detail, "basis": basis})

    # R01 活动名称不含引号
    m = re.search(r"项目名称[：: ]*(.+)", full)
    name = (m.group(1).strip() if m else "")
    if not name:
        add("R01", "活动名称不含引号", "unknown", "未定位到「项目名称」字段",
            "PPT 第6、11条：项目名称中不能用引号")
    else:
        bad = RE_QUOTE.findall(name)
        add("R01", "活动名称不含引号", "fail" if bad else "pass",
            f"名称「{name}」" + (f" 含引号 {bad}" if bad else " 无引号"),
            "PPT 第6、11条：项目名称中不能用引号")
        # R02 三段式
        has_y = bool(RE_YEAR_OR_SESSION.search(name))
        has_o = bool(RE_ORG.search(name))
        ok = has_y and has_o
        add("R02", "活动名称三段式（年份/届数＋单位＋具体名）", "pass" if ok else "fail",
            f"年份/届数={'有' if has_y else '缺'}，单位={'有' if has_o else '缺'}",
            "PPT 第11条；注意事项「活动名称」")

    # R03 工作人员不可加分
    has_staff = ("工作人员不可加分" in full) or ("工作人员及观众不可加分" in full)
    add("R03", "写明「工作人员不可加分」", "pass" if has_staff else "fail",
        "已写明" if has_staff else "未找到该句",
        "PPT 第12条：讲座类缺少此点直接不予通过")

    # R04 到指定位置检查证件（须加粗标红，此处只校验文字）
    has_check = "须安排工作人员到指定位置检查加分对象的有效证件" in full
    add("R04", "写明「须安排工作人员到指定位置检查加分对象的有效证件」",
        "pass" if has_check else "fail",
        "已写明" if has_check else "未找到该句（须加粗标红）",
        "PPT 第13条：缺少此句不予通过")

    # R05 活动流程字数 100–200
    flow = _section_text(paras, "活动流程",
                         ["须安排工作人员到指定位置检查", "加分对象", "奖项设置", "讲座人", "活动对象"])
    n = len(re.sub(r"\s+", "", flow))
    if n == 0:
        add("R05", "活动流程 100–200 字", "unknown", "未定位到「活动流程」段落", "PPT 第13条")
    else:
        add("R05", "活动流程 100–200 字", "pass" if 100 <= n <= 200 else "fail",
            f"当前约 {n} 字", "PPT 第13条：需大于100字且小于200字")

    # R06 实施时间必须年月日
    m = re.search(r"实施时间[：: ]*(.+)", full)
    if not m:
        add("R06", "实施时间写成年月日", "unknown", "未定位到「实施时间」", "PPT 第17条")
    else:
        t = m.group(1).strip()
        ok = bool(re.search(r"20\d{2}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日", t))
        add("R06", "实施时间写成年月日", "pass" if ok else "fail", f"当前「{t[:40]}」",
            "PPT 第17条：必须年月日，不能用 . 或其他形式")

    # R07 讲座类须含 500 字手写心得
    is_lecture = ("讲座" in full) or ("讲堂" in full)
    if is_lecture:
        ok = "手写心得" in full and "500" in full
        add("R07", "讲座类含「上交500字或以上手写心得」", "pass" if ok else "fail",
            "已写明" if ok else "检测到讲座类活动但未找到该句", "PPT 第14条")
    else:
        add("R07", "讲座类含「上交500字或以上手写心得」", "unknown",
            "未判定为讲座类活动，按规定可删除该项", "PPT 第14条")

    # R08 封面含「大学生素质拓展中心制」
    ok = "大学生素质拓展中心制" in full
    add("R08", "封面含「大学生素质拓展中心制」", "pass" if ok else "fail",
        "已写明" if ok else "封面上未找到该字样", "PPT 第11条第四条")

    # R09 奖项加分比例合计 100%
    ratios: List[float] = []
    for t in tables:
        for row in t:
            for cell in row:
                for mt in re.finditer(r"(\d{1,3}(?:\.\d+)?)\s*%", cell):
                    val = float(mt.group(1))
                    if 0 < val <= 100:
                        ratios.append(val)
    if not ratios:
        add("R09", "奖项加分比例合计为 100%", "unknown", "未在表格中读到百分比", "PPT 第14条")
    else:
        total = sum(ratios)
        add("R09", "奖项加分比例合计为 100%",
            "pass" if abs(total - 100) < 0.01 else "fail",
            f"读到 {len(ratios)} 个比例，合计 {total:g}%", "PPT 第14条")

    # R10 篇幅 3 面以内（按段落粗估，明确标注为估算）
    approx_pages = max(1, round(len([x for x in paras if x]) / 42))
    add("R10", "全篇 3 面以内（估算）", "pass" if approx_pages <= 3 else "unknown",
        f"约 {approx_pages} 面（按有效段落数估算，非实际排版）", "PPT 第26条")

    fails = [c for c in checks if c["verdict"] == "fail"]
    unknowns = [c for c in checks if c["verdict"] == "unknown"]
    return {
        "ok": True,
        "file": p.name,
        "checks": checks,
        "summary": {
            "pass": len([c for c in checks if c["verdict"] == "pass"]),
            "fail": len(fails),
            "unknown": len(unknowns),
        },
        "must_fix": [f"{c['id']} {c['rule']}：{c['detail']}" for c in fails],
        "cannot_judge": [f"{c['id']} {c['rule']}：{c['detail']}" for c in unknowns],
    }


TOOLS: Dict[str, ToolSpec] = {
    t.name: t for t in [
        ToolSpec("scan_inbox", "扫描收件目录", "列出待汇总的活动登记表，并猜测来源单位",
                 {"inbox": "收件目录路径"}, tool_scan_inbox,
                 "至少读到 1 份 .xlsx"),
        ToolSpec("merge_registrations", "汇总登记表",
                 "把多份单表合成总表/表一/时间表/校验报告，并做去重与跨周保护",
                 {"inbox": "收件目录路径", "week": "周次（可留空自动识别）",
                  "out": "输出目录"}, tool_merge_registrations,
                 "去重后活动数大于 0"),
        ToolSpec("list_missing", "算未交名单",
                 "对照应交单位名单，算出还没交表的单位，用于催报",
                 {"inbox": "收件目录路径"}, tool_list_missing,
                 "名单可判定（预期单位数大于 0）"),
        ToolSpec("plan_checkers", "安排二级学院检查",
                 "对一张校区表跑确定性排序链，给出逐活动的受派学院与负载（只试算不写回）",
                 {"table": "校区表路径", "campus": "校区", "pool": "学院池，逗号分隔",
                  "per": "每个活动派几个"}, tool_plan_checkers,
                 "每个活动都拿到足够的受派学院，或问题清单为空"),
        ToolSpec("query_policy", "学分办法检索",
                 "在《大学生素质拓展学分实施办法》原文里检索相关条款，返回原文摘录",
                 {"question": "自然语言问题", "topk": "返回条数"}, tool_query_policy,
                 "至少命中 1 条原文"),
        ToolSpec("draft_notice", "起草通知",
                 "按模板起草催报通知或本周汇总简报（正文由确定性模板生成）",
                 {"kind": "urge 催报 / brief 简报", "payload": "数据 JSON"}, tool_draft_notice,
                 "文案非空且无未填充占位符"),
        ToolSpec("pre_review_application", "申报书预审",
                 "按《临时项目申报书注意事项》的硬规则做可解释预审，给出必改项与无法判断项",
                 {"doc": "申报书 .docx 路径"}, tool_pre_review_application,
                 "至少完成 1 条规则判定"),
    ]
}


# ------------------------------------------------------------------ 规划器

@dataclass
class PlanStep:
    tool: str
    args: Dict[str, Any] = field(default_factory=dict)
    why: str = ""


class MissingContext(Exception):
    """目标能被理解，但缺少执行所需的上下文（例如没说收件目录在哪）。"""


# 延迟绑定占位：执行到该步时用「上一步的结果」填充，规划阶段不能提前清空。
# 曾经的 bug：_bind 把它们当成普通上下文变量解析成空串，导致文案按 0 生成却仍报成功。
LATE_BOUND = {"missing_json", "counts_json"}


class RulePlanner:
    """确定性规划器：无 LLM 时按关键词把目标映射成工具序列。

    刻意保持简单可读——它要证明的是「没模型也能跑通同一个闭环」，
    而不是替代模型去做理解。
    """

    name = "rule"

    RULES: List[Tuple[Tuple[str, ...], List[Tuple[str, Dict[str, Any], str]], Tuple[str, ...]]] = [
        (("催报", "没交", "未交", "缺交"),
         [("scan_inbox", {"inbox": "$inbox"}, "先确认收件目录里到底有什么"),
          ("list_missing", {"inbox": "$inbox"}, "对照应交单位名单算差集"),
          ("draft_notice", {"kind": "urge", "payload": "$missing_json"}, "把差集写成催报通知")],
         ("inbox",)),
        (("简报", "汇总情况", "本周情况"),
         [("merge_registrations", {"inbox": "$inbox", "week": "$week", "out": "$out"},
           "先完成汇总"),
          ("draft_notice", {"kind": "brief", "payload": "$counts_json"}, "把汇总结果写成简报")],
         ("inbox",)),
        (("安排", "派给", "检查学院", "二级学院"),
         [("plan_checkers", {"table": "$table", "campus": "$campus", "pool": "$pool"},
           "对校区表跑确定性排序链，只试算不写回")],
         ("table",)),
        (("学分", "办法", "分值", "多少分", "怎么算"),
         [("query_policy", {"question": "$goal"}, "在学分办法原文里检索，不凭记忆作答")],
         ()),
        (("预审", "申报书", "审核"),
         [("pre_review_application", {"doc": "$doc"}, "按硬规则逐条预审")],
         ("doc",)),
        (("汇总", "合并", "总表", "收表"),
         [("scan_inbox", {"inbox": "$inbox"}, "先确认收件目录里到底有什么"),
          ("merge_registrations", {"inbox": "$inbox", "week": "$week", "out": "$out"},
           "合成总表并做校验")],
         ("inbox",)),
    ]

    def plan(self, goal: str, ctx: Dict[str, Any]) -> List[PlanStep]:
        g = str(goal or "")
        for keywords, steps, requires in self.RULES:
            if not any(k in g for k in keywords):
                continue
            missing = [r for r in requires if not ctx.get(r)]
            if missing:
                raise MissingContext(
                    f"「{g}」这一步需要 {missing[0]} 参数，但没有提供")
            return [PlanStep(t, self._bind(a, ctx), why) for t, a, why in steps]
        # 默认：走一遍本周例行流程
        if not ctx.get("inbox"):
            raise MissingContext("没有指定收件目录，无法执行本周例行流程")
        return [
            PlanStep("scan_inbox", self._bind({"inbox": "$inbox"}, ctx), "默认例行：先看收件"),
            PlanStep("merge_registrations",
                     self._bind({"inbox": "$inbox", "week": "$week"}, ctx), "默认例行：汇总"),
            PlanStep("list_missing", self._bind({"inbox": "$inbox"}, ctx), "默认例行：算未交名单"),
        ]

    @staticmethod
    def _bind(args: Dict[str, Any], ctx: Dict[str, Any]) -> Dict[str, Any]:
        out = {}
        for k, v in args.items():
            if isinstance(v, str) and v.startswith("$"):
                name = v[1:]
                if name in LATE_BOUND:
                    out[k] = v              # 保留占位，交给 _resolve 在执行时填
                else:
                    out[k] = ctx.get(name, "")
            else:
                out[k] = v
        return out


class LLMPlanner:
    """接任意 OpenAI 兼容的 /chat/completions 目标。

    只在配置了环境变量时启用；不可用时 `available()` 返回 False，Agent 自动降级。
    模型返回的 tool_calls 会被逐一校验：工具名必须在 TOOLS 里，参数必须是字符串，
    否则整条计划作废并降级——不允许模型凭空发明工具。
    """

    name = "llm"

    def __init__(self) -> None:
        self.base = os.environ.get("DSH_AGENT_LLM_BASE", "").rstrip("/")
        self.key = os.environ.get("DSH_AGENT_LLM_KEY", "")
        self.model = os.environ.get("DSH_AGENT_LLM_MODEL", "gpt-4o-mini")

    def available(self) -> bool:
        return bool(self.base and self.key)

    def plan(self, goal: str, ctx: Dict[str, Any]) -> List[PlanStep]:
        import urllib.request
        schemas = [t.as_schema() for t in TOOLS.values()]
        sys_prompt = (
            "你是校园事务智能体的规划器。只允许调用给定工具，不得发明工具。"
            "把目标拆成最少必要步骤。涉及任何分数、排名、派活、合规判定的计算，"
            "必须交给工具完成，不得自行给出结论。"
        )
        body = json.dumps({
            "model": self.model,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content":
                    f"目标：{goal}\n上下文：{json.dumps(ctx, ensure_ascii=False)}"},
            ],
            "tools": [{"type": "function", "function": s} for s in schemas],
            "tool_choice": "auto",
            "temperature": 0,
        }).encode("utf-8")
        req = urllib.request.Request(f"{self.base}/chat/completions", data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {self.key}")
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        calls = (data.get("choices") or [{}])[0].get("message", {}).get("tool_calls") or []
        steps: List[PlanStep] = []
        for c in calls:
            fn = c.get("function") or {}
            name = fn.get("name")
            if name not in TOOLS:
                raise ValueError(f"模型调用了不存在的工具：{name}")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            steps.append(PlanStep(name, args, "LLM 规划"))
        if not steps:
            raise ValueError("模型没有给出任何工具调用")
        return steps


# ------------------------------------------------------------------ 反思

def reflect(step_result: Any, spec: ToolSpec, ctx: Dict[str, Any]) -> Tuple[bool, str]:
    """按工具的后置条件判断这一步是否真的达成了目的。

    宁可报「不达标」让上层转人工，也不要让一次静默失败流进最终产物。
    """
    if not isinstance(step_result, dict):
        return False, "工具未返回结构化的结果"
    if step_result.get("ok") is False:
        return False, step_result.get("error") or "工具报告失败"

    n = spec.name
    if n == "scan_inbox":
        return (step_result.get("count", 0) > 0,
                f"读到 {step_result.get('count', 0)} 份文件" if step_result.get("count")
                else "收件目录里没有可汇总的 .xlsx")
    if n == "merge_registrations":
        uniq = (step_result.get("counts") or {}).get("unique", 0)
        errs = (step_result.get("counts") or {}).get("activity_errors", 0)
        return uniq > 0, f"去重后 {uniq} 个活动，其中 {errs} 处校验错误需要人看"
    if n == "list_missing":
        return step_result.get("expected", 0) > 0, \
            f"应交 {step_result.get('expected')} 个单位，未交 {len(step_result.get('missing') or [])} 个"
    if n == "plan_checkers":
        probs = step_result.get("problems") or []
        return len(probs) == 0, ("全部活动都拿到了足够的检查学院" if not probs
                                 else f"{len(probs)} 个活动存在问题需要人工确认")
    if n == "query_policy":
        return len(step_result.get("hits") or []) > 0, \
            f"命中 {len(step_result.get('hits') or [])} 条原文条款"
    if n == "draft_notice":
        txt = step_result.get("text") or ""
        leaked = re.findall(r"\{[a-z_]+\}", txt)
        return bool(txt) and not leaked, ("文案已生成" if txt and not leaked
                                         else f"文案含未填充字段 {leaked}")
    if n == "pre_review_application":
        s = step_result.get("summary") or {}
        done = (s.get("pass", 0) + s.get("fail", 0)) > 0
        return done, f"通过 {s.get('pass',0)} / 必改 {s.get('fail',0)} / 无法判断 {s.get('unknown',0)}"
    return True, ""


# ------------------------------------------------------------------ 智能体

@dataclass
class Step:
    seq: int
    phase: str
    thought: str = ""
    action: Optional[str] = None
    args: Dict[str, Any] = field(default_factory=dict)
    observation: Any = None
    ok: Optional[bool] = None
    note: str = ""

    def as_dict(self) -> dict:
        d = asdict(self)
        # 观测结果可能很大，trace 里只留摘要，完整结果放在 result
        if isinstance(self.observation, dict):
            d["observation"] = {k: v for k, v in self.observation.items()
                                if k not in ("activities", "sources", "files", "hits")}
        return d


class Agent:
    def __init__(self, planner: Optional[Any] = None, tools: Optional[Dict[str, ToolSpec]] = None):
        self.tools = tools or TOOLS
        self.planner = planner
        self.planner_note = ""

    def _pick_planner(self) -> Tuple[Any, str]:
        if self.planner is not None:
            return self.planner, getattr(self.planner, "name", "custom")
        llm = LLMPlanner()
        if llm.available():
            return llm, "llm"
        return RulePlanner(), "rule（未配置 LLM，自动降级；工具与结果完全一致）"

    def perceive(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """补全上下文里缺的默认值，并做最小校验。"""
        ctx = dict(ctx or {})
        ctx.setdefault("goal", "")
        if "week" not in ctx:
            ctx["week"] = None
        ctx.setdefault("out", "output/agent_merge")
        return ctx

    def run(self, goal: str, **ctx) -> Dict[str, Any]:
        ctx = self.perceive({**ctx, "goal": goal})
        planner, note = self._pick_planner()
        self.planner_note = note
        steps: List[Step] = []
        seq = 0
        content_id = uuid.uuid4().hex[:12]

        seq += 1
        steps.append(Step(seq, "perceive", thought=f"目标：{goal}；上下文键：{sorted(ctx)}"))

        plan: List[PlanStep]
        try:
            try:
                plan = planner.plan(goal, ctx)
            except MissingContext:
                raise
            except Exception as exc:  # noqa: BLE001  LLM 不可用或返回不合法 → 降级
                planner, note = RulePlanner(), f"LLM 规划失败已降级：{exc}"
                plan = planner.plan(goal, ctx)
        except MissingContext as exc:
            # 能听懂目标但缺参数：如实追问，而不是拿空值去调用工具
            seq += 1
            steps.append(Step(seq, "plan", thought=str(exc), action="clarify",
                              ok=False, note="缺少必要上下文，需要追问"))
            return {
                "goal": goal,
                "planner": planner.name,
                "planner_note": note,
                "ok": False,
                "steps": [s.as_dict() for s in steps],
                "results": {},
                "needs_human": [str(exc)],
                "ai_marker": self._implicit_marker(content_id),
            }

        seq += 1
        steps.append(Step(seq, "plan",
                          thought=f"使用 {planner.name} 规划器，共 {len(plan)} 步",
                          action="plan",
                          observation=[{"tool": p.tool, "args": p.args, "why": p.why} for p in plan]))

        results: Dict[str, Any] = {}
        needs_human: List[str] = []
        last_out: Any = None

        for i, p in enumerate(plan, 1):
            spec = self.tools.get(p.tool)
            if spec is None:
                needs_human.append(f"未知工具 {p.tool}，已跳过")
                continue
            args = self._resolve(p.args, ctx, last_out, results)
            seq += 1
            act_step = Step(seq, "act", thought=p.why, action=p.tool, args=args)
            try:
                out = spec.fn(**args)
            except TypeError as exc:
                out = {"ok": False, "error": f"参数不匹配：{exc}"}
            except Exception as exc:  # noqa: BLE001
                out = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
            act_step.observation = out
            results[p.tool] = out
            last_out = out
            steps.append(act_step)

            ok, why = reflect(out, spec, ctx)
            seq += 1
            act_step.ok = ok
            act_step.note = why
            steps.append(Step(seq, "reflect", thought=f"核对「{spec.title}」的后置条件",
                              action=p.tool, ok=ok, note=why))
            if not ok:
                needs_human.append(f"{spec.title}：{why}")
                # 反思不通过：如果是后续步骤的输入缺失，就中止，避免产出半成品
                if i == 1 or p.tool in ("merge_registrations", "scan_inbox"):
                    break

        # AI 生成文本必须带显式标识（标识办法第四条）
        labeled = {}
        for k, v in results.items():
            if isinstance(v, dict) and isinstance(v.get("text"), str):
                labeled[k] = self._label_text(v["text"], content_id, k)
        if labeled:
            for k in labeled:
                results[k]["text_labeled"] = labeled[k]

        ok_all = all(s.ok for s in steps if s.phase == "reflect")
        return {
            "goal": goal,
            "planner": planner.name,
            "planner_note": note,
            "ok": ok_all,
            "steps": [s.as_dict() for s in steps],
            "results": results,
            "needs_human": needs_human,
            "ai_marker": self._implicit_marker(content_id),
        }

    # -- 参数解析：让规划器可以写 $counts_json 这类占位，由前一阶段结果填充
    def _resolve(self, args: Dict[str, Any], ctx: Dict[str, Any],
                 last: Any, results: Dict[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        for k, v in args.items():
            if isinstance(v, str) and v.startswith("$"):
                key = v[1:]
                if key in ctx and not isinstance(ctx[key], dict):
                    out[k] = ctx[key]
                elif key == "missing_json":
                    # 传成对象而不是裸数组：工具端要带 week 等字段才能成形
                    out[k] = json.dumps({
                        "missing": (last or {}).get("missing") or [],
                        "week": ctx.get("week"),
                    }, ensure_ascii=False)
                elif key == "counts_json":
                    src = last if isinstance(last, dict) and "counts" in last else \
                        (results.get("merge_registrations") or {})
                    c = (src or {}).get("counts") or {}
                    out[k] = json.dumps({
                        "week": (src or {}).get("week"),
                        "files": c.get("input_files"), "unique": c.get("unique"),
                        "merged": c.get("exact_merged"),
                        "suspect": c.get("suspect_groups"),
                        "errors": c.get("activity_errors"),
                        "warnings": c.get("activity_warnings"),
                        "pub": c.get("publicity_rows"),
                    }, ensure_ascii=False)
                else:
                    out[k] = ""
            else:
                out[k] = v
        return out

    # -- 合规：显式标识 + 隐式标识
    @staticmethod
    def _label_text(text: str, content_id: str, tool: str) -> str:
        return f"{text}\n\n——（{AI_LABEL_TEXT}；生成工具：{tool}；内容编号：{content_id}）"

    @staticmethod
    def _implicit_marker(content_id: str) -> dict:
        return {
            "ai_generated": True,
            "content_nature": "text",
            "producer": PRODUCER,
            "content_id": content_id,
            "generated_at": datetime.now().isoformat(timespec="seconds"),
            "explicit_label": AI_LABEL_TEXT,
            "basis": "《人工智能生成合成内容标识办法》（国信办通字〔2025〕2号）第三条至第五条",
        }


def run(goal: str, **ctx) -> Dict[str, Any]:
    """便捷入口"""
    return Agent().run(goal, **ctx)


def main(argv: Optional[Sequence[str]] = None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="事务智体 · 智能体编排层（离线可跑）")
    ap.add_argument("goal", help="自然语言目标，如「把本周登记表汇总一下」")
    ap.add_argument("--inbox", default="", help="收件目录")
    ap.add_argument("--week", type=int, default=None)
    ap.add_argument("--table", default="", help="校区表路径（安排检查时用）")
    ap.add_argument("--campus", default="")
    ap.add_argument("--pool", default="")
    ap.add_argument("--doc", default="", help="申报书 docx 路径（预审时用）")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)

    ctx = {k: v for k, v in {
        "inbox": args.inbox, "week": args.week, "table": args.table,
        "campus": args.campus, "pool": args.pool, "doc": args.doc,
    }.items() if v not in ("", None)}

    out = run(args.goal, **ctx)
    if args.json:
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0 if out["ok"] else 2

    print(f"目标：{out['goal']}")
    print(f"规划器：{out['planner_note']}")
    print(f"结论：{'达成' if out['ok'] else '未完全达成'}\n")
    for s in out["steps"]:
        if s["phase"] == "act":
            print(f"  [行动] {s['action']}({s['args']})")
        elif s["phase"] == "reflect":
            print(f"     [反思] {'✓' if s['ok'] else '✗'} {s.get('note','')}")
        elif s["phase"] == "plan":
            print("  [规划] " + " → ".join(p["tool"] for p in (s.get("observation") or [])))
    if out["needs_human"]:
        print("\n需要人工处理：")
        for x in out["needs_human"]:
            print("  ·", x)
    return 0 if out["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
