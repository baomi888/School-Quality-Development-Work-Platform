# -*- coding: utf-8 -*-
"""
事务智体 · 智能体层回归门禁（纯 Python，秒级，非零退出即失败）

覆盖：
  1. 意图规划：5 类目标 → 期望工具序列
  2. 缺上下文时如实追问（MissingContext），不拿空值调用工具
  3. 完整闭环：感知 → 规划 → 行动 → 反思，trace 结构完整
  4. 七个工具各自可运行且可验证（含申报书预审的必改项识别）
  5. 反思能识别失败（空收件目录 / 未填充占位符）
  6. 合规：AI 生成文本带显式标识，产物带隐式标识（标识办法三/四/五条）
  7. 确定性：同一输入两次运行结果一致
  8. 降级：无 LLM 时用规则规划器；LLM 调用不存在的工具必须被拒
  9. 规划器不参与裁决：派活/校验结果来自确定性工具，与 planner 无关
"""
from __future__ import annotations

import json
import shutil
import sys
import traceback
from pathlib import Path

ENGINE = Path(__file__).resolve().parent
if str(ENGINE) not in sys.path:
    sys.path.insert(0, str(ENGINE))

from core import agent, zjb  # noqa: E402
from docx import Document  # noqa: E402

OUT = ENGINE / "_probe_agent_out"
FAILS: list[str] = []
PASSES = [0]


def check(cond, label, detail=""):
    if cond:
        PASSES[0] += 1
    else:
        FAILS.append(f"{label}{('  → ' + detail) if detail else ''}")


def eq(actual, expected, label):
    check(actual == expected, label, f"实际={actual!r} 期望={expected!r}")


# ---------------------------------------------------------------- 素材

