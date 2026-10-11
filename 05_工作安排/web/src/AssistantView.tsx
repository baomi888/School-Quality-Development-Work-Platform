import { useEffect, useState } from 'react'
import { api, type Bootstrap, type Person } from './api'

interface MyTask { task: string; slot: string; note: string; tag: string }

// 小助理只读视图：只能看到「本周我负责」的任务，不能改派、不能进管理层接口。
export function AssistantView({ deptId, onBack }: { deptId: string; onBack: () => void }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [name, setName] = useState('')
  const [data, setData] = useState<{ week: number; committed: boolean; tasks: MyTask[] } | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.bootstrap(deptId)
      .then(setBoot)
      .catch((e) => setErr('加载失败：' + e.message))
  }, [deptId])

  const people: Person[] = boot?.people || []

  async function pick(n: string) {
    setName(n)
    if (!n) { setData(null); return }
    setLoading(true); setErr('')
    try {
      const r = await api.myTasks(deptId, n)
      setData({ week: r.week, committed: r.committed, tasks: r.tasks })
    } catch (e: any) {
      setErr('查询失败：' + e.message); setData(null)
    } finally { setLoading(false) }
  }

  return (
    <div className="assist">
      <header className="a-top">
        <button className="btn ghost" onClick={onBack}>← 部门</button>
        <div className="a-brand">校素拓 · 小助理视图</div>
        <div className="a-org">{boot?.org_name}</div>
      </header>

      <section className="a-hero">
        <div className="kicker">只读 · 你只能看到自己被安排的任务</div>
        <h1 className="a-title">本周我负责</h1>
        <p className="a-sub">
          选你的名字，查看本周管理层给你安排的工作。你无法自行改派——如有疑问请联系本部门部长。
        </p>
      </section>

      <div className="a-pick">
        <label>我是：</label>
        <select value={name} onChange={(e) => pick(e.target.value)}>
          <option value="">— 请选择你的名字 —</option>
          {people.map((p) => (
            <option key={p.id} value={p.name}>
              {p.name}（{p.role === 'assist' ? '助理' : p.role === 'lead' ? '部长' : '副部长'}）
            </option>
          ))}
        </select>
      </div>

      {err && <div className="a-err">{err}</div>}
      {loading && <div className="a-empty">查询中…</div>}

      {data && !data.committed && (
        <div className="a-empty">本周安排还没定稿（管理层尚未提交）。定稿后这里会自动出现你的任务。</div>
      )}

      {data && data.committed && (
        <div className="a-list">
          <div className="a-week">第 {data.week} 周 · 共 {data.tasks.length} 项</div>
          {data.tasks.length === 0
            ? <div className="a-empty">本周没有给你安排任务，好好休息，或主动找部长领活 🙂</div>
            : data.tasks.map((t, i) => (
                <div className="a-card" key={i}>
                  <div className="a-slot">{t.slot}</div>
                  <div className="a-task">
                    {t.task}
                    {t.tag === 'heavy' && <span className="a-heavy">需领导拍板</span>}
                  </div>
                  {t.note && <div className="a-note">备注：{t.note}</div>}
                </div>
              ))}
        </div>
      )}

      <footer className="a-foot">只显示你本人任务 · 数据来自管理层已提交的安排 · 本页不可修改</footer>
    </div>
  )
}
