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

  async function reset(week?: number, campus?: string) {
    const label = week ? `第${week}周${campus ? '·' + campus : ''}` : '全部台账'
    if (!confirm(`确定清空 ${label} 的排班记录？此操作不可撤销。`)) return
    await api.ledgerReset(week, campus)
    load()
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
            </div>
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
