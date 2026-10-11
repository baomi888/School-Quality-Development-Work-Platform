/* 首页 —— 与落地页同一套「档案台」语言
   三段式：首屏（hero）→ 学期线（一学期=一条线）→ 功能入口。
   数据尽量来自真接口：台账决定的周次状态、统计决定的周活动量。 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'

interface HubProps {
  onNavigate: (key: 'work' | 'ledger' | 'stats' | 'guide') => void
}

const FEATURES = [
  {
    key: 'work' as const,
    no: '01',
    tag: '主战场',
    title: '本周工作',
    desc: '上传总表 → 拆分校区 → 勾选学院安排 → 填时段安排助理。每一步产物可单独下载，写完自动出表格预览与下载前体检。',
  },
  {
    key: 'ledger' as const,
    no: '02',
    tag: '历史',
    title: '排班台账',
    desc: '哪一周、哪个校区、哪个活动、由哪两个学院检查，一查便知。与命令行技能共用同一份台账。',
  },
  {
    key: 'stats' as const,
    no: '03',
    tag: '分析',
    title: '数据看板',
    desc: '各学院出动次数排行、每周工作量趋势、校区分布，还会列出从没排到过的学院。',
  },
  {
    key: 'guide' as const,
    no: '04',
    tag: '手册',
    title: '使用说明',
    desc: '操作手册、排班铁律、素拓政策速查、常见问题，给质检部干事看的完整指南。',
  },
]

const META = [
  { b: '部署', v: '本地运行，127.0.0.1:8765' },
  { b: '数据', v: '不出这台电脑，与命令行同一份台账' },
  { b: '格式', v: '原表字体、边框、合并单元格一个不动' },
  { b: '交接', v: '台账留着全部历史，新人不用从零问' },
]

const TOTAL_WEEKS = 18
const FIRST_WEEK = 3

interface WeekCell {
  w: number
  activities: number
  colleges: number
  state: 'done' | 'now' | 'future' | 'empty'
}

export default function Hub({ onNavigate }: HubProps) {
  const [perWeek, setPerWeek] = useState<{ week: number; activities: number; colleges: number }[]>([])
  const [currentWeek, setCurrentWeek] = useState<number | null>(null)
  const weeksRef = useRef<HTMLDivElement>(null)
  const [lit, setLit] = useState(false)

  useEffect(() => {
    api
      .stats()
      .then((s) => {
        setPerWeek(s.per_week.map((p) => ({ week: p.week, activities: p.activities, colleges: p.colleges })))
        // 「本周」= 台账里已排的最新一周（最接近此刻的那一格）
        const done = s.per_week.filter((p) => p.activities > 0).map((p) => p.week)
        if (done.length) setCurrentWeek(Math.max(...done))
      })
      .catch(() => {
        /* 离线时学期线退化为纯骨架，不影响导航 */
      })
    const t = setTimeout(() => setLit(true), 260)
    return () => clearTimeout(t)
  }, [])

  const weeks: WeekCell[] = useMemo(() => {
    const byWeek = new Map(perWeek.map((p) => [p.week, p]))
    return Array.from({ length: TOTAL_WEEKS }, (_, i) => {
      const w = FIRST_WEEK + i
      const rec = byWeek.get(w)
      const activities = rec?.activities ?? 0
      const colleges = rec?.colleges ?? 0
      let state: WeekCell['state'] = 'future'
      if (currentWeek != null && w < currentWeek) state = activities > 0 ? 'done' : 'empty'
      else if (currentWeek != null && w === currentWeek) state = 'now'
      else if (activities > 0) state = 'done'
      return { w, activities, colleges, state }
    })
  }, [perWeek, currentWeek])

  // 让「本周」格滚进视野
  useEffect(() => {
    const el = weeksRef.current?.querySelector('.hub-wk.now')
    if (el) el.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [currentWeek])

  const heroNow = currentWeek ?? FIRST_WEEK

  return (
    <div className="hub">
      <div className="hub-inner">
        {/* ---------- 首屏 ---------- */}
        <section className="hub-hero">
          <span className="hub-kicker">广东石油化工学院 · 校素质拓展中心 · 质检部</span>
          <h1 className="hub-title">
            一学期，
            <br />
            <span className="em">十八格</span>。
          </h1>
          <p className="hub-sub">
            每周一格。收表、拆分、安排检查学院、排助理、发交流群、周末现场检查——
            重复的交给它，判断留给你。
          </p>
          <div className="hub-acts">
            <button className="hub-act hub-act-p" onClick={() => onNavigate('work')}>
              打开工作平台<span className="arw">→</span>
            </button>
            <button className="hub-act" onClick={() => onNavigate('guide')}>
              先看它怎么跑
            </button>
          </div>
        </section>

        <div className="hub-meta">
          {META.map((m) => (
            <div key={m.b}>
              <b>{m.b}</b>
              {m.v}
            </div>
          ))}
        </div>

        {/* ---------- 学期线 ---------- */}
        <section className="hub-term">
          <div className="hub-sec-head">
            <h2>
              第 {FIRST_WEEK} 周到第 {FIRST_WEEK + TOTAL_WEEKS - 1} 周，现在走到这儿
            </h2>
            <span className="sub">
              W{FIRST_WEEK} 开学 → W{FIRST_WEEK + TOTAL_WEEKS - 1} 期末
            </span>
            <div className="hub-lg" aria-hidden="true">
              <span>
                <i className="hub-sw-done" />
                已检查
              </span>
              <span>
                <i className="hub-sw-now" />
                本周
              </span>
              <span>
                <i className="hub-sw-todo" />
                未开始
              </span>
              <span>
                <i className="hub-sw-none" />
                无活动
              </span>
            </div>
          </div>

          <div className="hub-weeks-scroll" ref={weeksRef}>
            <div className={`hub-weeks ${lit ? 'lit' : ''}`}>
              {weeks.map((c, i) => (
                <div key={c.w} className={`hub-wk ${c.state}`} style={{ ['--i' as string]: i }}>
                  <span className="num">W{c.w}</span>
                  <div className="bar">
                    {Array.from({ length: Math.max(1, Math.min(3, c.activities)) }, (_, k) => (
                      <span
                        key={k}
                        style={{ height: `${34 + ((k * 27 + c.w * 13) % 46)}%` }}
                      />
                    ))}
                  </div>
                  <div className="tip">
                    {c.state === 'empty'
                      ? `W${c.w} · 无活动，仍出空白表`
                      : c.activities > 0
                        ? `W${c.w} · ${c.activities} 活动 · ${c.colleges} 人次检查`
                        : `W${c.w} · 待规划部发总表`}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="hub-scale">
            <span>W{FIRST_WEEK}</span>
            <span className="mid">← 本周 W{heroNow} →</span>
            <span>W{FIRST_WEEK + TOTAL_WEEKS - 1}</span>
          </div>
        </section>

        {/* ---------- 功能入口 ---------- */}
        <section className="hub-func">
          <div className="hub-sec-head">
            <h2>四个工作台</h2>
            <span className="sub">点进去开始干活</span>
          </div>
          <div className="hub-bento">
            {FEATURES.map((f) => (
              <button key={f.key} className="hub-card" onClick={() => onNavigate(f.key)}>
                <span className="hub-card-tag">{f.tag}</span>
                <div className="hub-card-top">
                  <span className="hub-card-no">{f.no}</span>
                  <h3 className="hub-card-title">{f.title}</h3>
                  <p className="hub-card-desc">{f.desc}</p>
                </div>
                <div className="hub-card-foot">
                  <span className="hub-card-arrow">进入 →</span>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