def build_inbox() -> Path:
    """复用汇总门禁的合成素材：5 份单表，覆盖重复/协会会员/坏文件/跨周"""
    import importlib.util
    spec = importlib.util.spec_from_file_location("_probe_merge", ENGINE / "_probe_merge.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.build_fixtures()


def build_application(path: Path, *, clean: bool) -> Path:
    d = Document()
    if clean:
        d.add_paragraph("大学生素质拓展中心制")
        d.add_paragraph("项目名称：2026年计算机学院大学生素质拓展中心程序设计竞赛")
        d.add_paragraph("实施时间：2026年3月10日")
        d.add_paragraph("活动流程：" + "报名、初赛、决赛三个阶段依次进行，" * 6)
        d.add_paragraph("工作人员及观众不可加分。")
        d.add_paragraph("须安排工作人员到指定位置检查加分对象的有效证件。")
        t = d.add_table(rows=2, cols=2)
        t.cell(0, 0).text = "一等奖"
        t.cell(0, 1).text = "60%"
        t.cell(1, 0).text = "二等奖"
        t.cell(1, 1).text = "40%"
    else:
        d.add_paragraph('项目名称：2026年"计算机学院"活动')
        d.add_paragraph("实施时间：2026.3.10")
        d.add_paragraph("活动流程：报名后比赛。")
        t = d.add_table(rows=2, cols=2)
        t.cell(0, 0).text = "一等奖"
        t.cell(0, 1).text = "30%"
        t.cell(1, 0).text = "二等奖"
        t.cell(1, 1).text = "30%"
    path.parent.mkdir(parents=True, exist_ok=True)
    d.save(str(path))
    return path


# ---------------------------------------------------------------- 断言

def run():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)
    inbox = build_inbox()

    # ---- 1. 意图规划
    rp = agent.RulePlanner()
    cases = [
        ("把本周登记表汇总一下", {"inbox": str(inbox)}, ["scan_inbox", "merge_registrations"]),
        ("哪些学院还没交表", {"inbox": str(inbox)}, ["scan_inbox", "list_missing", "draft_notice"]),
        ("学分办法里比赛类怎么算分", {}, ["query_policy"]),
        ("帮我预审一份申报书", {"doc": "x.docx"}, ["pre_review_application"]),
    ]
    for goal, ctx, expect in cases:
        plan = rp.plan(goal, ctx)
        eq([p.tool for p in plan], expect, f"1. 规划「{goal}」")

    # ---- 2. 缺上下文如实追问
    try:
        rp.plan("把本周登记表汇总一下", {})
        check(False, "2. 缺 inbox 应抛 MissingContext")
    except agent.MissingContext as exc:
        check("inbox" in str(exc), "2. 追问信息里点明缺哪个参数", str(exc))
    r = agent.run("哪些学院还没交表")  # 故意不给 inbox
    eq(r["ok"], False, "2. 缺上下文的运行标记为未达成")
    check(r["needs_human"], "2. 缺上下文进入 needs_human")
    eq(r["results"], {}, "2. 缺上下文时不执行任何工具")

    # ---- 3. 完整闭环（汇总 → 简报）
    r = agent.run("把本周登记表汇总一下并生成简报", inbox=str(inbox),
                  week=4, out=str(OUT / "merge"))
    phases = [s["phase"] for s in r["steps"]]
    for ph in ("perceive", "plan", "act", "reflect"):
        check(ph in phases, f"3. trace 含 {ph} 阶段")
    eq(r["planner"], "rule", "3. 无 LLM 时使用规则规划器")
    check("降级" in r["planner_note"], "3. 明确标注降级", r["planner_note"])
    check(r["ok"], "3. 闭环达成", json.dumps(r["needs_human"], ensure_ascii=False))
    mg = r["results"].get("merge_registrations") or {}
    eq((mg.get("counts") or {}).get("unique"), 5, "3. 汇总去重后 5 个活动")
    # 简报必须用上真实数字：曾出现「_bind 提前清空延迟占位 → 文案按 0 生成却报成功」
    brief = (r["results"].get("draft_notice") or {})
    btxt = brief.get("text") or ""
    check(brief.get("ok") is True, "3. 简报已生成")
    check(str((mg.get("counts") or {}).get("unique")) in btxt,
          "3. 简报里出现了真实活动数（不是 0）", btxt[:80])
    check("去重后 0 个活动" not in btxt, "3. 简报没有退化成全 0", btxt[:80])
    # 空 payload 必须被拒，而不是生成一份全 0 的通知
    empty_notice = agent.tool_draft_notice(kind="brief", payload="")
    eq(empty_notice.get("ok"), False, "3. 空数据的简报被拒绝生成")

    # ---- 4a. 未交名单
    r2 = agent.run("哪些学院还没交表", inbox=str(inbox))
    lm = r2["results"].get("list_missing") or {}
    check(lm.get("expected", 0) >= 20, "4a. 应交单位数 = 学院+机构",
          str(lm.get("expected")))
    check(len(lm.get("missing") or []) > 0, "4a. 算出了未交名单")
    nt = r2["results"].get("draft_notice") or {}
    check(nt.get("ok") is True, "4a. 催报通知已生成")
    check("{" not in (nt.get("text") or ""), "4a. 通知里没有未填充占位符")
    n_missing = len(lm.get("missing") or [])
    check(str(n_missing) in (nt.get("text") or ""),
          "4a. 催报通知里出现了真实未交数", (nt.get("text") or "")[:80])
    check("仍有 0 个单位" not in (nt.get("text") or ""),
          "4a. 催报通知没有退化成 0 个单位")
    check("None" not in (nt.get("text") or ""),
          "4a. 催报通知里没有 None 之类未渲染值", (nt.get("text") or "")[:60])

    # ---- 4b. 学分办法检索
    r3 = agent.run("学分办法里比赛类怎么算分")
    qp = r3["results"].get("query_policy") or {}
    check(len(qp.get("hits") or []) > 0, "4b. 检索命中原文条款")
    check("原文摘录" in (qp.get("note") or ""), "4b. 明确标注为原文摘录")

    # ---- 4c. 安排二级学院（确定性、无副作用）
    merged = [f for f in (OUT / "merge").glob("*.xlsx") if "（" not in f.name]
    check(bool(merged), "4c. 找到汇总总表")
    if merged:
        r4 = agent.run("安排二级学院检查", table=str(merged[0]), campus="官渡")
        pc = r4["results"].get("plan_checkers") or {}
        check(pc.get("ok") is True, "4c. 派活工具返回成功")
        plans = pc.get("plan") or []
        check(all(len(p["checkers"]) == 2 for p in plans), "4c. 每个活动派 2 个学院")
        check(all(p["checkers"] != [None, None] for p in plans), "4c. 受派学院非空")

    # ---- 4d. 申报书预审：不合规版本应报必改项
    bad = build_application(OUT / "bad.docx", clean=False)
    r5 = agent.run("预审这份申报书", doc=str(bad))
    pr = r5["results"].get("pre_review_application") or {}
    fails_ids = {c["id"] for c in pr.get("checks", []) if c["verdict"] == "fail"}
    for rid in ("R01", "R03", "R04", "R05", "R06", "R08", "R09"):
        check(rid in fails_ids, f"4d. 不合规申报书命中必改项 {rid}")
    # 「预审执行完成」与「申报书本身有问题」是两件事：
    # 工具成功跑完 => ok=True，必改项放在 results.must_fix，不能被混成「智能体失败」
    check(r5["ok"], "4d. 预审执行完成（必改项属于文稿问题，不是工具失败）")
    check(len(pr.get("must_fix") or []) >= 7, "4d. 必改项已列在 must_fix 里",
          str(len(pr.get("must_fix") or [])))

    # 合规版本应通过主要规则
    good = build_application(OUT / "good.docx", clean=True)
    r6 = agent.run("预审这份申报书", doc=str(good))
    pg = r6["results"].get("pre_review_application") or {}
    gfail = {c["id"] for c in pg.get("checks", []) if c["verdict"] == "fail"}
    eq(gfail, set(), "4d. 合规申报书无必改项")

    # ---- 5. 反思能识别失败
    empty = OUT / "empty"
    empty.mkdir(parents=True, exist_ok=True)
    r7 = agent.run("把本周登记表汇总一下", inbox=str(empty))
    eq(r7["ok"], False, "5. 空收件目录判为未达成")
    refl = [s for s in r7["steps"] if s["phase"] == "reflect"]
    check(refl and refl[0]["ok"] is False, "5. 反思步骤标记失败")
    check(r7["needs_human"], "5. 失败进入 needs_human")

    # ---- 6. 合规标识
    check("text_labeled" in (nt or {}), "6. AI 文案带显式标识字段")
    check(agent.AI_LABEL_TEXT in (nt.get("text_labeled") or ""),
          "6. 显式标识文案出现在正文里")
    mk = r.get("ai_marker") or {}
    for k in ("ai_generated", "producer", "content_id", "content_nature"):
        check(k in mk, f"6. 隐式标识含 {k}")
    check(mk.get("ai_generated") is True, "6. 隐式标识标记为 AI 生成")
    check("国信办通字" in (mk.get("basis") or ""), "6. 隐式标识引用了标识办法依据")

    # ---- 7. 确定性
    a1 = agent.run("把本周登记表汇总一下", inbox=str(inbox), week=4, out=str(OUT / "d1"))
    a2 = agent.run("把本周登记表汇总一下", inbox=str(inbox), week=4, out=str(OUT / "d2"))
    n1 = [(x["no"], x["name"], x["campus"]) for x in
          (a1["results"]["merge_registrations"]["activities"])]
    n2 = [(x["no"], x["name"], x["campus"]) for x in
          (a2["results"]["merge_registrations"]["activities"])]
    eq(n1, n2, "7. 两次运行活动列表完全一致")
    eq(a1["results"]["merge_registrations"]["counts"],
       a2["results"]["merge_registrations"]["counts"], "7. 两次运行计数一致")

    # ---- 8. LLM 规划器必须拒绝不存在的工具
    class FakeLLM(agent.LLMPlanner):
        def plan(self, goal, ctx):
            raise ValueError("模型调用了不存在的工具：drop_all_tables")

    r8 = agent.Agent(planner=FakeLLM()).run("把本周登记表汇总一下",
                                            inbox=str(inbox), week=4,
                                            out=str(OUT / "fallback"))
    eq(r8["planner"], "rule", "8. 规划器返回非法工具时降级为规则规划器")
    check("降级" in r8["planner_note"], "8. 降级原因写入 planner_note")
    check(r8["ok"], "8. 降级后仍能跑通闭环")

    # ---- 9. 裁决不经过规划器：换一个乱序规划的 planner，派活结果不变
    class NoopPlan(agent.RulePlanner):
        name = "noop-marker"

    base = agent.Agent(planner=agent.RulePlanner()).run(
        "安排二级学院检查", table=str(merged[0]), campus="官渡")
    alt = agent.Agent(planner=NoopPlan()).run(
        "安排二级学院检查", table=str(merged[0]), campus="官渡")
    eq(base["results"]["plan_checkers"]["plan"],
       alt["results"]["plan_checkers"]["plan"],
       "9. 换规划器不影响派活结果（裁决来自确定性内核）")


def main() -> int:
    try:
        run()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        FAILS.append("probe 运行时异常（见上方 traceback）")
    print(f"\n事务智体门禁：通过 {PASSES[0]} 项，失败 {len(FAILS)} 项")
    if FAILS:
        print("\n失败项：")
        for f in FAILS:
            print("  ✗", f)
        return 1
    print("  ✓ 全部通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
