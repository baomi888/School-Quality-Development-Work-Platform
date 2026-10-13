// 引擎接口封装。后期部署到服务器：把 API_BASE 改成服务器地址即可（如 https://your-server/api）
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''

export interface Activity {
  row: number
  no?: string
  name?: string
  host_college?: string
  time?: string
  campus?: string
  place?: string
  level?: string
}

export interface FileRef {
  id: string
  name: string
  kind: string
  campus?: string
  week?: number | null
  rows?: number
  empty?: boolean
}

export interface TableInfo {
  week: number | null
  campuses: string[]
  activity_count: number
  activities: Activity[]
}

export interface Recommend {
  week: number | null
  last_week_checkers: string[]
  last_week_records: string[]
  host_colleges: string[]
  candidates: { college: string; last_week: boolean; host_this_week: boolean }[]
  available_now: string[]
  suggested_pool_size: number
  rule_note: string
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API_BASE + path, init)
  const text = await res.text()
  let data: any = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    const msg = data?.detail?.message ?? data?.detail ?? res.statusText
    const problems: string[] = data?.detail?.problems ?? []
    const alternatives: string[] = data?.detail?.alternatives ?? []
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)) as Error & {
      problems?: string[]
      alternatives?: string[]
      status?: number
    }
    err.problems = problems
    err.alternatives = alternatives
    err.status = res.status
    throw err
  }
  return data as T
}

export const api = {
  health: () => req<{ ok: boolean; term: string; colleges: string[]; campuses: string[]; ledger_file: string }>('/api/health'),

  upload: async (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return req<{ file: FileRef; info: TableInfo }>('/api/upload', { method: 'POST', body: fd })
  },

  info: (fileId: string) => req<{ file_id: string; name: string; info: TableInfo }>(`/api/files/${fileId}/info`),

  split: (fileId: string, allCampuses = true) =>
    req<{ week: number | null; outputs: FileRef[] }>('/api/split', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, all_campuses: allCampuses }),
    }),

  recommend: (fileId: string, week?: number | null) =>
    req<Recommend>(`/api/recommend?file_id=${fileId}${week ? `&week=${week}` : ''}`),

  arrange: (fileId: string, colleges: string[], week?: number | null, force = false, dryRun = false) =>
    req<any>('/api/arrange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, colleges, week, force, dry_run: dryRun }),
    }),

  assistant: (fileId: string, slots: Record<string, string[]>, week?: number | null) =>
    req<any>('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, slots, week }),
    }),

  check: (fileId: string, week?: number | null) =>
    req<{ ok: boolean; issues: any[]; week: number | null; campus: string }>('/api/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, week }),
    }),

  ingest: (fileId: string, week?: number | null, campus?: string) =>
    req<any>('/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, week, campus }),
    }),

  // 表格预览：服务端渲染成独立 HTML（优先 OfficeCLI，高保真还原字体/边框/合并）
  preview: (fileId: string) =>
    req<{ url: string; engine: string; name: string }>('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    }),

  // 下载前体检：可打开性 + 表头 + 关键列 + 标题合并 + 活动数 + 检查学院 + OpenXML 校验
  diagnose: (fileId: string) =>
    req<{ ok: boolean; file: string; checks: { name: string; ok: boolean; detail: string }[] }>('/api/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    }),

  ledger: () => req<{ ledger_file: string; weeks: Record<string, any> }>('/api/ledger'),

  ledgerReset: (week?: number, campus?: string) =>
    req<{ ok: boolean; remaining: number }>(
      `/api/ledger${week ? `?week=${week}${campus ? `&campus=${campus}` : ''}` : ''}`,
      { method: 'DELETE' },
    ),

  stats: () =>
    req<{
      college_load: { college: string; count: number }[]
      per_week: { label: string; week: number; activities: number; colleges: number }[]
      campus_distribution: { campus: string; count: number }[]
      total_weeks: number
      total_activities: number
      college_pool: string[]
      ledger_file: string
    }>('/api/stats'),

  downloadUrl: (fileId: string) => `${API_BASE}/api/files/${fileId}/download`,

  importHistory: (fileId: string, week?: number | null) =>
    req<any>('/api/import-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId, week }),
    }),
}
