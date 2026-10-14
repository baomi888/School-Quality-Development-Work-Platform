# -*- coding: utf-8 -*-
"""
活动登记表汇总 · 规划部「多份单表 → 一张总表」

背景
----
各二级学院/机构每周五 12:00 前把各自的《每周活动登记表》交到校素拓邮箱；
规划部过去要逐个学院下载、逐个核对、再手工把十几张表拼成一张总表。
本模块只替代「拼表」这一步，不改动学校既定流程。

输入
----
N 份单表（.xlsx）。来源既可能是「一个校区一个文件」，也可能是「一个学院一个文件」，
文件名与内容两种线索都用于判定来源，不做文件名假设。

输出
----
1) 总表（表二 · 质检部）      —— 标准 15 列，编号重排
2) 表一（宣传部）             —— 剔除「活动对象」为协会会员的活动
3) 时间表                     —— 按活动时段展开，供安排检查/排期
4) 汇总校验报告               —— 校验问题 / 来源追踪 / 疑似重复

规则来源
--------
《每周活动登记表注意事项.docx》与《校素拓规划部第一次助理培训.pptx》里的成文要求，
全部落成可解释的校验项（见 RULES），不做「黑箱判断」。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from copy import copy
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import openpyxl
from openpyxl.styles import Alignment, Border, Color, Font, Side
from openpyxl.utils import get_column_letter

_ENGINE_DIR = Path(__file__).resolve().parent.parent
if str(_ENGINE_DIR) not in sys.path:
    sys.path.insert(0, str(_ENGINE_DIR))

from core import zjb  # noqa: E402

# ------------------------------------------------------------------ 常量

# 标准 15 列（顺序即输出顺序）
STD_COLUMNS: List[Tuple[str, str]] = [
    ("no", "活动编号"),
    ("name", "活动名称"),
    ("level", "活动级别"),
    ("host", "主办单位"),
    ("time", "开展时间"),
    ("place", "地点"),
    ("contact", "负责人"),
    ("phone", "长号&短号"),
    ("type", "活动类型"),
    ("category", "项目类别"),
    ("target", "活动对象"),
    ("way", "参与方式"),
    ("remark", "备注"),
    ("campus", "校区"),
    ("score", "加分分值"),
]

# 表头别名补充：官方模板用「参与方式」，各学院实际交上来常用「参加方式」
EXTRA_HEADER_ALIASES: Dict[str, List[str]] = {
    "way": ["参与方式", "参加方式", "参与形式", "参加形式"],
    "level": ["活动级别", "级别", "活动等级"],
    "category": ["项目类别", "活动类别", "项目类型"],
    "type": ["活动类型", "活动性质"],
    "phone": ["长号&短号", "长号＆短号", "联系方式", "联系电话", "长号/短号", "电话"],
    "remark": ["备注", "备 注", "说明"],
    "score": ["加分分值", "分值", "参考学分", "加分"],
    "target": ["活动对象", "活动对象范围", "对象"],
}

WEEKDAY_ORDER = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "日": 7, "天": 7}
WEEKDAY_LABEL = {1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日"}

VALID_LEVELS = {"市级", "校级", "院级", "跨市级", "省级", "跨省级", "国家级"}
LEVEL_ALIASES = {"院（系）级": "院级", "院(系)级": "院级", "系级": "院级", "院系级": "院级"}
VALID_CATEGORIES = {"学术科技与专业技能", "文化艺术与体育竞技", "社会实践与志愿服务"}
VALID_TYPES = {"临时", "常规"}
VALID_CAMPUSES = {"西城", "官渡", "光华"}

# 全角 → 半角（不含顿号「、」：注意事项明确要求用顿号分隔并列项）
FULLWIDTH_MAP = {
    "，": ",", "。": ".", "；": ";", "：": ":", "！": "!", "？": "?",
    "（": "(", "）": ")", "【": "[", "】": "]", "《": "<", "》": ">",
    "“": '"', "”": '"', "‘": "'", "’": "'",
    "～": "~", "－": "-", "％": "%", "＋": "+", "＝": "=", "　": " ",
}
FULLWIDTH_PUNCT = set(FULLWIDTH_MAP) - {"　"}

RE_ANCHOR = re.compile(
    r"(?:第\s*(?P<w>\d{1,2}|[一二三四五六七八九十]{1,3})\s*周)?\s*周\s*(?P<d>[一二三四五六日天])"
)
RE_WEEKONLY = re.compile(r"第\s*(?P<w>\d{1,2}|[一二三四五六七八九十]{1,3})\s*周(?!\s*[一二三四五六日天])")
RE_HHMM = re.compile(r"(?<!\d)(\d{1,2})\s*[:：]\s*(\d{2})(?!\d)")
RE_QUOTES = re.compile(r"[\"'“”‘’]")
RE_YEAR = re.compile(r"(20\d{2}|19\d{2})\s*年")
RE_SESSION = re.compile(r"第\s*[0-9一二三四五六七八九十]+\s*届")
RE_ORG_HINT = re.compile(
    r"(学院|大学|学校|中心|协会|社团|学生会|团委|团总支|联合会|工作站|易班|艺术团|青年志愿者|"
    r"自律会|红十字会|广播台|记者团|全媒体|青媒|素拓)"
)
RE_PHONE = re.compile(r"1[3-9]\d{9}")
RE_URL = re.compile(r"(https?://|www\.|@[A-Za-z0-9._%-]+\.[A-Za-z]{2,})")
RE_DEPT_TAIL = re.compile(r"(部|部门|处|科|办公室)\s*$")

REPORT_SHEETS = ("校验问题", "来源追踪", "疑似重复")

# 列宽标定：直接采用规划部实际在用的《第4周活动登记表(总表).xlsx》列宽。
# 注意宋体 9 号的中文是双宽，按「字符数」估宽会明显偏窄，导致长活动名折行后被 21 磅行高裁掉。
COL_WIDTHS = {
    "no": 8.67, "name": 52.21, "level": 8.67, "host": 35.15, "time": 29.29,
    "place": 25.66, "contact": 6.87, "phone": 18.15, "type": 8.67,
    "category": 20.0, "target": 12.27, "way": 11.46, "remark": 23.73,
    "campus": 8.87, "score": 12.06,
}

# 时间表列宽（沿用同一套标定，仅时段/周几为时间表专有列）
TIMETABLE_WIDTHS = {
    "no": 8.67, "name": 52.21, "campus": 8.87, "step": 7.0, "weekday": 8.0,
    "clock": 26.0, "days": 9.0, "place": 25.66, "contact": 8.0,
    "phone": 18.15, "target": 14.0,
}


# ------------------------------------------------------------------ 数据结构

@dataclass
class Issue:
    code: str
    level: str          # error / warning
    field: str
    message: str
    advice: str = ""

    def as_dict(self) -> Dict[str, str]:
        return {
            "code": self.code, "level": self.level, "field": self.field,
            "message": self.message, "advice": self.advice,
        }


@dataclass
class Slot:
    """一个活动时段。第几周/周几/时刻都可能缺省。"""
    week_start: Optional[int] = None
    day_start: Optional[int] = None
    time_start: Optional[int] = None      # 距 00:00 的分钟数
    week_end: Optional[int] = None
    day_end: Optional[int] = None
    time_end: Optional[int] = None
    span: bool = False                    # 是否跨天/跨周

    @property
    def duration_days(self) -> int:
        if self.day_start is None:
            return 1
        if self.day_end is None:
            return 1
        if self.week_start is not None and self.week_end is not None:
            d = (self.week_end - self.week_start) * 7 + (self.day_end - self.day_start) + 1
        else:
            d = self.day_end - self.day_start + 1
            if d <= 0:
                d += 7
        return max(d, 1)

    def label(self) -> str:
        def wk(w):
            return f"第{w}周" if w else ""

        def hm(m):
            return "" if m is None else f"{m // 60:02d}:{m % 60:02d}"

        def point(week, day, minute):
            s = f"{wk(week)}{WEEKDAY_LABEL.get(day or 0, '')}"
            if minute is not None:
                s += hm(minute)
            return s

        start = point(self.week_start, self.day_start, self.time_start)
        if not self.span:
            if self.time_start is not None and self.time_end is not None:
                return f"{start}-{hm(self.time_end)}"
            return start
        return f"{start}-{point(self.week_end, self.day_end, self.time_end)}"


@dataclass
class Record:
    """一条（已归一化的）活动记录 + 溯源信息。"""
    cells: Dict[str, str] = field(default_factory=dict)
    slots: List[Slot] = field(default_factory=list)
    sources: List[Dict[str, Any]] = field(default_factory=list)
    issues: List[Issue] = field(default_factory=list)
    primary_source: str = ""
    primary_row: int = 0

    # ---- 便捷读取
    def get(self, key: str) -> str:
        return self.cells.get(key, "")

    @property
    def name(self) -> str:
        return self.get("name")

    @property
    def campus(self) -> str:
        return self.get("campus")

    @property
    def score(self) -> str:
        return self.get("score")

    # ---- 排序
    @property
    def duration_days(self) -> int:
        return max((s.duration_days for s in self.slots), default=1)

    @property
    def start_weekday(self) -> int:
        for s in self.slots:
            if s.day_start:
                return s.day_start
        return 7

    @property
    def start_minutes(self) -> int:
        for s in self.slots:
            if s.time_start is not None:
                return s.time_start
        return 24 * 60

    def sort_key(self) -> Tuple:
        """《注意事项》：持续时间长的先排 → 单日按周一~周日 → 同日按时间早晚"""
        return (-self.duration_days, self.start_weekday, self.start_minutes,
                _fp_text(self.name), self.campus)

    def fingerprint(self) -> str:
        """精确重复指纹：名称 + 时间 + 地点"""
        return "|".join(_fp_text(self.get(k)) for k in ("name", "time", "place"))

    def name_fingerprint(self) -> str:
        """疑似重复指纹：仅名称"""
        return _fp_text(self.name)

    def completeness(self) -> int:
        return sum(1 for k, _ in STD_COLUMNS if self.get(k))

    def blank_fields(self) -> List[str]:
        required = ("name", "level", "host", "time", "place", "contact", "phone",
                    "type", "category", "target", "way", "campus", "score")
        return [label for key, label in STD_COLUMNS if key in required and not self.get(key)]


def _fp_text(v: Any) -> str:
    return re.sub(r"[\s　]+", "", str(v or "")).lower()


# ------------------------------------------------------------------ 文本清洗

def _s(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"[\s\u3000]+", " ", str(v)).strip()


def normalize_punct(text: str, keep_enumeration_comma: bool = True) -> str:
    """全角标点 → 半角。顿号默认保留（注意事项要求用顿号分隔并列项）。"""
    out = []
    for ch in text:
        if keep_enumeration_comma and ch == "、":
            out.append(ch)
            continue
        out.append(FULLWIDTH_MAP.get(ch, ch))
    return "".join(out)


def find_fullwidth_punct(text: str) -> List[str]:
    seen, out = set(), []
    for ch in text:
        if ch in FULLWIDTH_PUNCT and ch not in seen:
            seen.add(ch)
            out.append(ch)
    return out


def est_width_px(text: str, pt: float = 9.0) -> float:
    """粗估文本在给定字号下的像素宽。

    宋体 9 号的中文/全角字符约占 12px（= 9pt × 4/3），ASCII 约 0.55 倍。
    这是排版估算，不是渲染结果；用途是提前发现「会折行、又被 21 磅固定行高裁掉」的格子。
    """
    px = 0.0
    for ch in text:
        unit = pt * (4.0 / 3.0)
        px += unit if ord(ch) > 0x2E80 else unit * 0.55
    return px


def col_px(width_units: float) -> float:
    """Excel 列宽单位 → 像素（默认字体 11pt Calibri 的 '0' 宽约 7px）"""
    return width_units * 7.0


# ------------------------------------------------------------------ 时间解析

def _mk_minutes(h: str, m: str) -> Optional[int]:
    hh, mm = int(h), int(m)
    if hh > 24 or mm > 59:
        return None
    return hh * 60 + mm


def parse_time_spec(text: str) -> Tuple[List[Slot], bool]:
    """把「开展时间」文本解析成时段列表。返回 (slots, 是否解析成功)。

    覆盖学校表格里实际出现的形态：
      周日08:00-12:00 14:30-17:30      → 同一天两个时段
      周一09:00-周三00:00             → 跨天
      第三周周三-第五周周三            → 跨周，无具体时刻
      周三19:30-20:30                 → 同一天一个时段
    """
    raw = _s(text)
    if not raw:
        return [], False

    # 1) 锚点（周X / 第Y周周X）与孤立「第Y周」
    anchors: List[Tuple[int, int, Optional[int]]] = []  # (pos, day, week)
    for m in RE_ANCHOR.finditer(raw):
        wk = zjb.cn_num(m.group("w")) if m.group("w") else None
        day = WEEKDAY_ORDER.get(m.group("d"))
        if day:
            anchors.append((m.start(), day, wk))
    for m in RE_WEEKONLY.finditer(raw):
        if any(abs(m.start() - a[0]) <= 0 for a in anchors):
            continue
        wk = zjb.cn_num(m.group("w"))
        anchors.append((m.start(), None, wk))  # type: ignore[arg-type]
    anchors.sort(key=lambda x: x[0])

    times = [(m.start(), _mk_minutes(m.group(1), m.group(2))) for m in RE_HHMM.finditer(raw)]
    times = [(p, v) for p, v in times if v is not None]

    # 2) 无锚点但有两点时刻：如「09:00-11:00」
    if not anchors:
        if len(times) >= 2:
            slots = []
            for i in range(0, len(times) - 1, 2):
                slots.append(Slot(time_start=times[i][1], time_end=times[i + 1][1]))
            return slots, True
        return [], False

    # 3) 切段：每个锚点一段，段内收集时刻
    segments: List[Dict[str, Any]] = []
    for i, (pos, day, wk) in enumerate(anchors):
        end = anchors[i + 1][0] if i + 1 < len(anchors) else len(raw)
        seg_times = [v for p, v in times if pos <= p < end]
        segments.append({"day": day, "week": wk, "times": seg_times})

    # 4) 每段恰好一个时刻 且 段数 >= 2 → 串成跨天/跨周时段
    if len(segments) >= 2 and all(len(s["times"]) == 1 for s in segments):
        return [Slot(
            week_start=segments[0]["week"], day_start=segments[0]["day"],
            time_start=segments[0]["times"][0],
            week_end=segments[-1]["week"], day_end=segments[-1]["day"],
            time_end=segments[-1]["times"][0], span=True,
        )], True

    # 5) 段内两两配对 → 同一天多个时段
    slots: List[Slot] = []
    for s in segments:
        ts = s["times"]
        if len(ts) >= 2:
            for i in range(0, len(ts) - 1, 2):
                slots.append(Slot(week_start=s["week"], day_start=s["day"],
                                  time_start=ts[i], time_end=ts[i + 1]))
        elif len(ts) == 1:
            slots.append(Slot(week_start=s["week"], day_start=s["day"], time_start=ts[0]))
        else:
            slots.append(Slot(week_start=s["week"], day_start=s["day"]))
    # 只有一个段却解析出跨天（如「周三-周五」）时合并
    if len(slots) == 2 and all(s.time_start is None for s in slots) \
            and slots[0].day_start and slots[1].day_start:
        return [Slot(week_start=slots[0].week_start, day_start=slots[0].day_start,
                     week_end=slots[1].week_start, day_end=slots[1].day_start, span=True)], True
    return slots, bool(slots)


# ------------------------------------------------------------------ 读取单表

def _header_aliases() -> Dict[str, List[str]]:
    merged: Dict[str, List[str]] = {}
    for key, aliases in zjb.HEADER_KEYS.items():
        merged[key] = list(aliases) + list(EXTRA_HEADER_ALIASES.get(key, []))
    for key, aliases in EXTRA_HEADER_ALIASES.items():
        merged.setdefault(key, [])
        for a in aliases:
            if a not in merged[key]:
                merged[key].append(a)
    return merged


def find_header(ws) -> Tuple[Optional[int], Dict[str, int], Dict[int, str]]:
    """在任意工作表里定位表头行；返回 (行号, {标准键: 列}, {列: 原始表头})"""
    aliases = _header_aliases()
    limit = min(ws.max_row, 10)
    for r in range(1, limit + 1):
        mapping: Dict[str, int] = {}
        raw: Dict[int, str] = {}
        for c in range(1, min(ws.max_column, 60) + 1):
            v = ws.cell(row=r, column=c).value
            if v is None:
                continue
            s = _s(v)
            if not s:
                continue
            flat = s.replace(" ", "")
            raw[c] = s
            for key, names in aliases.items():
                if key in mapping:
                    continue
                for a in names:
                    af = a.replace(" ", "")
                    if flat == af or (af in flat and len(flat) <= len(af) + 4):
                        mapping[key] = c
                        break
        if "name" in mapping and ("campus" in mapping or "host" in mapping or "time" in mapping):
            return r, mapping, raw
    return None, {}, {}


def _pick_sheet(wb, path: Path):
    """优先返回带合法表头的工作表"""
    sheets = wb.worksheets
    for ws in sheets:
        hr, hm, _ = find_header(ws)
        if hr is not None:
            return ws, hr, hm
    ws = wb.active
    return ws, None, {}


def guess_source_label(path: Path, cfg: dict) -> str:
    """从文件名猜来源（学院/机构/校区），猜不到返回文件名主干。"""
    stem = path.stem
    for college in sorted(cfg.get("colleges") or [], key=len, reverse=True):
        if college in stem:
            return college
    for campus in cfg.get("campuses") or []:
        if campus in stem:
            return f"{campus}校区"
    cleaned = re.sub(r"[（(][^（）()]{0,12}[）)]", "", stem)
    cleaned = re.sub(r"20\d{2}[-—]20\d{2}学年.*?学期", "", cleaned)
    cleaned = re.sub(r"第\s*\d+\s*周", "", cleaned).strip(" -_")
    return cleaned or stem


def read_source(path: Path, cfg: dict) -> Dict[str, Any]:
    """读取一份单表，返回 {records, week, header, issues, source_label}"""
    info: Dict[str, Any] = {
        "path": str(path), "file": path.name, "records": [],
        "week": None, "issues": [], "source_label": guess_source_label(path, cfg),
        "sheets": [], "ok": False,
    }
    try:
        wb = openpyxl.load_workbook(path, data_only=True, read_only=False)
    except Exception as exc:  # noqa: BLE001
        info["issues"].append(Issue(
            "FILE_UNREADABLE", "error", "-",
            f"无法读取：{type(exc).__name__}", "确认是 .xlsx 未加密文件；.xls 请先另存为 .xlsx",
        ).as_dict())
        return info

    info["sheets"] = [ws.title for ws in wb.worksheets]
    ws, header_row, header_map = _pick_sheet(wb, path)
    if header_row is None:
        info["issues"].append(Issue(
            "HEADER_NOT_FOUND", "error", "-",
            "未识别到表头行（需含「活动名称」以及「校区」/「主办单位」/「开展时间」）",
            "确认使用校素拓标准模板；表头应在前 10 行内",
        ).as_dict())
        wb.close()
        return info

    info["header"] = {k: get_column_letter(v) for k, v in header_map.items()}
    # 周次：先看标题行，再看文件名
    title_bits = []
    for r in range(1, header_row):
        for c in range(1, min(ws.max_column, 12) + 1):
            v = _s(ws.cell(row=r, column=c).value)
            if v:
                title_bits.append(v)
    for t in title_bits + [path.stem]:
        wk = zjb.extract_week(t)
        if wk:
            info["week"] = wk
            break

    file_campus = None
    for campus in cfg.get("campuses") or []:
        if campus in path.stem:
            file_campus = campus
            break

    for r in range(header_row + 1, ws.max_row + 1):
        cells: Dict[str, str] = {}
        for key, col in header_map.items():
            if key in ("no",):
                continue
            cells[key] = _s(ws.cell(row=r, column=col).value)
        name = cells.get("name", "")
        if not name or name in ("活动名称", "合计", "备注"):
            continue
        # 校区：列优先，文件名兜底
        cells["campus"] = zjb.normalize_campus(cells.get("campus"), cfg) or file_campus or ""
        rec = build_record(cells, cfg)
        rec.primary_source = path.name
        rec.primary_row = r
        rec.sources.append({"file": path.name, "row": r, "campus": cells.get("campus", ""),
                            "source_label": info["source_label"]})
        info["records"].append(rec)

    wb.close()
    info["ok"] = True
    return info


# ------------------------------------------------------------------ 归一化 + 校验

def build_record(cells: Dict[str, str], cfg: dict) -> Record:
    """把原始单元格归一化成 Record（含清洗与校验）"""
    c: Dict[str, str] = {}
    for key, _label in STD_COLUMNS:
        c[key] = _s(cells.get(key, ""))

    # 级别别名归一
    c["level"] = LEVEL_ALIASES.get(c["level"], c["level"])
    # 类型 / 类别 去空白容错
    c["type"] = c["type"].replace("活动", "") if c["type"] in ("临时活动", "常规活动") else c["type"]
    # 时间里的全角冒号统一（时间必须可解析）
    c["time"] = re.sub(r"[：]", ":", c["time"])
    c["phone"] = re.sub(r"[\s\-‐-―]", "", c["phone"])

    rec = Record(cells=c, primary_source=cells.get("_src", ""), primary_row=0)
    rec.slots, parsed = parse_time_spec(c["time"])
    rec.issues = validate(rec, cfg, time_parsed=parsed)
    return rec


def validate(rec: Record, cfg: dict, time_parsed: bool = True) -> List[Issue]:
    """把《每周活动登记表注意事项》的成文要求落成校验项。"""
    out: List[Issue] = []

    def add(code, level, fld, msg, advice=""):
        out.append(Issue(code, level, fld, msg, advice))

    # —— 活动名称
    name = rec.get("name")
    if RE_QUOTES.search(name):
        add("NAME_QUOTE", "error", "活动名称", "活动名称含引号",
            "活动名称不能用引号，直接去掉")
    if not (RE_YEAR.search(name) or RE_SESSION.search(name)):
        add("NAME_NO_YEAR", "warning", "活动名称", "活动名称缺少「年份/届数」",
            "格式应为：年份/届数 + 机构/学院单位名称 + 具体活动名称")
    if not RE_ORG_HINT.search(name):
        add("NAME_NO_ORG", "warning", "活动名称", "活动名称里看不出机构/学院单位名称",
            "格式应为：年份/届数 + 机构/学院单位名称 + 具体活动名称")
    if RE_YEAR.search(name) and RE_SESSION.search(name):
        add("NAME_BOTH_YEAR_SESSION", "warning", "活动名称", "年份和届数同时出现",
            "年份和届数不可以同时存在，二选一")

    # —— 活动级别
    lvl = rec.get("level")
    if not lvl:
        add("LEVEL_MISSING", "error", "活动级别", "活动级别为空", "市级/校级/院级")
    elif lvl not in VALID_LEVELS:
        add("LEVEL_INVALID", "error", "活动级别", f"活动级别「{lvl}」不在允许集合内",
            "允许：" + "、".join(sorted(VALID_LEVELS)))

    # —— 主办单位
    host = rec.get("host")
    if not host:
        add("HOST_MISSING", "error", "主办单位", "主办单位为空", "按申报书填写")
    elif RE_DEPT_TAIL.search(host):
        add("HOST_HAS_DEPT", "warning", "主办单位", f"主办单位疑似写到部门：{host}",
            "主办单位一律不写「××部门」，写到学院/机构一级")

    # —— 活动类型 / 项目类别
    if rec.get("type") not in VALID_TYPES:
        add("TYPE_INVALID", "error", "活动类型", f"活动类型「{rec.get('type') or '空'}」不规范",
            "只能写「临时」或「常规」")
    if rec.get("category") not in VALID_CATEGORIES:
        add("CATEGORY_INVALID", "error", "项目类别",
            f"项目类别「{rec.get('category') or '空'}」不规范",
            "只能写：学术科技与专业技能 / 文化艺术与体育竞技 / 社会实践与志愿服务")

    # —— 开展时间
    if not rec.get("time"):
        add("TIME_MISSING", "error", "开展时间", "开展时间为空",
            "格式：周X xx:xx-xx:xx；非当周写第几周周X xx:xx-xx:xx")
    elif not time_parsed:
        add("TIME_FORMAT", "warning", "开展时间", f"开展时间「{rec.get('time')}」无法解析出周次/时段",
            "建议写成：周X xx:xx-xx:xx")
    elif not re.search(r"周\s*[一二三四五六日天]", rec.get("time")):
        add("TIME_NO_WEEKDAY", "warning", "开展时间", "开展时间没写明周几",
            "必须确切到第几周周几的几点-几点")

    # —— 地点
    place = rec.get("place")
    way = rec.get("way")
    if not place:
        add("PLACE_MISSING", "error", "地点", "地点为空", "线下活动需确定地点；线上活动需写链接或邮箱")
    elif ("线上" in place or "线上" in way) and not RE_URL.search(place) and "线上" == place.strip():
        add("PLACE_ONLINE_NO_LINK", "warning", "地点", "线上活动没写链接或邮箱",
            "线上活动地点需有邮箱或链接")

    # —— 负责人 / 联系方式
    if not rec.get("contact"):
        add("CONTACT_MISSING", "error", "负责人", "负责人为空", "多个负责人用空格隔开")
    phone_raw = rec.get("phone")
    if not phone_raw:
        add("PHONE_MISSING", "error", "长号&短号", "联系方式为空", "填 11 位手机号")
    elif not RE_PHONE.search(phone_raw):
        add("PHONE_INVALID", "warning", "长号&短号", f"联系方式「{phone_raw}」不像 11 位手机号",
            "确认号码完整；多个联系方式可取其中一个")

    # —— 活动对象 vs 级别
    target = rec.get("target")
    if not target:
        add("TARGET_MISSING", "error", "活动对象", "活动对象为空",
            "校级→全校学生；院级→全院学生；协会培训→协会会员")
    else:
        # 协会会员培训的活动，级别本就应为校级（培训 PPT：「协会培训——协会会员」）
        is_assoc = "协会" in target
        if lvl == "校级" and not ("全校" in target or is_assoc):
            add("LEVEL_TARGET_MISMATCH", "warning", "活动对象",
                f"活动级别为校级，活动对象却是「{target}」", "校级活动对应全校学生")
        if lvl == "院级" and "全校" in target:
            add("LEVEL_TARGET_MISMATCH", "warning", "活动对象",
                f"活动级别为院级，活动对象却是「{target}」",
                "院级活动对应全院学生；若面向两个及以上学院应为校级")
        if is_assoc and lvl and lvl != "校级":
            add("LEVEL_TARGET_MISMATCH", "warning", "活动对象",
                f"协会会员培训的活动级别应为校级，当前是「{lvl}」",
                "协会会员培训的活动，活动级别也为校级")

    # —— 加分分值
    score = rec.get("score")
    if not score:
        add("SCORE_MISSING", "error", "加分分值", "加分分值为空", "按申报书填写，如 0.2-1.0")
    elif not re.search(r"\d", score) and "累计服务时长" not in score:
        add("SCORE_FORMAT", "warning", "加分分值", f"加分分值「{score}」看不出数值",
            "写具体分值或分值范围；累计服务时长的活动统一写「累计服务时长」")

    # —— 校区
    campus = rec.get("campus")
    if not campus:
        add("CAMPUS_MISSING", "error", "校区", "校区为空",
            "校内活动填举办校区；校外活动看活动对象所处校区")
    elif campus not in VALID_CAMPUSES:
        add("CAMPUS_INVALID", "warning", "校区", f"校区「{campus}」不是西城/官渡/光华",
            "多个校区用空格隔开，顺序：西城 官渡 光华")

    # —— 全角标点
    for key, label in STD_COLUMNS:
        if key in ("no",):
            continue
        hits = find_fullwidth_punct(rec.get(key))
        if hits:
            add("FULLWIDTH_PUNCT", "warning", label,
                f"含全角标点：{''.join(hits)}",
                "活动登记表里的所有符号均用英文符号（顿号除外）")
            break

    # —— 列宽 / 行高冲突：内容超出官方列宽会折行，而固定 21 磅行高只放得下 1 行
    for key, label in (("name", "活动名称"), ("host", "主办单位"), ("time", "开展时间"),
                       ("category", "项目类别"), ("target", "活动对象"), ("remark", "备注")):
        text = rec.get(key)
        if not text or RE_URL.search(text):
            continue          # 链接/邮箱无法精简，官方总表同样如此，不报
        avail = col_px(COL_WIDTHS.get(key, 12))
        need = est_width_px(text)
        if need > avail:
            add("CELL_WRAP_CLIP", "warning", label,
                f"{label}约需 {need:.0f}px，超过官方列宽 {COL_WIDTHS.get(key)}（约 {avail:.0f}px）",
                "固定 21 磅行高只放得下 1 行，超长会被裁掉；请精简文字或加宽该列/调高该行")

    return out


# ------------------------------------------------------------------ 合并 / 去重

def merge_records(infos: Sequence[Dict[str, Any]], cfg: dict) -> Dict[str, Any]:
    """把多份单表的记录合起来：精确重复自动合并，疑似重复只标记不删。"""
    all_recs: List[Record] = []
    for info in infos:
        all_recs.extend(info["records"])

    exact: Dict[str, Record] = {}
    merged_pairs: List[Dict[str, Any]] = []
    for rec in all_recs:
        key = rec.fingerprint()
        if key and key in exact:
            keep = exact[key]
            # 保留信息更全的一条，缺的字段从对方补
            if rec.completeness() > keep.completeness():
                keep, rec = rec, keep
                exact[key] = keep
            for k, _label in STD_COLUMNS:
                if not keep.get(k) and rec.get(k):
                    keep.cells[k] = rec.get(k)
            keep.sources.extend(rec.sources)
            merged_pairs.append({
                "name": keep.name, "key": key,
                "kept_from": keep.primary_source, "dropped_from": rec.primary_source,
                "time": keep.get("time"), "place": keep.get("place"),
            })
        else:
            exact[key] = rec

    unique = list(exact.values())

    # 疑似重复：同名但时间/地点不同
    by_name: Dict[str, List[Record]] = {}
    for rec in unique:
        by_name.setdefault(rec.name_fingerprint(), []).append(rec)
    suspects: List[Dict[str, Any]] = []
    for nfp, group in by_name.items():
        if nfp and len(group) > 1:
            suspects.append({
                "name": group[0].name,
                "files": sorted({s["file"] for g in group for s in g.sources}),
                "rows": [{"file": g.primary_source, "row": g.primary_row,
                          "time": g.get("time"), "place": g.get("place")} for g in group],
                "advice": "同名但时间/地点不同：可能是同一活动的不同场次，也可能是重复上报，请人工确认",
            })

    unique.sort(key=lambda r: r.sort_key())
    for i, rec in enumerate(unique, 1):
        rec.cells["no"] = str(i)

    return {
        "records": unique,
        "counts": {
            "input_files": len(infos),
            "raw_rows": len(all_recs),
            "unique": len(unique),
            "exact_merged": len(merged_pairs),
            "suspect_groups": len(suspects),
        },
        "exact_merged": merged_pairs,
        "suspects": suspects,
    }


# ------------------------------------------------------------------ 写出 xlsx

def _body_font(size: int = 9, bold: bool = False, red: bool = False) -> Font:
    return Font(name="宋体", size=size, bold=bold, charset=134,
                color=Color(rgb="FFFF0000" if red else "FF000000"))


def _border() -> Border:
    s = Side(style="thin", color="FF000000")
    return Border(left=s, right=s, top=s, bottom=s)


def _cell(ws, r: int, c: int, value, *, size=9, bold=False, red=False,
          border=True, fill=None, align="center"):
    cell = ws.cell(row=r, column=c)
    cell.value = value if value != "" else None
    cell.font = _body_font(size=size, bold=bold, red=red)
    if border:
        cell.border = _border()
    if fill:
        cell.fill = fill
    cell.alignment = Alignment(horizontal=align, vertical="center", wrap_text=True)
    return cell


def _outline_title_row(ws, ncol: int):
    """合并的标题行只描外框：上/下通描，左边框落在首格、右边框落在末格。

    与官方《总表》做法一致（B1..N1 只有上下边框），避免出现内部竖线。
    """
    side = Side(style="thin", color="FF000000")
    for ci in range(1, ncol + 1):
        cell = ws.cell(row=1, column=ci)
        cell.border = Border(
            left=side if ci == 1 else None,
            right=side if ci == ncol else None,
            top=side, bottom=side,
        )


def write_table(path: Path, week: Optional[int], columns: Sequence[Tuple[str, str]],
                records: Sequence[Record], *, title: Optional[str] = None,
                remark_col_key: str = "remark", extra_rows: Sequence[Sequence[Any]] = ()) -> Path:
    """按官方要求写一张表：标题宋体24加粗/行高30，正文宋体9/行高21，仅内容区加边框。"""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"

    ncol = len(columns)
    title_text = title or (f"第{week}周活动登记表" if week else "活动登记表")

    # 标题行
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
    tcell = ws.cell(row=1, column=1)
    tcell.value = title_text
    tcell.font = _body_font(size=24, bold=True)
    tcell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30
    _outline_title_row(ws, ncol)

    # 表头行（官方总表表头无底色）
    for ci, (_key, label) in enumerate(columns, 1):
        _cell(ws, 2, ci, label, size=9, bold=True)
    ws.row_dimensions[2].height = 21

    # 数据行
    r = 3
    for rec in records:
        for ci, (key, _label) in enumerate(columns, 1):
            val = rec.get(key) if key != "no" else rec.get("no")
            _cell(ws, r, ci, val, red=(key == remark_col_key))
        ws.row_dimensions[r].height = 21
        r += 1
    for extra in extra_rows:
        for ci, val in enumerate(extra, 1):
            _cell(ws, r, ci, val)
        ws.row_dimensions[r].height = 21
        r += 1

    for ci, (key, _label) in enumerate(columns, 1):
        ws.column_dimensions[get_column_letter(ci)].width = COL_WIDTHS.get(key, 12)

    ws.freeze_panes = "A3"
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


def write_timetable(path: Path, week: Optional[int], records: Sequence[Record],
                    cfg: dict) -> Path:
    """时间表：按活动时段展开，供安排二级学院检查/助理排期。"""
    columns = [
        ("no", "活动编号"), ("name", "活动名称"), ("campus", "校区"),
        ("step", "时段"), ("weekday", "周几"), ("clock", "时刻"),
        ("days", "持续天数"), ("place", "地点"), ("contact", "负责人"),
        ("phone", "长号&短号"), ("target", "活动对象"),
    ]
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    ncol = len(columns)

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
    t = ws.cell(row=1, column=1)
    t.value = f"第{week}周活动登记表时间" if week else "活动登记表时间"
    t.font = _body_font(size=24, bold=True)
    t.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[1].height = 30
    _outline_title_row(ws, ncol)

    for ci, (_k, label) in enumerate(columns, 1):
        _cell(ws, 2, ci, label, bold=True)
    ws.row_dimensions[2].height = 21

    r = 3
    for rec in records:
        slots = rec.slots or [Slot()]
        for si, slot in enumerate(slots, 1):
            row = {
                "no": rec.get("no"),
                "name": rec.name,
                "campus": rec.campus,
                "step": f"{si}/{len(slots)}" if len(slots) > 1 else "1/1",
                "weekday": WEEKDAY_LABEL.get(slot.day_start or 0, ""),
                "clock": slot.label(),
                "days": slot.duration_days,
                "place": rec.get("place"),
                "contact": rec.get("contact"),
                "phone": rec.get("phone"),
                "target": rec.get("target"),
            }
            for ci, (key, _label) in enumerate(columns, 1):
                _cell(ws, r, ci, row.get(key, ""))
            ws.row_dimensions[r].height = 21
            r += 1

    widths = TIMETABLE_WIDTHS
    for ci, (key, _label) in enumerate(columns, 1):
        ws.column_dimensions[get_column_letter(ci)].width = widths.get(key, 12)
    ws.freeze_panes = "A3"
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


def write_report(path: Path, week: Optional[int], merged: Dict[str, Any],
                 infos: Sequence[Dict[str, Any]]) -> Path:
    """校验报告：校验问题 / 来源追踪 / 疑似重复"""
    wb = openpyxl.Workbook()

    def sheet(title: str, headers: Sequence[str], rows: Iterable[Sequence[Any]]):
        ws = wb.create_sheet(title) if wb.sheetnames != ["Sheet"] else wb.active
        ws.title = title
        for ci, h in enumerate(headers, 1):
            _cell(ws, 1, ci, h, bold=True,
                  fill=openpyxl.styles.PatternFill("solid", fgColor="FFF2F2F2"))
        ws.row_dimensions[1].height = 21
        r = 2
        for row in rows:
            for ci, v in enumerate(row, 1):
                _cell(ws, r, ci, v, align="left" if ci > 2 else "center")
            ws.row_dimensions[r].height = 21
            r += 1
        for ci, h in enumerate(headers, 1):
            ws.column_dimensions[get_column_letter(ci)].width = (
                8 if ci == 1 else 22 if ci == len(headers) else 30)
        ws.freeze_panes = "A2"
        return ws

    # 1) 校验问题
    issue_rows = []
    idx = 0
    for rec in merged["records"]:
        for iss in rec.issues:
            idx += 1
            issue_rows.append([
                idx, rec.get("no"), rec.name, rec.campus, rec.primary_source,
                rec.primary_row, "错误" if iss.level == "error" else "提醒",
                iss.field, iss.message, iss.advice,
            ])
    for info in infos:
        for iss in info.get("issues", []):
            idx += 1
            issue_rows.append([idx, "", info["file"], "", info["file"], "",
                               "错误" if iss["level"] == "error" else "提醒",
                               iss["field"], iss["message"], iss["advice"]])
    sheet("校验问题",
          ["序号", "活动编号", "活动名称", "校区", "来源文件", "行号",
           "级别", "字段", "问题", "建议"],
          issue_rows)

    # 2) 来源追踪
    trace_rows = []
    for rec in merged["records"]:
        for src in rec.sources:
            trace_rows.append([rec.get("no"), rec.name, rec.campus,
                               src.get("source_label", ""), src["file"], src["row"]])
    sheet("来源追踪",
          ["活动编号", "活动名称", "校区", "来源单位", "来源文件", "来源行号"],
          trace_rows)

    # 3) 疑似重复
    dup_rows = []
    for i, s in enumerate(merged["suspects"], 1):
        for item in s["rows"]:
            dup_rows.append([i, s["name"], item["file"], item["row"],
                             item["time"], item["place"]])
    sheet("疑似重复",
          ["组号", "活动名称", "来源文件", "行号", "开展时间", "地点"],
          dup_rows)

    for ws in wb.worksheets:
        if ws.title == "Sheet":
            wb.remove(ws)
    if not wb.worksheets:
        wb.create_sheet("校验问题")
    path.parent.mkdir(parents=True, exist_ok=True)
    wb.save(path)
    return path


# ------------------------------------------------------------------ 顶层入口

def collect_inputs(inputs: Sequence[Path]) -> List[Path]:
    """输入可以是文件、目录或通配；递归收 .xlsx，跳过 Office 临时文件。"""
    out: List[Path] = []
    for item in inputs:
        p = Path(item)
        if p.is_dir():
            cand = sorted(p.rglob("*.xlsx")) + sorted(p.rglob("*.xlsm"))
        else:
            cand = [p]
        for f in cand:
            if f.name.startswith("~$") or f.name.startswith("."):
                continue
            if f.suffix.lower() not in (".xlsx", ".xlsm"):
                continue
            out.append(f)
    # 去重保序
    seen, uniq = set(), []
    for f in out:
        key = str(f.resolve()).lower()
        if key not in seen:
            seen.add(key)
            uniq.append(f)
    return uniq


def _week_result(infos: Sequence[Dict[str, Any]], outdir: Path, cfg: dict,
                 week: Optional[int]) -> Dict[str, Any]:
    """把属于同一周的多份单表汇总成一套产物。"""
    merged = merge_records(infos, cfg)
    records: List[Record] = merged["records"]
    base = zjb.standard_base_name(cfg, week) or (f"第{week}周活动登记表" if week else "活动登记表")
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)

    total_path = write_table(outdir / f"{base}.xlsx", week, STD_COLUMNS, records)

    # 表一：宣传部（剔除活动对象为协会会员）
    pub_records = [r for r in records if "协会会员" not in r.get("target")]
    pub_path = write_table(outdir / f"{base}（表一·宣传部）.xlsx", week, STD_COLUMNS,
                           pub_records)
    for i, rec in enumerate(pub_records, 1):
        rec.cells["_pub_no"] = str(i)

    time_path = write_timetable(outdir / f"{base}（时间表）.xlsx", week, records, cfg)
    report_path = write_report(outdir / f"{base}（汇总校验报告）.xlsx", week, merged, infos)

    # 汇总统计
    errors = sum(1 for r in records for i in r.issues if i.level == "error")
    warnings = sum(1 for r in records for i in r.issues if i.level == "warning")
    file_errors = sum(1 for i in infos for x in i.get("issues", []) if x["level"] == "error")

    return {
        "week": week,
        "base_name": base,
        "outputs": {
            "total": str(total_path),
            "publicity": str(pub_path),
            "timetable": str(time_path),
            "report": str(report_path),
        },
        "counts": {
            **merged["counts"],
            "publicity_rows": len(pub_records),
            "activity_errors": errors,
            "activity_warnings": warnings,
            "file_errors": file_errors,
        },
        "sources": [{
            "file": i["file"], "week": i.get("week"), "rows": len(i["records"]),
            "label": i.get("source_label"),
            "header": i.get("header", {}),
            "issues": i.get("issues", []),
            "ok": i.get("ok"),
        } for i in infos],
        "activities": [{
            "no": r.get("no"), "name": r.name, "campus": r.campus,
            "level": r.get("level"), "time": r.get("time"), "place": r.get("place"),
            "target": r.get("target"), "score": r.get("score"),
            "duration_days": r.duration_days,
            "slots": [s.label() for s in r.slots],
            "sources": [s["file"] for s in r.sources],
            "issues": [i.as_dict() for i in r.issues],
        } for r in records],
        "exact_merged": merged["exact_merged"],
        "suspects": merged["suspects"],
    }


def run_merge(inputs: Sequence[Path], outdir: Path, cfg: dict,
              week: Optional[int] = None) -> Dict[str, Any]:
    """汇总主流程。

    一个文件夹里往往混着好几周的下载件，所以**绝不跨周混表**：
    按周分组、每周各出一套产物；指定 `week` 时，其余周的文件会被排除并记录原因。
    """
    files = collect_inputs(inputs)
    if not files:
        raise ValueError("没有找到任何 .xlsx 输入文件")

    infos = [read_source(f, cfg) for f in files]
    notes: List[str] = []
    dropped: List[Dict[str, Any]] = []

    if week is not None:
        keep = [i for i in infos if i["week"] in (None, week)]
        for i in infos:
            if i["week"] is not None and i["week"] != week:
                dropped.append({
                    "file": i["file"], "week": i["week"],
                    "reason": f"该文件是第{i['week']}周，与指定的第{week}周不符",
                })
        if not keep:
            raise ValueError(f"没有找到属于第{week}周的文件")
        groups: List[Tuple[List[Dict[str, Any]], Optional[int]]] = [(keep, week)]
    else:
        by_week: Dict[int, List[Dict[str, Any]]] = {}
        unknown: List[Dict[str, Any]] = []
        for i in infos:
            if i["week"] is None:
                unknown.append(i)
            else:
                by_week.setdefault(i["week"], []).append(i)
        if not by_week:
            groups = [(infos, None)]
        else:
            if unknown:
                biggest = max(by_week, key=lambda k: len(by_week[k]))
                by_week[biggest].extend(unknown)
                notes.append(
                    f"{len(unknown)} 份文件既没写周次、文件名里也没有「第几周」，"
                    f"已并入活动最多的第{biggest}周，请人工确认：" +
                    "、".join(i["file"] for i in unknown[:5]))
            groups = [(by_week[w], w) for w in sorted(by_week)]
            if len(groups) > 1:
                notes.append(
                    f"输入文件跨越 {len(groups)} 个周次（" +
                    "、".join(f"第{w}周" for _g, w in groups) +
                    "），已按周分别各出一套产物，没有跨周混表。")

    results = [_week_result(g, Path(outdir), cfg, w) for g, w in groups]
    results.sort(key=lambda r: (-r["counts"]["unique"], r["week"] or 0))
    primary = dict(results[0])
    primary["extra_weeks"] = [
        {"week": r["week"], "base_name": r["base_name"], "outputs": r["outputs"],
         "counts": r["counts"], "activities": r["activities"],
         "exact_merged": r["exact_merged"], "suspects": r["suspects"]}
        for r in results[1:]
    ]
    primary["dropped_files"] = dropped
    primary["notes"] = notes

    all_sources: List[Dict[str, Any]] = []
    for r in results:
        all_sources.extend(r["sources"])
    primary["sources"] = all_sources
    return primary


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="活动登记表汇总（多份单表 → 总表）")
    ap.add_argument("inputs", nargs="+", help="单表文件或目录（可多个）")
    ap.add_argument("--out", default="output/merge", help="输出目录")
    ap.add_argument("--week", type=int, default=None, help="周次（默认从表/文件名推断）")
    ap.add_argument("--config", default=None, help="config.json 路径")
    ap.add_argument("--json", action="store_true", help="以 JSON 打印结果")
    args = ap.parse_args(argv)

    cfg = zjb.load_config(args.config or (_ENGINE_DIR / "core" / "config.json"))
    result = run_merge([Path(x) for x in args.inputs], Path(args.out), cfg, args.week)

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        c = result["counts"]
        print(f"周次：{result['week']}")
        print(f"输入文件 {c['input_files']} 份 / 原始行 {c['raw_rows']} 条 "
              f"→ 去重后 {c['unique']} 个活动（自动合并重复 {c['exact_merged']} 条）")
        print(f"校验：错误 {c['activity_errors']} 处 / 提醒 {c['activity_warnings']} 处 / "
              f"文件级错误 {c['file_errors']} 处")
        print("")
        for key, label in (("total", "总表（表二·质检部）"), ("publicity", "表一（宣传部）"),
                           ("timetable", "时间表"), ("report", "汇总校验报告")):
            print(f"  {label}：{result['outputs'][key]}")
        for note in result.get("notes") or []:
            print(f"\n⚠ {note}")
        for extra in result.get("extra_weeks") or []:
            print(f"\n另有第{extra['week']}周：{extra['counts']['unique']} 个活动 → "
                  f"{extra['outputs']['total']}")
        for d in result.get("dropped_files") or []:
            print(f"  已排除：{d['file']}（{d['reason']}）")
        if result["suspects"]:
            print(f"\n⚠ 疑似重复 {len(result['suspects'])} 组，需人工确认：")
            for s in result["suspects"][:10]:
                print(f"  · {s['name']} —— {', '.join(s['files'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
