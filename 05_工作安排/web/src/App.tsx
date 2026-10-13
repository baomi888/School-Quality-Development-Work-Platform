import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, setApiKey, type Assign, type AssignResult, type Org, type Person, type Task, type Warning,
         type Explain, type ExplainCell } from './api'
import { Landing } from './Landing'
import { AssistantView } from './AssistantView'

declare const __BUILD_STAMP__: string

const ROLE_LABEL: Record<string, string> = { lead: '部长', deputy: '副部长', assist: '助理' }

// 版式原型（新建部门时可选）
const ARCHETYPES: { value: string; label: string }[] = [
  { value: 'task_x_slot', label: '派活型（任务 × 列）' },
  { value: 'date_x_slot', label: '排班型（日期 × 节次）' },
  { value: 'task_x_deadline', label: '排期型（稿件 × 截止）' },
  { value: 'event_x_quota', label: '招募型（场次 × 名额）' },
]

// 部门 → 独立 Web 应用地址（质检部另有「周工作自动化 Web 端」，嵌入为分支 B）
const WEB_APPS: Record<string, string> = {
  zjb: 'http://127.0.0.1:8765',
}

// 主校区归并：如 光华 → 官渡。尊重部门的 slot_alias。
function dutyCampus(p: Person, slotAlias: Record<string, string>, slots: string[]): string {
  const c = (p.campus || '').trim()
  return slotAlias[c] || c || (slots[slots.length - 1] ?? '官渡')
}

// 能干哪几列：can_do 为空 = 只干主校区（与后端 Assigner.can_do 一致）。
function canDoOf(p: Person, slots: string[], slotAlias: Record<string, string>): string[] {
  const cds = (p.can_do || []).filter((c) => slots.includes(c))
  return cds.length ? cds : [dutyCampus(p, slotAlias, slots)]
}

// 人员分组：按真实校区归类（领导层单独渲染）。
function groupByCampus(people: Person[]) {
  const byCampus: Record<string, Person[]> = {}
  people.filter((p) => p.role === 'assist').forEach((p) => {
    const c = p.campus || '未分组'
    ;(byCampus[c] = byCampus[c] || []).push(p)
  })
  const assistCount = people.filter((p) => p.role === 'assist' && p.active !== false).length
  return { byCampus, assistCount }
}

