import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

interface Act {
  no?: string
  name?: string
  host_college?: string
  campus?: string
  checkers?: string[]
  assistants?: string[]
}

export default function LedgerView() {
  const [weeks, setWeeks] = useState<Record<string, any>>({})
  const [file, setFile] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 联动：从 05 工作安排台同步助理（通用：任意来源周次 → 任意目标周次）
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{ kind: 'ok' | 'warn' | 'danger'; text: string } | null>(null)

  // 联动面板元数据（来自 05 工作安排台）
  const [meta, setMeta] = useState<{ weeks: number[]; tasks: Record<string, string> }>({ weeks: [], tasks: {} })
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [srcWeek, setSrcWeek] = useState<number>(0)
  const [selTask, setSelTask] = useState<string>('t_03')

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await api.ledger()
      setWeeks(r.weeks)
      setFile(r.ledger_file)
      setErr('')
    } catch (e: any) {
      setErr(e?.message ?? '读取台账失败')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // 拉取 05 的周次 / 任务清单，供联动面板下拉
  useEffect(() => {
    api.planMeta()
      .then((r) => {
        if (r.ok) setMeta({ weeks: r.weeks || [], tasks: r.tasks || {} })
      })
      .catch(() => { /* 未连上安排台：面板回退为手动输入 */ })
  }, [])

  async function reset(week?: number, campus?: string) {
    const label = week ? `第${week}周${campus ? '·' + campus : ''}` : '全部台账'
    if (!confirm(`确定清空 ${label} 的排班记录？此操作不可撤销。`)) return
    await api.ledgerReset(week, campus)
    load()
  }

  function openSync(rec: any) {
    setOpenKey(`W${rec.week}-${rec.campus}`)
    setSrcWeek((rec.week ?? 0) + 1)   // 默认：第 N 周安排的是第 N-1 周的活动
    setSelTask('t_03')                 // 默认：安排助理检查活动
    setSyncMsg(null)
  }

  async function doSync(rec: any) {
    setSyncBusy(true)
    setSyncMsg(null)
    try {
      const r = await api.syncAssistants({ source_week: srcWeek, target_week: rec.week, task: selTask })
      if (r.synced > 0) {
        setSyncMsg({
          kind: 'ok',
          text: `已把第 ${srcWeek} 周（工作安排台）的助理写回第 ${rec.week} 周 ${r.synced} 个活动的「检查助理」：西城[${r['西城助理']?.join('、')}] · 官渡[${r['官渡助理']?.join('、')}]`,
        })
      } else {
        setSyncMsg({ kind: 'warn', text: r.note || '本次没有可写入的助理数据' })
      }
      setOpenKey(null)
      load()
    } catch (e: any) {
      setSyncMsg({ kind: 'danger', text: e?.message ?? '同步失败' })
    } finally {
      setSyncBusy(false)
    }
  }

  const keys = Object.keys(weeks).sort((a, b) => {
    const wa = weeks[a]?.week ?? 0
    const wb = weeks[b]?.week ?? 0
    return wa - wb || a.localeCompare(b)
  })

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">排班台账</h2>
          <span className="card-hint">与命令行技能共用同一份记录，下次安排自动避开上周学院</span>
        </div>
        <div className="btn-row">
          <span className="tag">{keys.length} 周记录</span>
          <span className="small muted mono file-path" title={file}>{file}</span>
          <button className="btn btn-sm" onClick={load} disabled={busy} style={{ marginLeft: 'auto' }}>刷新</button>
          {keys.length > 0 && (
            <button className="btn btn-sm" onClick={() => reset()}>清空全部</button>
          )}
        </div>
        {err && <div className="alert alert-danger" style={{ marginTop: 10 }}>{err}</div>}
        {syncMsg && (
          <div className={`alert alert-${syncMsg.kind === 'warn' ? 'warn' : syncMsg.kind === 'danger' ? 'danger' : 'ok'}`} style={{ marginTop: 10 }}>
            {syncMsg.text}
          </div>
        )}
      </section>

      {keys.length === 0 && !busy && (
        <div className="empty">
          <div className="empty-title">还没有排班记录</div>
          <div className="small">在「本周工作」里完成一次安排，或上传已排好的表点入档，就会出现在这里</div>
        </div>
      )}

      {keys.map((k) => {
        const rec = weeks[k]
        return (
          <section className="card" key={k}>
            <div className="card-head">
              <h3 className="card-title">第 {rec.week} 周 · {rec.campus}</h3>
              <span className="card-hint">更新于 {rec.updated_at ?? rec.created_at}</span>
              <button
                className="btn btn-sm btn-ghost"
                style={{ marginLeft: 'auto' }}
                onClick={() => reset(rec.week, rec.campus)}
              >
                删除本周
              </button>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => openSync(rec)}
                title="从「工作安排台(05)」取某周安排的助理，写回本周各活动的「检查助理」"
              >
                从安排台同步助理
              </button>
            </div>

            {openKey === k && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center',
                marginTop: 12, padding: 12, border: '1px dashed var(--line, #ddd)',
                borderRadius: 8, background: 'var(--bg-soft, #fafafa)',
              }}>
                <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  来源周次（安排台 05）：
                  {meta.weeks.length ? (
                    <select value={srcWeek} onChange={(e) => setSrcWeek(Number(e.target.value))}>
                      {meta.weeks.map((w) => <option key={w} value={w}>第 {w} 周</option>)}
                    </select>
                  ) : (
                    <input type="number" value={srcWeek} min={1} onChange={(e) => setSrcWeek(Number(e.target.value))} style={{ width: 64 }} />
                  )}
                </label>
                <label className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  任务：
                  <select value={selTask} onChange={(e) => setSelTask(e.target.value)}>
                    {Object.entries(meta.tasks).length
                      ? Object.entries(meta.tasks).map(([id, name]) => (
                          <option key={id} value={id}>{name}（{id}）</option>
                        ))
                      : <option value="t_03">安排助理检查活动（t_03）</option>}
                  </select>
                </label>
                <button className="btn btn-sm btn-primary" disabled={syncBusy} onClick={() => doSync(rec)}>
                  {syncBusy ? '同步中…' : '同步到本周'}
                </button>
                <button className="btn btn-sm" disabled={syncBusy} onClick={() => setOpenKey(null)}>取消</button>
                {!meta.weeks.length && (
                  <span className="small muted">（未连上安排台，可手动填来源周次）</span>
                )}
              </div>
            )}

            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>活动</th>
                  <th style={{ width: 150 }}>主办学院</th>
                  <th style={{ width: 230 }}>检查学院</th>
                  <th style={{ width: 160 }}>检查助理</th>
                </tr>
              </thead>
              <tbody>
                {(rec.activities as Act[]).map((a, i) => (
                  <tr key={i}>
                    <td className="num">{a.no ?? i + 1}</td>
                    <td className="name">{a.name}</td>
                    <td className="small">{a.host_college || '—'}</td>
                    <td>
                      {a.checkers?.length
                        ? a.checkers.map((c) => <span key={c} className="tag tag-brand" style={{ marginRight: 6 }}>{c}</span>)
                        : <span className="small muted">—</span>}
                    </td>
                    <td className="small">
                      {a.assistants?.length
                        ? a.assistants.map((c) => <span key={c} className="tag tag-ok" style={{ marginRight: 6 }}>{c}</span>)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )
      })}
    </>
  )
}
