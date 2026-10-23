/* 首页 —— 与落地页同一套「档案台」语言
   三段式：首屏（hero）→ 学期线（一学期=一条线）→ 功能入口。
   数据尽量来自真接口：台账决定的周次状态、统计决定的周活动量。 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type FileRef, type TableInfo } from '../api'

interface HubProps {
  onNavigate: (key: 'work' | 'merge' | 'agent' | 'ledger' | 'stats' | 'guide' | 'history') => void
}

const FEATURES = [
  {
    key: 'work' as const,
    tag: '主战场',
    title: '本周工作',
    desc: '上传总表 → 拆分校区 → 勾选学院安排 → 填时段安排助理。每一步产物可单独下载，写完自动出表格预览与下载前体检。',
  },
  {
    key: 'merge' as const,
    tag: '收表',
    title: '活动汇总',
    desc: '把各学院交上来的单表一次全拖进去，自动合成总表、表一（宣传部）、时间表与校验报告。跨来源重复自动合并，混进来的其它周次单独分出去。',
  },
  {
    key: 'agent' as const,
    tag: '智能体',
    title: '智能体',
    desc: '直接用一句话说明本周要做什么：哪些学院没交表、把表汇总一下出简报、这份申报书能不能过、学分怎么算。判定全部由内核给出，可复现可解释。',
  },
  {
    key: 'ledger' as const,
    tag: '历史',
    title: '排班台账',
    desc: '哪一周、哪个校区、哪个活动、由哪两个学院检查，一查便知。与命令行技能共用同一份台账。',
  },
  {
    key: 'stats' as const,
    tag: '分析',
    title: '数据看板',
    desc: '各学院出动次数排行、每周工作量趋势、校区分布，还会列出从没排到过的学院。',
  },
  {
    key: 'history' as const,
    tag: '归档',
    title: '历史归档',
    desc: '所有上传、拆分、安排过的 Excel 原表都在这里留档，按周归类，随时回看、预览、重新下载。',
  },
  {
    key: 'guide' as const,
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
    const container = weeksRef.current
    const el = container?.querySelector('.hub-wk.now') as HTMLElement | null
    if (!container || !el) return
    const target = el.offsetLeft + el.offsetWidth / 2 - container.clientWidth / 2
    container.scrollTo({
      left: Math.max(0, target),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    })
  }, [currentWeek])

  const heroNow = currentWeek ?? FIRST_WEEK
  const currentStat = perWeek.find((item) => item.week === heroNow)

  // ---------- 导入历史表（补录台账）----------
  const [histOpen, setHistOpen] = useState(false)
  const [histFile, setHistFile] = useState<FileRef | null>(null)
  const [histInfo, setHistInfo] = useState<TableInfo | null>(null)
  const [histWeek, setHistWeek] = useState<number | null>(null)
  const [histBusy, setHistBusy] = useState('')
  const [histError, setHistError] = useState<{ message: string; problems?: string[] } | null>(null)
  const [histResult, setHistResult] = useState<any>(null)
  const histInputRef = useRef<HTMLInputElement>(null)

  function closeHist() {
    setHistOpen(false)
    setHistFile(null)
    setHistInfo(null)
    setHistWeek(null)
    setHistResult(null)
    setHistError(null)
  }

  async function onHistPick(file: File) {
    setHistError(null)
    setHistResult(null)
    setHistBusy('上传并解析中…')
    try {
      const r = await api.upload(file)
      setHistFile(r.file)
      setHistInfo(r.info)
      setHistWeek(r.info.week)
    } catch (e: any) {
      setHistError({ message: e?.message ?? '上传失败' })
    } finally {
      setHistBusy('')
    }
  }

  async function doHistImport() {
    if (!histFile) return
    setHistBusy('补录中…')
    setHistError(null)
    try {
      const r = await api.importHistory(histFile.id, histWeek)
      setHistResult(r)
    } catch (e: any) {
      setHistError({ message: e?.message ?? '导入失败', problems: e?.problems })
    } finally {
      setHistBusy('')
    }
  }

  return (
    <div className="hub">
      <div className="hub-inner">
        {/* ---------- 首屏 ---------- */}
        <section className="hub-hero">
          <div className="hub-hero-copy">
          <h1 className="hub-title">
            十八周，
            <br />
            逐格排好。
          </h1>
          <p className="hub-sub">
            广东石油化工学院校素拓质检部的每周工作台。收表、拆分、安排检查学院、
            排助理、现场检查与归档都在这里完成；重复的交给它，判断留给你。
          </p>
          <div className="hub-acts">
            <button className="hub-act hub-act-p" onClick={() => onNavigate('work')}>
              打开工作平台<span className="arw">→</span>
            </button>
            <button className="hub-act" onClick={() => onNavigate('guide')}>
              先看它怎么跑
            </button>
            <button className="hub-act" onClick={() => setHistOpen(true)}>
              导入历史表
            </button>
          </div>
          </div>
          <aside className="hub-preview" data-ui aria-label="本周台账概览">
            <div className="hub-preview-head">
              <span>本周台账</span>
              <b>第 {heroNow} 周</b>
            </div>
            <div className="hub-preview-main">
              <strong>{currentStat?.activities ?? 0}</strong>
              <span>项活动已进入本周记录</span>
            </div>
            <div className="hub-preview-grid">
              <div>
                <span>检查学院</span>
                <b>{currentStat?.colleges ?? 0}</b>
                <small>人次</small>
              </div>
              <div>
                <span>留档周数</span>
                <b>{perWeek.length}</b>
                <small>周</small>
              </div>
              <div>
                <span>台账状态</span>
                <b>{currentStat?.activities ? '有记录' : '待录入'}</b>
                <small>本周</small>
              </div>
            </div>
            <button className="hub-preview-open" onClick={() => onNavigate('work')}>
              查看并处理本周工作 →
            </button>
          </aside>
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
            <h2>七个工作台</h2>
            <span className="sub">点进去开始干活</span>
          </div>
          <div className="hub-bento">
            {FEATURES.map((f) => (
              <button key={f.key} className="hub-card" onClick={() => onNavigate(f.key)}>
                <span className="hub-card-tag">{f.tag}</span>
                <div className="hub-card-top">
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

      {/* ---------- 导入历史表弹窗 ---------- */}
      {histOpen && (
        <div className="modal-overlay" onClick={closeHist}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="导入历史活动登记表"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <h3 className="modal-title">导入历史活动登记表</h3>
                <span className="modal-kicker">补录台账 · 不重排</span>
              </div>
              <button className="modal-close" onClick={closeHist} aria-label="关闭">
                ×
              </button>
            </div>

            <p className="modal-desc">
              选一份历史总表或单校区表即可，<strong>不需要先手工拆分</strong>。
              如果表里已经有检查学院/助理，系统会补全台账；如果只是共享活动表，
              会归档活动并明确标记为“未安排”，不会伪造任何检查记录。
            </p>

            {!histFile && (
              <div
                className="dropzone"
                role="button"
                tabIndex={0}
                aria-label="选择或拖入历史 Excel 表"
                onClick={() => histInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    histInputRef.current?.click()
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const f = e.dataTransfer.files?.[0]
                  if (f) onHistPick(f)
                }}
              >
                <div className="dropzone-title">点击选择，或把 Excel 拖到这里</div>
                <div className="dropzone-sub">共享总表、校区表、已安排表都支持 · .xlsx / .xlsm</div>
                <div className="dropzone-sub">腾讯文档、WPS 在线表格请先导出为本地 .xlsx</div>
              </div>
            )}
            <input
              ref={histInputRef}
              type="file"
              accept=".xlsx,.xlsm"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onHistPick(f)
              }}
            />

            {histBusy && (
              <div className="alert" style={{ marginTop: 12 }}>
                ⏳ {histBusy}
              </div>
            )}
            {histError && (
              <div className="alert alert-danger" style={{ marginTop: 12 }}>
                <strong>{histError.message}</strong>
                {histError.problems && histError.problems.length > 0 && (
                  <ul>
                    {histError.problems.map((p, i) => (
                      <li key={i}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {histInfo && !histResult && (
              <div style={{ marginTop: 14 }}>
                <div className="btn-row" style={{ marginBottom: 10 }}>
                  <span className="tag tag-brand">第 {histInfo.week ?? '?'} 周</span>
                  {histInfo.campuses.map((c) => (
                    <span key={c} className="tag">
                      {c}
                    </span>
                  ))}
                  <span className="tag">{histInfo.activity_count} 个活动</span>
                </div>

                {(histInfo.has_checkers || histInfo.has_assistants) ? (
                  <div className="alert alert-ok" style={{ marginBottom: 12 }}>
                    <strong>已识别安排信息</strong>
                    <div className="small">
                      {histInfo.checker_records} 条检查学院记录
                      {histInfo.has_assistants ? ` · ${histInfo.assistant_records} 条助理记录` : ' · 未发现助理列'}
                      。导入后会更新台账。
                    </div>
                  </div>
                ) : (
                  <div className="alert alert-warn" style={{ marginBottom: 12 }}>
                    <strong>这是一份共享活动表</strong>
                    <div className="small">
                      没有找到检查学院或助理列。可以归档活动，但不会计入学院轮值；
                      如果你要安排这周工作，请进入“本周工作”上传同一张表。
                    </div>
                  </div>
                )}

                <label className="modal-field">
                  <span>周次（识别有误可手动改）</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={histWeek ?? ''}
                    onChange={(e) => setHistWeek(e.target.value ? Number(e.target.value) : null)}
                  />
                </label>

                <div className="modal-scroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>活动名称</th>
                        <th style={{ width: 150 }}>主办学院</th>
                        <th style={{ width: 140 }}>时间</th>
                        <th style={{ width: 64 }}>校区</th>
                      </tr>
                    </thead>
                    <tbody>
                      {histInfo.activities.map((a) => (
                        <tr key={a.row}>
                          <td className="num">{a.no ?? a.row}</td>
                          <td className="name">{a.name}</td>
                          <td>{a.host_college || '—'}</td>
                          <td className="small">{a.time || '—'}</td>
                          <td className="small">{a.campus || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="btn-row" style={{ marginTop: 16 }}>
                  <button
                    className="btn btn-primary"
                    onClick={doHistImport}
                    disabled={histBusy !== '' || histWeek == null}
                  >
                    {histInfo.has_checkers || histInfo.has_assistants
                      ? '补录到台账'
                      : '归档这份共享表'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      setHistFile(null)
                      setHistInfo(null)
                      setHistWeek(null)
                    }}
                  >
                    重新选文件
                  </button>
                  {!(histInfo.has_checkers || histInfo.has_assistants) && (
                    <button
                      className="btn"
                      onClick={() => {
                        closeHist()
                        onNavigate('work')
                      }}
                    >
                      去本周工作
                    </button>
                  )}
                </div>
              </div>
            )}

            {histResult && (
              <div className="modal-result" style={{ marginTop: 14 }}>
                <div className={`alert ${histResult.arrangements_imported ? 'alert-ok' : 'alert-warn'}`}>
                  <strong>
                    {histResult.arrangements_imported ? '已补录到台账' : '共享表已归档'}
                  </strong>
                  <div>
                    第 {histResult.week} 周，共 {histResult.total_activities} 个活动。
                    {histResult.arrangements_imported
                      ? '检查学院与助理记录已读取。'
                      : '活动已记录，检查安排保持为空。'}
                  </div>
                </div>
                <ul className="modal-list">
                  {histResult.campuses.map((c: any) => (
                    <li key={c.campus}>
                      <b>{c.campus}</b>：{c.activities} 个活动 · {c.checker_records} 条检查学院记录
                      {c.assistant_records ? ` · ${c.assistant_records} 条助理记录` : ''}
                    </li>
                  ))}
                </ul>
                {histResult.warnings?.length > 0 && (
                  <div className="alert alert-warn" style={{ marginTop: 12 }}>
                    <strong>导入说明</strong>
                    <ul>
                      {histResult.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
                <div className="small muted" style={{ wordBreak: 'break-all' }}>
                  原文件已归档：{histResult.archived_to}
                </div>
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setHistFile(null)
                      setHistInfo(null)
                      setHistWeek(null)
                      setHistResult(null)
                    }}
                  >
                    再导入一份
                  </button>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      closeHist()
                      onNavigate(histResult.arrangements_imported ? 'ledger' : 'history')
                    }}
                  >
                    {histResult.arrangements_imported ? '查看台账' : '查看历史归档'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