// 人员分组卡片
function PersonGroup({
  rows, assign, hasResult, onRename, tasks, slots, slotAlias,
}: {
  rows: Person[]
  assign: Assign
  hasResult: boolean
  onRename: (id: string, name: string) => void
  tasks: Task[]
  slots: string[]
  slotAlias: Record<string, string>
}) {
  if (rows.length === 0) return null
  return (
    <div className="people">
      {rows.map((p) => {
        const off = p.active === false
        const mine = hasResult
          ? Object.entries(assign)
            .filter(([, row]) => Object.values(row || {}).some((v) => (v || []).includes(p.id)))
            .map(([k]) => k)
          : []
        const last = p.last_week || []
        return (
          <div className={`pcard${off ? ' off' : ''}`} key={p.id}>
            <div className="top">
              <input className="name" value={p.name} onChange={(e) => onRename(p.id, e.target.value)} />
            </div>
            <div className="meta">
              {off && <b style={{ color: 'var(--ink-3)' }}>已停用 · </b>}
              本周 <b>{mine.length}</b> 件
              {last.length > 0 && <> · 上周 {last.length} 件</>}
              {canDoOf(p, slots, slotAlias).length > 1 && <> · 可派 {canDoOf(p, slots, slotAlias).join('/')}</>}
            </div>
            {hasResult && (
              <div className="mine">
                {mine.length === 0
                  ? <span style={{ color: 'var(--ink-3)' }}>本周轮空</span>
                  : mine.map((id) => {
                    const nm = tasks.find((t) => t.id === id)
                    return <span key={id}>{nm?.name || id}</span>
                  })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// 把一格的分配理由拼成一句能直接念给人听的话
function whyText(why: ExplainCell, campus: string): string {
  let s = `${why.picked_name} · ${why.detail}`
  if (why.tied > 1) {
    s += ` · ${why.candidates} 人竞争，${why.tied} 人并列最优（按本周规则裁决）`
  } else if (why.candidates > 1) {
    s += ` · 优于其余 ${why.candidates - 1} 人`
  }
  if (why.runner_up) {
    s += ` · 次优 ${why.runner_up.name}：${why.runner_up.note}`
  }
  return s + ` · 点一下移出${campus}格`
}

// 人选器：**一格可放多人**（搭档制）。
function Piker({
  people, campus, cur, onPick, why, slots, slotAlias,
}: {
  people: Person[]
  campus: string
  cur: string[]
  onPick: (pid: string) => void
  why?: ExplainCell
  slots: string[]
  slotAlias: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const pool = people.filter((p) => p.role === 'assist' && p.active !== false)
  const chosen = cur
    .map((id) => pool.find((p) => p.id === id))
    .filter(Boolean) as Person[]
  // 候选池：can_do 含该列的人；已在本格的不重复出现
  const rest = pool.filter((p) => canDoOf(p, slots, slotAlias).includes(campus) && !cur.includes(p.id))

  const chip = (p: Person, active: boolean) => {
    let tip: string
    if (active && why && why.picked === p.id) tip = whyText(why, campus)
    else if (active) tip = `${p.name} · 手动指定 · 点一下移出${campus}格`
    else tip = `助理 · ${p.campus || '未分组'}${canDoOf(p, slots, slotAlias).length > 1 ? ` · 可派${canDoOf(p, slots, slotAlias).join('/')}` : ''} · 点一下加入${campus}格`
    return (
      <span
        key={p.id}
        className={`chip assist${active ? ' on' : ''}`}
        onClick={() => onPick(p.id)}
        title={tip}
      >{p.name}</span>
    )
  }

  return (
    <div className="pcol">
      {chosen.length > 0
        ? <div className="pick">{chosen.map((p) => chip(p, true))}</div>
        : <span className="unset">未派</span>}
      {rest.length > 0 && (
        <>
          <button
            className="more"
            onClick={() => setOpen(!open)}
            title={`往${campus}格加人（可加多个，搭档制）`}
          >
            {open ? '收起' : `加人 · ${rest.length}人`}
          </button>
          {open && (
            <div className="pop">
              <div className="pick">{rest.map((p) => chip(p, false))}</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------------- 台账查看（常驻，按周 / 按人两种视图） ----------------
function LedgerView({
  ledger, nameOf, people, week,
}: {
  ledger: Record<string, Record<string, string[]>>
  nameOf: Record<string, string>
  people: Person[]
  week: number
}) {
  const [view, setView] = useState<'week' | 'person'>('week')

  const weeks = Object.keys(ledger).map(Number).sort((a, b) => b - a)
  if (weeks.length === 0) {
    return (
      <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>
        台账为空。分配满意后点第 01 区的「存入台账」，存过之后这里就能按周 / 按人查看谁做了什么，下一周分配也会自动避开重复。
      </p>
    )
  }

  let totalEntries = 0
  const covered = new Set<string>()
  weeks.forEach((w) => {
    const rec = ledger[String(w)] || {}
    Object.entries(rec).forEach(([pid, list]) => {
      totalEntries += list.length
      covered.add(pid)
    })
  })
  const curStored = !!ledger[String(week)]

  const pmap: Record<string, Person> = {}
  people.forEach((p) => (pmap[p.id] = p))
  const byPerson: Record<string, { count: number; weeks: number[]; tasks: string[]; campus: string }> = {}
  weeks.forEach((w) => {
    const rec = ledger[String(w)] || {}
    Object.entries(rec).forEach(([pid, list]) => {
      const e = byPerson[pid] || (byPerson[pid] = {
        count: 0, weeks: [], tasks: [], campus: pmap[pid]?.campus || '—',
      })
      e.count += list.length
      e.weeks.push(w)
      e.tasks.push(...list)
    })
  })
  const personIds = Object.keys(byPerson).sort((a, b) => byPerson[b].count - byPerson[a].count)
  const counts = personIds.map((id) => byPerson[id].count)
  const maxC = counts[0] || 0
  const minC = counts[counts.length - 1] || 0
  const showSpread = weeks.length >= 2 && maxC - minC >= 2

  return (
    <div className="ledger">
      <div className="ledger-sum">
        <span>已记录 <b>{weeks.length}</b> 周</span>
        <span>覆盖 <b>{covered.size}</b> 人</span>
        <span>累计 <b>{totalEntries}</b> 人次</span>
        <span className={curStored ? 'stored' : 'unstored'}>
          第 {week} 周 {curStored ? '已存台账' : '尚未存入'}
        </span>
      </div>

      <div className="ledger-tabs">
        <button className={`tab${view === 'week' ? ' on' : ''}`} onClick={() => setView('week')}>按周看</button>
        <button className={`tab${view === 'person' ? ' on' : ''}`} onClick={() => setView('person')}>按人看</button>
      </div>

      {view === 'week' ? (
        <div className="ledger-weeks">
          {weeks.map((w) => {
            const rec = ledger[String(w)] || {}
            const entries = Object.entries(rec)
            const n = entries.reduce((s, [, l]) => s + l.length, 0)
            return (
              <div className="lweek" key={w}>
                <div className="lweek-h">
                  <b>第 {w} 周</b>
                  <span className="hint">{entries.length} 人 · {n} 件</span>
                  {w === week && curStored && <span className="cur">当前周</span>}
                </div>
                <div className="lweek-body">
                  {entries.map(([pid, list]) => (
                    <div className="lrow" key={pid}>
                      <span className="ln">{nameOf[pid] || pid}</span>
                      <span className="lt">{list.join('、')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="ledger-persons">
          {personIds.map((pid) => {
            const e = byPerson[pid]
            const light = showSpread && e.count === minC
            return (
              <div className={`lperson${light ? ' light' : ''}`} key={pid}>
                <div className="lp-top">
                  <span className="lp-name">{nameOf[pid] || pid}</span>
                  <span className="lp-count">{e.count} 件</span>
                </div>
                <div className="lp-weeks">
                  {e.campus && e.campus !== '—' ? `${e.campus} · ` : ''}第 {e.weeks.slice().sort((a, b) => a - b).join('、')} 周
                </div>
                <div className="lp-tasks">{e.tasks.join('、')}</div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------- 字号 / 密度调节 ----------------
const FS_KEY = 'zjb_work_fs'
const FD_KEY = 'zjb_work_fd'
const FS_STEPS = [14, 15, 16, 17, 18, 20]
const FS_LABELS = ['小', '较小', '标准', '中', '大', '特大']

function loadNum(key: string, fallback: number, allowed: number[]): number {
  try {
    const v = Number(localStorage.getItem(key))
    return allowed.includes(v) ? v : fallback
  } catch { return fallback }
}

function ViewControls() {
  const [fs, setFs] = useState(() => loadNum(FS_KEY, 16, FS_STEPS))
  const [dense, setDense] = useState(() => {
    try { return localStorage.getItem(FD_KEY) === '1' } catch { return false }
  })

  useEffect(() => {
    document.documentElement.style.setProperty('--fs', `${fs}px`)
    try { localStorage.setItem(FS_KEY, String(fs)) } catch { /* 隐私模式忽略 */ }
  }, [fs])

  useEffect(() => {
    document.documentElement.style.setProperty('--fd', dense ? '0.9' : '1')
    document.documentElement.style.setProperty('--lh', dense ? '1.5' : '1.7')
    try { localStorage.setItem(FD_KEY, dense ? '1' : '0') } catch { /* 忽略 */ }
  }, [dense])

  const idx = Math.max(0, FS_STEPS.indexOf(fs))

  return (
    <div className="viewctl">
      <span className="vlabel">字号</span>
      <button
        className="vbtn" disabled={idx <= 0}
        onClick={() => setFs(FS_STEPS[idx - 1])}
        title="调小字号" aria-label="调小字号"
      >A−</button>
      <span className="vval">{FS_LABELS[idx]}</span>
      <button
        className="vbtn" disabled={idx >= FS_STEPS.length - 1}
        onClick={() => setFs(FS_STEPS[idx + 1])}
        title="调大字号" aria-label="调大字号"
      >A+</button>
      <button
        className={`vbtn wide${dense ? ' on' : ''}`}
        onClick={() => setDense(!dense)}
        title={dense ? '当前：紧凑（点击恢复宽松）' : '当前：宽松（点击切换紧凑）'}
      >{dense ? '紧凑' : '宽松'}</button>
      <button
        className="vbtn wide"
        onClick={() => { setFs(16); setDense(false) }}
        title="恢复默认"
      >重置</button>
    </div>
  )
}

// ---------------- 新建部门弹窗（完整版：页面即可建、可选版式） ----------------
function NewDeptModal({ onClose, onCreate }: { onClose: () => void; onCreate: (payload: Partial<Org>) => void }) {
  const [name, setName] = useState('')
  const [archetype, setArchetype] = useState('task_x_slot')
  const [slots, setSlots] = useState<string[]>(['', ''])
  const [avoid, setAvoid] = useState(false)

  const setSlot = (i: number, v: string) =>
    setSlots((s) => s.map((x, j) => (j === i ? v : x)))
  const addSlot = () => setSlots((s) => [...s, ''])
  const removeSlot = (i: number) => setSlots((s) => s.filter((_, j) => j !== i))

  const submit = () => {
    const clean = slots.map((s) => s.trim()).filter(Boolean)
    if (!name.trim()) return alert('请填写部门名称')
    if (clean.length === 0) return alert('请至少填写一个「列」（如 西城 / 官渡）')
    const id = `dept_${Date.now().toString(36)}`
    onCreate({ id, name: name.trim(), archetype, slots: clean, slot_alias: {}, has_duty: false, avoid_self_college: avoid })
  }

  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">新建部门</div>
        <div className="modal-body">
          <label className="fld">
            <span>部门名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：认证部" />
          </label>
          <label className="fld">
            <span>版式原型</span>
            <select value={archetype} onChange={(e) => setArchetype(e.target.value)}>
              {ARCHETYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>
          <div className="fld">
            <span>列（每一件活的「格」标签，如 西城 / 官渡）</span>
            <div className="slot-edit">
              {slots.map((s, i) => (
                <div className="slot-row" key={i}>
                  <input value={s} onChange={(e) => setSlot(i, e.target.value)} placeholder={`列 ${i + 1}`} />
                  <button className="del" onClick={() => removeSlot(i)} disabled={slots.length <= 1} title="删除">×</button>
                </div>
              ))}
              <button className="btn ghost" onClick={addSlot}>+ 加一列</button>
            </div>
          </div>
          <label className="chk" style={{ marginTop: 10 }} title="认证部「不能查自己学院」这类角色冲突：开启后 college 与该活 scope 相同的助理被硬排除（不是不会干，是利益冲突）">
            <input type="checkbox" checked={avoid} onChange={(e) => setAvoid(e.target.checked)} />
            回避自己学院（角色冲突硬过滤）
          </label>
          <p className="hint" style={{ marginTop: 8 }}>
            派活型完全可用；排班 / 排期 / 招募型先以派活型网格呈现，后续按机构接入时再深化列维度。
          </p>
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>取消</button>
          <button className="btn primary" onClick={submit}>创建并进入</button>
        </div>
      </div>
    </div>
  )
}

// ---------------- 分支选择（部门下多工具入口） ----------------
function BranchView({
  orgName, onWorkbench, onWeb4, onBack,
}: {
  orgName: string
  onWorkbench: () => void
  onWeb4: () => void
  onBack: () => void
}) {
  return (
    <div className="branch">
      <header className="b-top">
        <button className="btn ghost l-back" onClick={onBack} title="返回部门选择">← 部门</button>
        <div className="b-brand">校素拓 · 工作安排平台</div>
      </header>
      <section className="b-hero">
        <div className="kicker">SUPT · {orgName}</div>
        <h1 className="b-title">请选择工作大类</h1>
        <p className="b-sub">
          质检部有两套工具：一套管「派活与官方安排表」，一套管「周工作自动化全流程」。选一个进入。
        </p>
      </section>
      <div className="b-grid">
        <button className="b-card" onClick={onWorkbench}>
          <div className="b-idx">A</div>
          <div className="b-name">工作安排类</div>
          <div className="b-desc">按校区派活 · 搭档制 · 一键导出官方安排表 · 周工作台账与平衡看板</div>
          <div className="b-enter">进入 →</div>
        </button>
        <button className="b-card web" onClick={onWeb4}>
          <div className="b-idx">B</div>
          <div className="b-name">质检部 Web 端</div>
          <div className="b-desc">周工作自动化：登记表拆分 / 二级学院安排 / 助理安排 / 台账 / 看板 / 说明</div>
          <div className="b-enter">打开 →</div>
        </button>
      </div>
    </div>
  )
}

// ---------------- Web 端嵌入（iframe，带健康检查提示） ----------------
function Web4View({
  url, onBack, orgName,
}: {
  url: string
  onBack: () => void
  orgName: string
}) {
  const [down, setDown] = useState(false)
  const [dismiss, setDismiss] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(url.replace(/\/$/, '') + '/api/health', { mode: 'cors' })
      .then((r) => { if (!r.ok) throw new Error('bad') })
      .catch(() => { if (alive) setDown(true) })
    return () => { alive = false }
  }, [url])

  return (
    <div className="web4">
      <header className="wf-top">
        <button className="btn ghost" onClick={onBack}>← 分支</button>
        <div className="wf-title">{orgName} · Web 端</div>
        <a className="btn ghost" href={url} target="_blank" rel="noreferrer" title="在新窗口打开">↗ 新窗口打开</a>
      </header>
      {down && !dismiss && (
        <div className="wf-warn">
          <span>未检测到「质检部 Web 端」服务（端口 8765）。请先运行 <b>04_Web端/启动.bat</b>，或点「↗ 新窗口打开」手动访问。</span>
          <button className="btn ghost" onClick={() => setDismiss(true)}>仍要打开</button>
        </div>
      )}
      <iframe className="wf-frame" src={url} title="质检部 Web 端" />
    </div>
  )
}

export default function App() {
  const [orgs, setOrgs] = useState<Org[]>([])
  const [deptId, setDeptId] = useState<string>('zjb')
  const [orgName, setOrgName] = useState('')
  const [archetype, setArchetype] = useState('task_x_slot')
  const [slots, setSlots] = useState<string[]>(['西城', '官渡'])
  const [slotAlias, setSlotAlias] = useState<Record<string, string>>({})

  const [people, setPeople] = useState<Person[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [week, setWeek] = useState(11)
  const [assign, setAssign] = useState<Assign>({})
  const [locked, setLocked] = useState<Assign>({})
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [needConfirm, setNeedConfirm] = useState<{ task_id: string; task: string; names: string[] }[]>([])
  const [load, setLoad] = useState<Record<string, number>>({})
  const [campusLoad, setCampusLoad] = useState<Record<string, number>>({})
  const [explain, setExplain] = useState<Explain>({})
  const [shake, setShake] = useState(0)
  const [ledger, setLedger] = useState<Record<string, Record<string, string[]>>>({})
  const [prevWeek, setPrevWeek] = useState<Record<string, string[]>>({})
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPool, setShowPool] = useState(false)
  const [dutyDaily, setDutyDaily] = useState<Record<string, Record<string, string[]>>>({})
  const [showNewDept, setShowNewDept] = useState(false)
  const [view, setView] = useState<'landing' | 'branch' | 'workbench' | 'web4' | 'assist'>('landing')

  // ---------------- 分区：管理层 / 小助理 ----------------
  const [role, setRole] = useState<'manage' | 'assist'>('manage')
  const [assistDept, setAssistDept] = useState('zjb')
  const [manageKey, setManageKey] = useState(() => localStorage.getItem('zjb_manage_key') || '')
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [pendingDept, setPendingDept] = useState('zjb')
  const [keyInput, setKeyInput] = useState('')
  const [keyErr, setKeyErr] = useState('')
  const [showKeySettings, setShowKeySettings] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newKey2, setNewKey2] = useState('')
  const [settingsErr, setSettingsErr] = useState('')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importWeek, setImportWeek] = useState<string>(String(week))
  const [importPreview, setImportPreview] = useState<any>(null)
  const [importErr, setImportErr] = useState<string>('')

  // 管理层口令同步给 api（只读的小助理接口不带它）
  useEffect(() => { setApiKey(manageKey) }, [manageKey])


  const say = useCallback((m: string) => {
    setToast(m)
    setTimeout(() => setToast(''), 2200)
  }, [])

  const loadOrg = useCallback(async (id: string) => {
    const b = await api.bootstrap(id)
    setDeptId(id)
    setOrgName(b.org_name)
    setArchetype(b.archetype)
    setSlots(b.slots)
    setSlotAlias(b.slot_alias || {})
    setPeople(b.people)
    setTasks(b.tasks)
    setWeek(b.week)
    setLedger(b.ledger?.weeks || {})
    setPrevWeek(b.prev_week || {})
    setDutyDaily(b.duty_daily || {})
    setAssign({})
    setLocked({})
    setExplain({})
  }, [say])

  // 进入工作台（管理层）：未持有口令则弹出口令框，验证通过才进
  const goWorkbench = useCallback(async (id: string) => {
    if (!manageKey) {
      setPendingDept(id)
      setKeyInput('')
      setKeyErr('')
      setShowKeyModal(true)
      return
    }
    try {
      await loadOrg(id)
      setView('workbench')
    } catch (e: any) {
      say('进入失败：' + e.message)
    }
  }, [manageKey, loadOrg, say])

  // 进入某个部门：有独立 Web 端的（如质检部）先弹分支选择；其余直接进工作台
  const enterDept = useCallback(async (id: string) => {
    if (WEB_APPS[id]) {
      setDeptId(id)
      setView('branch')
      return
    }
    await goWorkbench(id)
  }, [goWorkbench])

  // 口令校验：通过则记住并进入工作台
  const submitKey = useCallback(async () => {
    setApiKey(keyInput)
    try {
      await api.checkKey()
      setManageKey(keyInput)
      localStorage.setItem('zjb_manage_key', keyInput)
      setShowKeyModal(false)
      await goWorkbench(pendingDept)
    } catch (e: any) {
      setApiKey('')
      setKeyErr('口令错误，或服务器未启动')
    }
  }, [keyInput, pendingDept, goWorkbench])

  // 修改管理口令（已登录状态下）
  const submitNewKey = useCallback(async () => {
    if (newKey !== newKey2) { setSettingsErr('两次输入不一致'); return }
    try {
      await api.saveManageKey(newKey)
      setManageKey(newKey)
      localStorage.setItem('zjb_manage_key', newKey)
      setShowKeySettings(false)
      say('管理口令已更新')
    } catch (e: any) { setSettingsErr('修改失败：' + e.message) }
  }, [newKey, newKey2, say])

  // 初始进入落地页：只拉部门清单（不自动进某个部门）
  useEffect(() => {
    api.orgs()
      .then((r) => setOrgs(r.orgs))
      .catch((e) => say('加载失败：' + e.message))
  }, [say])

  const nameOf = useMemo(() => {
    const m: Record<string, string> = {}
    people.forEach((p) => (m[p.id] = p.name))
    return m
  }, [people])

  const groups = useMemo(() => groupByCampus(people), [people])

  const doAssign = useCallback(async (keepLocked: boolean) => {
    setBusy(true)
    try {
      const s = keepLocked ? shake + 1 : 0
      setShake(s)
      const r: AssignResult = await api.assign(deptId, week, s, keepLocked ? locked : {})
      setAssign(r.assign)
      setWarnings(r.warnings)
      setLoad(r.load)
      setCampusLoad(r.campus_load || {})
      setNeedConfirm(r.need_confirm || [])
      setExplain(r.explain || {})
      if (!keepLocked) setLocked({})
      const n = Object.values(r.assign)
        .reduce((s, row) => s + Object.values(row || {}).reduce((a, v) => a + (v || []).length, 0), 0)
      say(keepLocked ? `已重摇（第 ${s} 次），保留 ${Object.keys(locked).length} 项锁定` : `已分配 ${n} 人次`)
    } catch (e: any) {
      say('分配失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }, [deptId, week, locked, shake, say])

  const pick = (taskId: string, campus: string, pid: string) => {
    const row = assign[taskId] || {}
    const cur = row[campus] || []
    const has = cur.includes(pid)
    const next = has ? cur.filter((x) => x !== pid) : [...cur, pid]
    const nextRow: Assign[string] = { ...row }
    nextRow[campus] = next
    if (!next.length) delete nextRow[campus]
    const nextAssign: Assign = { ...assign, [taskId]: nextRow }
    if (!Object.keys(nextRow).length) delete nextAssign[taskId]
    setAssign(nextAssign)

    const rowLock: Assign[string] = { ...(locked[taskId] || {}) }
    rowLock[campus] = next
    if (!next.length) delete rowLock[campus]
    const nextLocked: Assign = { ...locked, [taskId]: rowLock }
    if (!Object.keys(rowLock).length) delete nextLocked[taskId]
    setLocked(nextLocked)

    setExplain((prev) => {
      const row = prev[taskId]
      if (!row || !row[campus]) return prev
      const nextRow = { ...row }
      delete nextRow[campus]
      return { ...prev, [taskId]: nextRow }
    })
  }

  const toggleLock = (taskId: string) => {
    if (locked[taskId]) {
      const l: Assign = { ...locked }
      delete l[taskId]
      setLocked(l)
    } else {
      const row = assign[taskId] || {}
      if (!Object.keys(row).length) return say('这一项还没派人，先点名字再加锁')
      setLocked({ ...locked, [taskId]: { ...row } })
    }
  }

  const copyText = async () => {
    if (!hasResult) return say('还没有分配结果')
    const lines: string[] = [`【${orgName}第${week}周工作安排】`]
    tasks.forEach((t, i) => {
      const row = assign[t.id] || {}
      const parts = slots
        .map((c) => ({ c, ns: (row[c] || []).map((pid) => nameOf[pid] || pid).filter(Boolean) }))
        .filter((x) => x.ns.length > 0)
        .map((x) => `${x.c} ${x.ns.join('、')}`)
      lines.push(`${i + 1}. ${t.name}｜${parts.join('｜') || '未派'}`)
    })
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      say('文字版已复制，可直接粘贴到微信群')
    } catch {
      say('复制失败：浏览器不允许，请手动复制')
    }
  }

  const commit = async () => {
    setBusy(true)
    try {
      await api.commit(deptId, week, assign)
      const b = await api.bootstrap(deptId)
      setLedger(b.ledger?.weeks || {})
      setPrevWeek(b.prev_week || {})
      say(`第${week}周已存入台账，下周会自动避开重复`)
    } catch (e: any) {
      say('保存失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const askClearWeek = () => {
    if (!ledger[String(week)]) return
    setShowClearConfirm(true)
  }

  const onImportPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setImportFile(f)
    setImportPreview(null)
    setImportErr('')
    previewImport(f)
  }

  const previewImport = async (file: File) => {
    setBusy(true)
    try {
      const r = await api.importHistory(deptId, Number(importWeek) || week, file, false)
      setImportPreview(r)
      setImportErr('')
    } catch (e: any) {
      setImportPreview(e)
      setImportErr(e.message || '解析失败')
    } finally {
      setBusy(false)
    }
  }

  const doImportHistory = async () => {
    if (!importFile) return
    setBusy(true)
    try {
      await api.importHistory(deptId, Number(importWeek) || week, importFile, true)
      const b = await api.bootstrap(deptId)
      setLedger(b.ledger?.weeks || {})
      setAssign(b.ledger?.weeks?.[String(importWeek)] ? {} : assign)
      say(`第${importWeek}周历史表已导入台账`)
      setShowImportModal(false)
      setImportFile(null)
      setImportPreview(null)
      setImportErr('')
    } catch (e: any) {
      setImportErr(e.message || '导入失败')
    } finally {
      setBusy(false)
    }
  }

  const confirmClearWeek = async () => {
    setShowClearConfirm(false)
    setBusy(true)
    try {
      await api.clearWeek(deptId, week)
      const b = await api.bootstrap(deptId)
      setLedger(b.ledger?.weeks || {})
      say(`第${week}周台账已撤销`)
    } catch (e: any) {
      say('撤销失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const doExport = async () => {
    if (!hasResult) return say('还没有分配结果')
    setBusy(true)
    try {
      await api.exportXlsx(deptId, week, assign)
      say('已导出 xlsx')
    } catch (e: any) {
      say('导出失败：' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const savePeople = async () => {
    await api.savePeople(deptId, people)
    say('人员已保存')
  }
  const saveTasks = async () => {
    await api.saveTasks(deptId, tasks)
    say('工作内容已保存')
  }

  const onCreateDept = async (payload: Partial<Org>) => {
    try {
      await api.createOrg(payload)
      const r = await api.orgs()
      setOrgs(r.orgs)
      setShowNewDept(false)
      await loadOrg(payload.id!)
      say(`已创建「${payload.name}」并进入`)
    } catch (e: any) {
      say('创建失败：' + e.message)
    }
  }

  const hasResult = Object.keys(assign).length > 0
  const lockedCount = Object.keys(locked).length
  const slotText = slots.join('、')
  const curOrgName = orgs.find((o) => o.id === deptId)?.name || orgName || '质检部'

  return (
    <>
      {showNewDept && <NewDeptModal onClose={() => setShowNewDept(false)} onCreate={onCreateDept} />}

      {showKeyModal && (
        <div className="modal-mask" onClick={() => setShowKeyModal(false)}>
          <div className="modal key-modal" onClick={(e) => e.stopPropagation()}>
            <h3>管理层口令</h3>
            <p className="m-sub">输入管理口令才能进入派活界面。小助理没有口令，无法进入或改派。</p>
            <input
              type="password" autoFocus value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitKey() }}
              placeholder="请输入管理口令"
            />
            {keyErr && <div className="m-err">{keyErr}</div>}
            <div className="m-actions">
              <button className="btn ghost" onClick={() => setShowKeyModal(false)}>取消</button>
              <button className="btn primary" onClick={submitKey}>进入</button>
            </div>
            <p className="m-tip">默认口令为 <b>sutuo</b>，首次使用请在下方「修改口令」中改掉。</p>
          </div>
        </div>
      )}

      {showKeySettings && (
        <div className="modal-mask" onClick={() => setShowKeySettings(false)}>
          <div className="modal key-modal" onClick={(e) => e.stopPropagation()}>
            <h3>修改管理口令</h3>
            <p className="m-sub">新口令保护派活 / 提交 / 导出等接口。留空 = 重置为默认口令。</p>
            <input type="password" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="新口令" />
            <input type="password" value={newKey2} onChange={(e) => setNewKey2(e.target.value)} placeholder="再次输入新口令" />
            {settingsErr && <div className="m-err">{settingsErr}</div>}
            <div className="m-actions">
              <button className="btn ghost" onClick={() => setShowKeySettings(false)}>取消</button>
              <button className="btn primary" onClick={submitNewKey}>保存</button>
            </div>
          </div>
        </div>
      )}

      {showClearConfirm && (
        <div className="modal-mask" onClick={() => setShowClearConfirm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>确认撤销台账？</h3>
            <p className="m-sub">
              第 <b>{week}</b> 周的台账将被删除，且无法恢复。<br />
              小助理的「本周我负责」也会同步清空。
            </p>
            <div className="m-actions">
              <button className="btn ghost" onClick={() => setShowClearConfirm(false)}>取消</button>
              <button className="btn primary" onClick={confirmClearWeek}>确认删除</button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-mask" onClick={() => setShowImportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(560px, 92vw)' }}>
            <h3>导入历史安排表</h3>
            <p className="m-sub">
              上传像「质检部第 7 周工作安排表」这样的历史 xlsx，自动恢复台账和「本周我负责」。
              表头需包含 <b>西城 / 官渡</b>，第一列为工作内容。
            </p>
            <div className="modal-body" style={{ gap: 12 }}>
              <div>
                <label>目标周次</label>
                <input
                  className="narrow" type="number" value={importWeek}
                  onChange={(e) => { setImportWeek(e.target.value); setImportPreview(null) }}
                  style={{ width: 90, marginLeft: 8 }}
                />
                <span className="small muted" style={{ marginLeft: 8 }}>会从标题自动识别，也可手动指定</span>
              </div>
              <div>
                <input
                  type="file" accept=".xlsx,.xls" id="import-history-input"
                  hidden onChange={onImportPick}
                />
                <label htmlFor="import-history-input" className="btn">
                  {importFile ? importFile.name : '选择 xlsx'}
                </label>
              </div>

              {importPreview && (
                <div>
                  {importPreview.ok === false && (
                    <div className="m-err" style={{ marginBottom: 8 }}>
                      以下名字/任务在系统里找不到，强行导入会跳过它们：
                      {importPreview.unmatched_names?.length > 0 && (
                        <div>未匹配人名：{importPreview.unmatched_names.join('、')}</div>
                      )}
                      {importPreview.unmatched_tasks?.length > 0 && (
                        <div>未匹配任务：{importPreview.unmatched_tasks.join('、')}</div>
                      )}
                    </div>
                  )}
                  {importPreview.ok !== false && (
                    <div className="alert alert-ok" style={{ marginBottom: 8 }}>
                      识别到第 {importPreview.detected_week ?? importPreview.week} 周，共 {Object.keys(importPreview.committed || {}).length} 条任务分配。
                    </div>
                  )}
                </div>
              )}
              {importErr && <div className="m-err">{importErr}</div>}
            </div>
            <div className="m-actions">
              <button className="btn ghost" onClick={() => setShowImportModal(false)}>取消</button>
              <button className="btn" onClick={() => importFile && previewImport(importFile)} disabled={busy || !importFile}>
                重新解析
              </button>
              <button className="btn primary" onClick={doImportHistory} disabled={busy || !importFile}>确认导入</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
      {view === 'landing' ? (
        <Landing
          orgs={orgs}
          onEnter={enterDept}
          onNewDept={() => setShowNewDept(true)}
          role={role}
          onRole={setRole}
          onAssistEnter={(id) => { setAssistDept(id); setView('assist') }}
        />
      ) : view === 'branch' ? (
        <BranchView
          orgName={curOrgName}
          onWorkbench={() => goWorkbench(deptId)}
          onWeb4={() => setView('web4')}
          onBack={() => setView('landing')}
        />
      ) : view === 'assist' ? (
        <AssistantView deptId={assistDept} onBack={() => setView('landing')} />
      ) : view === 'web4' ? (
        <Web4View url={WEB_APPS[deptId]!} orgName={curOrgName} onBack={() => setView('branch')} />
      ) : (
      <>
      <header className="topbar">
        <div className="brand">
          校素拓 · 工作安排台
          <small>SUPT · WEEKLY ROSTER</small>
        </div>
        {view === 'workbench' && (
          <button className="btn ghost l-back" onClick={() => (WEB_APPS[deptId] ? setView('branch') : setView('landing'))} title="返回部门选择">← 部门</button>
        )}
        {view === 'workbench' && (
          <button className="btn ghost" onClick={() => { setNewKey(''); setNewKey2(''); setSettingsErr(''); setShowKeySettings(true) }} title="修改保护派活/提交/导出的口令">修改口令</button>
        )}
        <div className="deptsel">
          <label>部门</label>
          <select value={deptId} onChange={(e) => {
            const id = e.target.value
            if (WEB_APPS[id]) { setDeptId(id); setView('branch') }
            else loadOrg(id).catch((er: any) => say('切换失败：' + er.message))
          }}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <button className="btn ghost" onClick={() => setShowNewDept(true)} title="新建部门（可选版式）">+ 新建</button>
        </div>
        <div className="spacer" />
        <ViewControls />
        <div className="weekno">
          <label>周次</label>
          <input
            className="narrow" type="number" value={week}
            onChange={(e) => setWeek(Number(e.target.value) || 1)}
          />
        </div>
        <span className="stamp">构建 {__BUILD_STAMP__}</span>
      </header>

      <div className="wrap">
        {/* ---------------- 操作 */}
        <section className="sec">
          <div className="sec-h">
            <span className="num">01</span>
            <h2>分配本周工作</h2>
            <span className="hint">
              规则：每件活<b>{slotText} 各派一人</b> · 主校区人优先，机动人员补缺 ·
              从没轮到过的人优先 · 同一件活不连着两周同一人
            </span>
            <span className="spacer" />
          </div>
          <div className="bar">
            <button className="btn primary" onClick={() => doAssign(false)} disabled={busy}>
              {hasResult ? '重新随机' : '一键随机分配'}
            </button>
            <button className="btn" onClick={() => doAssign(true)} disabled={busy || !hasResult}>
              保留锁定项重摇
            </button>
            <button className="btn" onClick={copyText} disabled={busy || !hasResult}>复制文字版</button>
            <button className="btn" onClick={commit} disabled={busy || !hasResult}>存入台账</button>
            <button className="btn ghost" onClick={askClearWeek} disabled={busy || !ledger[String(week)]}>
              撤销本周台账
            </button>
            <button className="btn" onClick={() => setShowImportModal(true)} disabled={busy}>导入历史表</button>
            <button className="btn" onClick={doExport} disabled={busy || !hasResult}>导出 xlsx</button>
            <button className="btn ghost" onClick={() => setShowPool(!showPool)}>
              {showPool ? '收起' : '编辑人员与工作内容'}
            </button>
          </div>

          {warnings.length > 0 && (
            <div className="warn">
              <b>需要人工看一眼（{warnings.length}）</b>
              <ul>{warnings.map((w, i) => <li key={i}>{w.text}</li>)}</ul>
            </div>
          )}
        </section>

        {/* ---------------- 领导层（监督，不接活） */}
        <section className="sec">
          <div className="sec-h">
            <span className="num">02</span>
            <h2>领导层 · 只监督不派活</h2>
            <span className="hint">工作由部长安排给助理，这里只做监督与确认</span>
          </div>
          <div className="leaders">
            {people.filter((p) => p.role !== 'assist').map((p) => (
              <div className="leadcard" key={p.id}>
                <div className="top">
                  <input
                    className="name" value={p.name}
                    onChange={(e) => setPeople(people.map((x) => x.id === p.id ? { ...x, name: e.target.value } : x))}
                  />
                  <span className={`role ${p.role}`}>{ROLE_LABEL[p.role]}</span>
                </div>
                <div className="meta">{p.campus || '—'}</div>
              </div>
            ))}
          </div>
          {needConfirm.length > 0 && (
            <div className="confirm">
              <b>需领导签字后生效（{needConfirm.length}）</b>
              <ul>
                {needConfirm.map((c) => (
                  <li key={c.task_id}>
                    「{c.task}」→ {c.names.join('、') || '未派'}
                    <span className="hint"> 导出表按官方版式不标红，此处仅提示</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* ---------------- 助理 */}
        <section className="sec">
          <div className="sec-h">
            <span className="num">03</span>
            <h2>助理轮值与负载</h2>
            <span className="hint">
              共 {groups.assistCount} 名助理参与轮值
              {hasResult && ` · 本周 ${Object.values(campusLoad).reduce((s, v) => s + v, 0)} 个人次`}
              {lockedCount > 0 && ` · ${lockedCount} 项已锁定`}
            </span>
          </div>
          {Object.entries(groups.byCampus).map(([campus, rows]) => (
            <div key={campus} style={{ marginBottom: 14 }}>
              <div className="grouptitle">
                <span>{campus}</span>
                <span className="hint">
                  {rows.length} 人{slotAlias[campus] && `（归入 ${slotAlias[campus]}）`}
                  {hasResult && campusLoad[campus] !== undefined && ` · 本周 ${campusLoad[campus]} 件`}
                </span>
              </div>
              <PersonGroup
                rows={rows}
                assign={assign}
                hasResult={hasResult}
                tasks={tasks}
                slots={slots}
                slotAlias={slotAlias}
                onRename={(id, name) => setPeople(people.map((x) => x.id === id ? { ...x, name } : x))}
              />
            </div>
          ))}
        </section>

        {/* ---------------- 分配结果 */}
        <section className="sec">
          <div className="sec-h">
            <span className="num">04</span>
            <h2>工作安排</h2>
            <span className="hint">
              按官方表版式：每件工作<b>{slotText} 各派一人</b>，<b>同一格可以加人搭档</b>。
              点「加人」往格子里放人，点已选名字移出；改动会自动锁定，重摇时锁定项不动。
              <b>鼠标悬停姓名可看「为什么是他」</b>
            </span>
          </div>
          <div className="assign">
            <div className="arow head">
              <div>#</div><div>工作内容</div>
              {slots.map((c) => <div key={c}>{c}</div>)}
              <div>锁定</div>
            </div>
            {tasks.map((t, i) => {
              const isLock = !!locked[t.id] && Object.keys(locked[t.id] || {}).length > 0
              return (
                <div className={`arow${isLock ? ' locked' : ''}`} key={t.id}>
                  <div style={{ color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{i + 1}</div>
                  <div className="tname">
                    <span className="txt">{t.name}</span>
                    {t.tag === 'heavy' && <span className="tag heavy">需拍板</span>}
                  </div>
                  {slots.map((campus) => (
                    <div className="pick-cell" key={campus}>
                      <Piker
                        people={people}
                        campus={campus}
                        cur={(assign[t.id] || {})[campus] || []}
                        onPick={(pid) => pick(t.id, campus, pid)}
                        why={explain[t.id]?.[campus]}
                        slots={slots}
                        slotAlias={slotAlias}
                      />
                    </div>
                  ))}
                  <div className="lock-cell">
                    <button className={`lockbtn${isLock ? ' on' : ''}`} onClick={() => toggleLock(t.id)}>
                      {isLock ? '已锁定' : '锁定'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ---------------- 值班检查（只读参考，不进导出表） */}
        {Object.keys(dutyDaily).length > 0 && (
          <section className="sec">
            <div className="sec-h">
              <span className="num">05</span>
              <h2>值班检查</h2>
              <span className="hint">
                校素拓 2026-2027 学年第一学期值班表，按天汇总（当日各节次合并）·
                <b>值班表一学期固定，导出表不重复抄写，这里只作查询参考</b>
              </span>
            </div>
            <div className="dutytable">
              <div className="dutyhead">
                <div className="h">周次</div>
                {Object.keys(dutyDaily).map((c) => (
                  <div className="h" key={c}>{c}（{Object.values(dutyDaily[c] || {}).reduce((s, v) => s + v.length, 0)}人次）</div>
                ))}
              </div>
              {['周一', '周二', '周三', '周四', '周五'].map((d) => (
                <div className="dutyrow" key={d}>
                  <div className="d">{d}</div>
                  {Object.keys(dutyDaily).map((c) => (
                    <div className="p" key={c}>
                      {(dutyDaily[c]?.[d] || []).length > 0
                        ? (dutyDaily[c][d] || []).join('、')
                        : '—'}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ---------------- 周工作台账（常驻查看） */}
        <section className="sec">
          <div className="sec-h">
            <span className="num">06</span>
            <h2>周工作台账</h2>
            <span className="hint">
              记录每周谁做了什么。可切「按周看」（第X周 → 各人任务）或「按人看」（每人 → 各周累计，便于看轮值是否均衡）
            </span>
          </div>
          <LedgerView ledger={ledger} nameOf={nameOf} people={people} week={week} />
        </section>

        {/* ---------------- 编辑池 */}
        {showPool && (
          <>
            <section className="sec">
              <div className="sec-h">
                <span className="num">07</span>
                <h2>人员池</h2>
                <span className="hint">
                  「可派」勾选能干哪几列（<b>不勾 = 只干主校区</b>）；
                  取消「启用」= 停用（人员流动时保留名单、不参与派活）
                </span>
                <span className="spacer" />
                <button className="btn" onClick={savePeople}>保存人员</button>
              </div>
              <div className="pool">
                {people.map((p, i) => {
                  const off = p.active === false
                  const cds = p.can_do || []
                  return (
                    <div className={`prow${off ? ' off' : ''}`} key={p.id}>
                      <select
                        value={p.role}
                        onChange={(e) => setPeople(people.map((x, j) => j === i ? { ...x, role: e.target.value as any } : x))}
                        style={{ border: '1px solid var(--line-2)', background: 'var(--paper-2)', padding: '6px' }}
                      >
                        <option value="lead">部长</option>
                        <option value="deputy">副部长</option>
                        <option value="assist">助理</option>
                      </select>
                      <input
                        type="text" value={p.name}
                        onChange={(e) => setPeople(people.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      />
                      {p.role === 'assist' && (
                        <select
                          value={p.campus || '未分组'}
                          onChange={(e) => setPeople(people.map((x, j) => j === i ? { ...x, campus: e.target.value } : x))}
                          style={{ border: '1px solid var(--line-2)', background: 'var(--paper-2)', padding: '6px' }}
                          title="主校区（派活时按 slot_alias 归并）"
                        >
                          {slots.map((c) => <option key={c} value={c}>{c}</option>)}
                          <option value="未分组">未分组</option>
                        </select>
                      )}
                      {p.role === 'assist' && (
                        <span className="cando">
                          {slots.map((c) => {
                            const fallback = cds.length === 0 && dutyCampus(p, slotAlias, slots) === c
                            return (
                              <label
                                key={c} className="chk"
                                title={fallback ? '主校区默认可派（can_do 为空 = 只干主校区）' : `可派${c}列`}
                              >
                                <input
                                  type="checkbox"
                                  checked={fallback || cds.includes(c)}
                                  disabled={fallback}
                                  onChange={(e) => {
                                    const base = cds.length ? cds : [dutyCampus(p, slotAlias, slots)]
                                    const next = e.target.checked
                                      ? Array.from(new Set([...base, c]))
                                      : base.filter((x) => x !== c)
                                    setPeople(people.map((x, j) => j === i ? { ...x, can_do: next } : x))
                                  }}
                                />{c}
                              </label>
                            )
                          })}
                        </span>
                      )}
                      {p.role === 'assist' && (
                        <input
                          type="text" value={p.college || ''}
                          placeholder="所属学院"
                          onChange={(e) => setPeople(people.map((x, j) => j === i ? { ...x, college: e.target.value } : x))}
                          style={{ width: 92, border: '1px solid var(--line-2)', background: 'var(--paper-2)', padding: '6px' }}
                          title="所属学院（开启「回避自己学院」的部门：college 与该活 scope 相同则不被派）"
                        />
                      )}
                      <label className="chk" title="停用后保留名单，但不参与派活">
                        <input
                          type="checkbox" checked={!off}
                          onChange={(e) => setPeople(people.map((x, j) => j === i ? { ...x, active: e.target.checked } : x))}
                        />启用
                      </label>
                      <button className="del" onClick={() => setPeople(people.filter((_, j) => j !== i))} title="删除">×</button>
                    </div>
                  )
                })}
                <button
                  className="btn ghost"
                  onClick={() => setPeople([...people, { id: `u_${Date.now()}`, name: '新人', role: 'assist', campus: slots[0], active: true, can_do: [] } as Person])}
                >+ 加一人</button>
              </div>
            </section>

            <section className="sec">
              <div className="sec-h">
                <span className="num">08</span>
                <h2>工作内容池</h2>
                <span className="hint">A 列顺序 = 导出表行序；「需拍板」只在页面提示领导签字，不影响导出</span>
                <span className="spacer" />
                <button className="btn" onClick={saveTasks}>保存工作内容</button>
              </div>
              <div className="pool">
                {tasks.map((t, i) => (
                  <div className="prow" key={t.id}>
                    <input
                      type="text" value={t.name}
                      onChange={(e) => setTasks(tasks.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                    />
                    <label className="chk">
                      <input
                        type="checkbox" checked={t.tag === 'heavy'}
                        onChange={(e) => setTasks(tasks.map((x, j) => j === i ? { ...x, tag: e.target.checked ? 'heavy' : 'routine' } : x))}
                      />需拍板
                    </label>
                    <input
                      type="text" value={t.scope || ''}
                      placeholder="针对学院"
                      onChange={(e) => setTasks(tasks.map((x, j) => j === i ? { ...x, scope: e.target.value } : x))}
                      style={{ width: 92, border: '1px solid var(--line-2)', background: 'var(--paper-2)', padding: '6px' }}
                      title="该活针对的学院（开启「回避自己学院」的部门：college 相同的助理不被派）"
                    />
                    <button className="del" onClick={() => setTasks(tasks.filter((_, j) => j !== i))} title="删除">×</button>
                  </div>
                ))}
                <button
                  className="btn ghost"
                  onClick={() => setTasks([...tasks, { id: `t_${Date.now()}`, name: '新工作', tag: 'routine' } as Task])}
                >+ 加一项</button>
              </div>
            </section>
          </>
        )}

        <div className="foot">
          <div><b>怎么用：</b>① 顶栏选「部门」进入对应工作台（可点「+ 新建」自建部门、选版式）；② 点「一键随机分配」（每件活自动填好各列）③ 不满意点「加人」改派，<b>同一格可加多人搭档</b>（点已选名字移出）；改动自动锁定，重摇不动 ④ 满意后「复制文字版」发群里，或「存入台账」让下周避开重复 ⑤ 「导出 xlsx」版式对齐官方安排表。</div>
          <div><b>职责边界：</b>活全部派给<b>助理</b>；部长与副部长只做监督，不接活。标「需拍板」的活照派给助理执行，页面会提示需领导签字后生效。</div>
          <div><b>列怎么算：</b>每列是一个「格」（如 西城 / 官渡 / 各校级组织）；主校区按机构规则归并（如 光华归入官渡）。某列没人可派时，去人员池把某人的「可派」勾上该列。</div>
          <div><b>人员流动：</b>换校区、加人、停用都在「编辑人员与工作内容」里改，保存即可生效；<b>停用的人保留名单、不参与派活</b>，随时可以重新启用。</div>
          <div><b>轮值规则：</b>从没轮到过的人优先；同一件活不会<b>连着两周</b>派给同一批人；同一人单周件数尽量均衡。</div>
        </div>
      </div>

      </>)}
    </>
  )
}
