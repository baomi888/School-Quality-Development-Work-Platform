import { useEffect, useMemo, useState } from 'react'
import { FLOW, type FlowCtx, type FlowKey } from '../workflow'

type Props = {
  /** 当前周次；未上传总表时为 null，此时隐藏勾选（不写 localStorage） */
  week: number | null
  step: number
  assistDone: boolean
  slotKeys: readonly string[]
  slotText: Record<string, string>
  onSlotText: (next: Record<string, string>) => void
  /** 侧栏紧凑模式：隐藏说明文字，行高压缩（样式见 .flow-compact） */
  compact?: boolean
}

const storeKey = (week: number) => `zjb:flow:W${week}`

export default function WeekFlow({ week, step, assistDone, slotKeys, slotText, onSlotText, compact }: Props) {
  // 线下动作（无 auto 的段落）的勾选状态，按周隔离
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [openSlots, setOpenSlots] = useState<boolean | null>(null)

  useEffect(() => {
    if (week == null) return
    try {
      const raw = localStorage.getItem(storeKey(week))
      setChecked(raw ? JSON.parse(raw) : {})
    } catch {
      setChecked({})
    }
  }, [week])

  const ctx: FlowCtx = useMemo(() => ({ step, assistDone }), [step, assistDone])

  const rows = useMemo(
    () =>
      FLOW.map((s) => {
        const auto = Boolean(s.auto)
        const done = s.auto ? s.auto(ctx) : Boolean(checked[s.key])
        return { ...s, auto, done }
      }),
    [ctx, checked],
  )

  const doneCount = rows.filter((r) => r.done).length
  const currentIdx = rows.findIndex((r) => !r.done)

  function toggle(key: FlowKey) {
    if (week == null) return
    setChecked((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      try {
        localStorage.setItem(storeKey(week), JSON.stringify(next))
      } catch {
        /* localStorage 不可用（隐私模式）时只保留本次会话状态 */
      }
      return next
    })
  }

  const monDone = rows[0].done
  const showSlots = openSlots ?? !monDone
  const filled = slotKeys.filter((k) => (slotText[k] ?? '').trim()).length

  return (
    <section className={`flow ${compact ? 'flow-compact' : ''}`}>
      <div className="flow-head">
        <h2>本周工作流</h2>
        <span className="flow-sub">周一 → 周日 · 灰色段落由系统自动判定</span>
        <span className="flow-count">
          <b>{doneCount}</b> / {rows.length} 完成
          {week != null ? ` · 第 ${week} 周` : ' · 未载入总表'}
        </span>
      </div>
      <p className="flow-lede">
        一周六件事，从上往下走。红色那一行是现在该做的；灰色段落系统会自己判定，不用管。
      </p>

      {rows.map((r, i) => (
        <div
          key={r.key}
          className={`flow-row ${r.done ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`}
        >
          <div className="flow-day">{r.day}</div>

          <div>
            <div className="flow-title">{r.title}</div>
            <div className="flow-what">{r.what}</div>
            <div className="flow-out">{r.out}</div>

            {r.key === 'mon' && showSlots && (
              <div className="flow-slots">
                <div className="slot-grid">
                  {slotKeys.map((k) => (
                    <div className="slot-box" key={k}>
                      <label>{k}有空的人</label>
                      <textarea
                        value={slotText[k] ?? ''}
                        placeholder="张三, 李四, 王五"
                        onChange={(e) => onSlotText({ ...slotText, [k]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flow-act">
            {r.key === 'mon' && (
              <button className="flow-link" onClick={() => setOpenSlots(!showSlots)}>
                {showSlots ? '收起' : `填空闲表（${filled}/${slotKeys.length}）`}
              </button>
            )}

            {r.auto ? (
              <span className="flow-auto">{r.done ? '已完成' : '待系统处理'}</span>
            ) : (
              <button
                className={`btn btn-sm ${r.done ? 'btn-primary' : ''}`}
                onClick={() => toggle(r.key)}
                disabled={week == null}
                title={week == null ? '先上传总表，确定周次后才能勾选' : undefined}
              >
                {r.done ? '已完成 ✓' : '标记完成'}
              </button>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}
