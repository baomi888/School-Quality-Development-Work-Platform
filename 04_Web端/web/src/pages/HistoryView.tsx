import { useCallback, useEffect, useState } from 'react'
import { API_BASE, api } from '../api'

interface HistFile {
  id: string
  name: string
  kind: string
  campus?: string
  week: number
  created_at?: string
  download_url: string
  exists: boolean
}

interface WeekGroup {
  week: number
  files: HistFile[]
}

const KIND_LABEL: Record<string, string> = {
  upload: '上传原表',
  split: '拆分表',
  arranged: '已安排学院',
  assistant: '已安排助理',
}

const KIND_CLASS: Record<string, string> = {
  upload: 'tag',
  split: 'tag',
  arranged: 'tag-brand',
  assistant: 'tag-ok',
}

export default function HistoryView() {
  const [weeks, setWeeks] = useState<WeekGroup[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 预览
  const [previewId, setPreviewId] = useState('')
  const [preview, setPreview] = useState<{ url: string; engine: string; name: string } | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const r = await api.history()
      setWeeks(r.weeks)
      setErr('')
    } catch (e: any) {
      setErr(e?.message ?? '读取历史归档失败')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function openPreview(f: HistFile) {
    if (!f.exists) return
    setPreviewId(f.id)
    try {
      setPreview(await api.preview(f.id))
    } catch {
      setPreview(null)
    }
  }

  const totalFiles = weeks.reduce((s, w) => s + w.files.length, 0)

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">历史归档</h2>
          <span className="card-hint">所有上传 / 拆分 / 安排过的 Excel 都登记在这里，随时回看、下载</span>
        </div>
        <div className="btn-row">
          <span className="tag">{weeks.length} 周</span>
          <span className="tag">{totalFiles} 个文件</span>
          <button className="btn btn-sm" onClick={load} disabled={busy} style={{ marginLeft: 'auto' }}>刷新</button>
        </div>
        {err && <div className="alert alert-danger" style={{ marginTop: 10 }}>{err}</div>}
      </section>

      {weeks.length === 0 && !busy && (
        <div className="empty">
          <div className="empty-title">还没有历史文件</div>
          <div className="small">在「本周工作」上传总表、或首页「导入历史表」，文件就会出现在这里</div>
        </div>
      )}

      {weeks.map((g) => (
        <section className="card" key={g.week}>
          <div className="card-head">
            <h3 className="card-title">第 {g.week} 周</h3>
            <span className="card-hint">{g.files.length} 个文件</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>#</th>
                <th>文件名</th>
                <th style={{ width: 110 }}>类型</th>
                <th style={{ width: 80 }}>校区</th>
                <th style={{ width: 150 }}>登记时间</th>
                <th style={{ width: 160 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {g.files.map((f, i) => (
                <tr key={f.id}>
                  <td className="num">{i + 1}</td>
                  <td className="name">
                    {f.name}
                    {!f.exists && <span className="tag tag-warn" style={{ marginLeft: 8 }}>原文件已清理</span>}
                  </td>
                  <td>
                    <span className={KIND_CLASS[f.kind] ?? 'tag'}>{KIND_LABEL[f.kind] ?? f.kind}</span>
                  </td>
                  <td className="small">{f.campus || '—'}</td>
                  <td className="small">{(f.created_at ?? '').replace('T', ' ')}</td>
                  <td className="btn-row" style={{ gap: 6 }}>
                    <a className="btn btn-sm" href={f.download_url}>下载</a>
                    {f.exists && (
                      <button className="btn btn-sm" onClick={() => openPreview(f)}>
                        {previewId === f.id && preview ? '预览中' : '预览'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {previewId && preview && g.files.some((f) => f.id === previewId) && (
            <div className="preview-wrap" style={{ marginTop: 12 }}>
              <div className="small muted" style={{ marginBottom: 6 }}>
                预览：{preview.name}（
                {preview.engine === 'officecli' ? 'OfficeCLI 高保真渲染' : '内置渲染'}）
              </div>
              <iframe className="preview-frame" src={API_BASE + preview.url} title="文件预览" />
            </div>
          )}
        </section>
      ))}
    </>
  )
}
