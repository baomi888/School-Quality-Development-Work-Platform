import { useMemo } from 'react'

/* ============================================================
   周课表组件
   完整版：列 = 周一..周日（+ 未排）；格内每张卡 = 一个活动。
   侧栏迷你版（.mtt）：按天分行，事件为胶囊，行内显示检/助数量。
   色彩纪律：不用彩色块区分学院 —— 学院身份交给卡上的学院名。
   ============================================================ */

const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

interface Act {
  row?: number
  no?: string | number
  name?: string
  host_college?: string
  time?: string
  campus?: string
}

interface TimetableProps {
  activities: Act[]
  arrangedPlan?: { row?: number; checkers?: string[] }[]
  assistPlan?: { row?: number; assistants?: string[] }[]
  week?: number | null
  campus?: string
  /** 侧栏迷你网格模式（.mtt） */
  compact?: boolean
}

/** 从时间字符串里尽量解析出星期（0=周一 … 6=周日）；解析不出返回 null */
function weekdayOf(time?: string): number | null {
  if (!time) return null
  const t = time
  const rules: [RegExp, number][] = [
    [/(周|星期|礼拜)\s*[一1]/, 0],
    [/(周|星期|礼拜)\s*[二2]/, 1],
    [/(周|星期|礼拜)\s*[三3]/, 2],
    [/(周|星期|礼拜)\s*[四4]/, 3],
    [/(周|星期|礼拜)\s*[五5]/, 4],
    [/(周|星期|礼拜)\s*[六6]|周末/, 5],
    [/(周|星期|礼拜)\s*[日7天]/, 6],
  ]
  for (const [re, idx] of rules) if (re.test(t)) return idx
  return null
}

export default function Timetable({ activities, arrangedPlan, assistPlan, week, campus, compact }: TimetableProps) {
  const { columns, hasUnsorted } = useMemo(() => {
    const byDay: Act[][] = Array.from({ length: 7 }, () => [])
    const unsorted: Act[] = []
    for (const a of activities) {
      const d = weekdayOf(a.time)
      if (d == null) unsorted.push(a)
      else byDay[d].push(a)
    }
    const cols = byDay.map((list, i) => ({ day: DAYS[i], idx: i, list }))
    if (unsorted.length) cols.push({ day: '未排', idx: -1, list: unsorted })
    return { columns: cols, hasUnsorted: unsorted.length > 0 }
  }, [activities])

  // 把安排结果按 row 合并：检查学院来自 arrangedPlan，助理来自 assistPlan
  const checkByRow = useMemo(() => {
    const m = new Map<number, string[]>()
    ;(arrangedPlan ?? []).forEach((p) => {
      if (p.row != null && p.checkers) m.set(p.row, p.checkers)
    })
    return m
  }, [arrangedPlan])

  const assistByRow = useMemo(() => {
    const m = new Map<number, string[]>()
    ;(assistPlan ?? []).forEach((p) => {
      if (p.row != null && p.assistants) m.set(p.row, p.assistants)
    })
    return m
  }, [assistPlan])

  const cols = hasUnsorted ? 8 : 7

  // 迷你课表：按天分行，事件为胶囊（名称 + 检/助数量标记）
  if (compact) {
    return (
      <div className="mtt">
        {columns.map((c) => (
          <div
            key={c.day}
            className={`mtt-row ${c.idx >= 5 ? 'is-weekend' : ''} ${c.list.length === 0 ? 'empty' : ''}`}
          >
            <div className="mtt-d">{c.day}</div>
            <div className="mtt-evs">
              {c.list.map((a, i) => {
                const row = a.row
                const checkers = row != null ? checkByRow.get(row) : undefined
                const assistants = row != null ? assistByRow.get(row) : undefined
                const done = (checkers?.length ?? 0) + (assistants?.length ?? 0) > 0
                return (
                  <div key={(a.row ?? '') + '-' + i} className={`mtt-ev ${done ? '' : 'pending'}`}>
                    <span className="mtt-ev-name">{a.name || '未命名活动'}</span>
                    {done ? (
                      <span className="mtt-mark">
                        {checkers?.length ? `检${checkers.length}` : ''}
                        {assistants?.length ? `助${assistants.length}` : ''}
                      </span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <section className="card" style={{ ['--tt-cols' as any]: cols }}>
      <div className="card-head">
        <span className="card-no">课</span>
        <h2 className="card-title">本周活动课表</h2>
        <span className="card-hint">
          {week != null ? `第 ${week} 周` : '待识别周次'}
          {campus ? ` · ${campus}` : ''} · 共 {activities.length} 个活动
        </span>
      </div>

      {activities.length === 0 ? (
        <div className="tt-placeholder">
          上传本周活动登记表后，所有活动会自动按星期排进这张课表——
          每格一天、每卡一个活动，安排后还会显示「检查学院」与「助理」。
        </div>
      ) : (
        <>
          <div className="tt">
            {/* 表头：星期行 */}
            <div className="tt-head">
              {columns.map((c) => (
                <div key={c.day} className={`tt-day ${c.idx >= 5 ? 'is-weekend' : ''}`}>
                  {c.day}
                </div>
              ))}
            </div>
            {/* 表体：每列竖排当天的活动块 */}
            <div className="tt-body">
              {columns.map((c) => (
                <div key={c.day} className={`tt-col ${c.idx >= 5 ? 'is-weekend' : ''}`}>
                  {c.list.length === 0 ? (
                    <div className="tt-col-empty">—</div>
                  ) : (
                    c.list.map((a, i) => {
                      const row = a.row
                      const checkers = row != null ? checkByRow.get(row) : undefined
                      const assistants = row != null ? assistByRow.get(row) : undefined
                      return (
                        <div className="tt-block" key={(a.row ?? '') + '-' + i}>
                          {a.host_college && <div className="tt-block-host">{a.host_college}</div>}
                          <div className="tt-block-name">{a.name || '未命名活动'}</div>
                          <div className="tt-block-foot">
                            {checkers && checkers.length > 0 && (
                              <span className="tt-role">
                                <b>检</b>
                                <span className="tt-val">{checkers.join(' · ')}</span>
                              </span>
                            )}
                            {assistants && assistants.length > 0 && (
                              <span className="tt-role">
                                <b>助</b>
                                <span className="tt-val">{assistants.join(' · ')}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="tt-note">
            每列 = 一天，列内每张卡 = 一个活动（卡上第一行是主办学院）。
            排班完成后，卡上的「检」= 安排的两个检查学院，「助」= 安排的检查助理。
          </div>
        </>
      )}
    </section>
  )
}
