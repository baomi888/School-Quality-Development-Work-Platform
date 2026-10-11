export type Role = 'lead' | 'deputy' | 'assist'

export interface Person {
  id: string
  name: string
  role: Role
  order?: number
  active?: boolean
  campus?: string
  // 可派列：能干哪几列（空 = 只干主校区）
  can_do?: string[]
  // 分管单位（包干制输入数据，内核不读）
  units?: string[]
  // 所属学院（认证部回避用：college == 活.scope 时被硬排除）
  college?: string
  label?: string
  assigned?: string[]
  count?: number
  last_week?: string[]
}

export interface Task {
  id: string
  name: string
  tag: 'heavy' | 'routine'
  assignees?: string[]
  locked?: boolean
  note?: string
  // 该活针对的学院（认证部回避用：非空时排除 college 相同的助理）
  scope?: string
}

export interface Warning { task: string; kind: string; text: string }

// 排序链上的一级：规则名 + 这一级他的取值 + 人话
export interface ExplainLevel {
  level: string
  value: number
  note: string
}
// 「为什么是他」：一格的分配理由（逐级比较，不是加权求和，所以没有"总分"）
export interface ExplainCell {
  picked: string
  picked_name: string
  detail: string
  candidates: number
  tied: number
  chain: ExplainLevel[]
  runner_up: { name: string; gap: number; note: string } | null
}

// 通用「列标签」（质检部=西城/官渡；认证部=各校级组织；…）
export type Assign = Record<string, Partial<Record<string, string[]>>>
export type Explain = Record<string, Partial<Record<string, ExplainCell>>>

export interface Org {
  id: string
  name: string
  archetype: string
  slots: string[]
  slot_alias?: Record<string, string>
  export?: Record<string, any>
  assist_block?: Record<string, string[]>
  has_duty?: boolean
  // 回避开关：认证部「不能查自己学院」这类角色冲突的硬过滤
  avoid_self_college?: boolean
  stats?: {
    people: number
    assists: number
    tasks: number
    weeks_stored: number
    last_week: number | null
  }
}

export interface Bootstrap {
  org_id: string
  org_name: string
  archetype: string
  slots: string[]
  slot_alias: Record<string, string>
  week: number
  people: Person[]
  tasks: Task[]
  duty_daily: Record<string, Record<string, string[]>>
  campus_assist: Record<string, string[]>
  ledger: { weeks: Record<string, Record<string, string[]>> }
  role_label: Record<string, string>
  prev_week: Record<string, string[]>
  history_load: Record<string, number>
}

export interface AssignResult {
  ok: boolean
  week: number
  assign: Assign
  load: Record<string, number>
  campus_load?: Record<string, number>
  warnings: Warning[]
  need_confirm?: { task_id: string; task: string; assignees: string[]; names: string[] }[]
  leaders?: Person[]
  people: Person[]
  tasks: Task[]
  explain?: Explain | null
  shake?: number
}

const BASE = ''

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try { msg = (await res.json()).detail || msg } catch { /* 保持默认 */ }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  orgs: () => req<{ orgs: Org[] }>('/api/orgs'),
  createOrg: (payload: Partial<Org>) =>
    req<{ ok: boolean; org: Org }>('/api/orgs', {
      method: 'POST', body: JSON.stringify(payload),
    }),
  bootstrap: (dept: string) =>
    req<Bootstrap>(`/api/bootstrap?dept=${encodeURIComponent(dept)}`),
  savePeople: (dept: string, rows: Person[]) =>
    req<{ ok: boolean; rows: Person[] }>(`/api/people?dept=${encodeURIComponent(dept)}`, {
      method: 'POST', body: JSON.stringify({ rows }),
    }),
  saveTasks: (dept: string, rows: Task[]) =>
    req<{ ok: boolean; rows: Task[] }>(`/api/tasks?dept=${encodeURIComponent(dept)}`, {
      method: 'POST', body: JSON.stringify({ rows }),
    }),
  // shake = 重摇次数。0 表示「这一周的标准排法」；重摇时递增，
  // 保证同一周同样输入永远排出同一张表（可复现），但重摇确实会换一批人。
  assign: (dept: string, week: number, seed: number | null, locked: Assign, explain = true) =>
    req<AssignResult>(`/api/assign?dept=${encodeURIComponent(dept)}`, {
      method: 'POST',
      body: JSON.stringify({ week, seed, locked, explain }),
    }),
  commit: (dept: string, week: number, assign: Assign) =>
    req<{ ok: boolean }>(`/api/commit?dept=${encodeURIComponent(dept)}`, {
      method: 'POST', body: JSON.stringify({ week, assign }),
    }),
  clearWeek: (dept: string, week: number) =>
    req<{ ok: boolean }>(`/api/clear-week?dept=${encodeURIComponent(dept)}`, {
      method: 'POST', body: JSON.stringify({ week, assign: {} }),
    }),
  async exportXlsx(dept: string, week: number, assign: Assign) {
    const res = await fetch(BASE + `/api/export?dept=${encodeURIComponent(dept)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ week, assign }),
    })
    if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`)
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `工作安排表_第${week}周.xlsx`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  },
}
