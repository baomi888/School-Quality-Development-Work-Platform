import { useMemo, useRef, useState } from 'react'
import { API_BASE, api, type FileRef, type Recommend, type TableInfo } from '../api'
import WeekFlow from '../components/WeekFlow'
import PageHead from '../components/PageHead'
import Timetable from '../components/Timetable'

type Step = 1 | 2 | 3 | 4

const SLOT_KEYS = ['周六上午', '周六下午', '周日上午', '周日下午'] as const

const STEPS: { n: Step; label: string; meta: string }[] = [
  { n: 1, label: '上传总表', meta: 'Excel → 自动识别' },
  { n: 2, label: '拆分校区', meta: '按校区归档' },
  { n: 3, label: '安排检查学院', meta: '写入台账' },
  { n: 4, label: '安排助理', meta: '周末时段匹配' },
]

export default function Work() {
  const [step, setStep] = useState<Step>(1)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState<{ message: string; problems?: string[]; alternatives?: string[] } | null>(null)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null)

  // 1 上传
  const [uploaded, setUploaded] = useState<FileRef | null>(null)
  const [info, setInfo] = useState<TableInfo | null>(null)
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 2 拆分
  const [splits, setSplits] = useState<FileRef[]>([])

  // 3 安排
  const [current, setCurrent] = useState<FileRef | null>(null)
  const [recommend, setRecommend] = useState<Recommend | null>(null)
  const [pool, setPool] = useState<string[]>([])
  const [arranged, setArranged] = useState<any>(null)
  const [forceNext, setForceNext] = useState(false)

  // 4 助理
  const [slotText, setSlotText] = useState<Record<string, string>>({})
  const [assistResult, setAssistResult] = useState<any>(null)

  // 校验
  const [checkResult, setCheckResult] = useState<any>(null)

  // 预览 + 下载前体检
  const [previewTarget, setPreviewTarget] = useState('')
  const [preview, setPreview] = useState<{ url: string; engine: string; name: string } | null>(null)
  const [diag, setDiag] = useState<{ ok: boolean; file: string; checks: { name: string; ok: boolean; detail: string }[] } | null>(null)

  const products = useMemo(() => {
    const list: FileRef[] = []
    if (arranged?.file) list.push(arranged.file)
    if (assistResult?.file) list.push(assistResult.file)
    splits.forEach((s) => {
      if (!list.some((x) => x.id === s.id)) list.push(s)
    })
    return list
  }, [arranged, assistResult, splits])

  // 所有可以预览/体检的文件：产物优先，其次当前选中的表
  const targets = useMemo(() => {
    const list: FileRef[] = []
    for (const f of [arranged?.file, assistResult?.file, ...splits, current]) {
      if (f && !list.some((x) => x.id === f.id)) list.push(f)
    }
    return list
  }, [arranged, assistResult, splits, current])

  const target = targets.find((t) => t.id === previewTarget) ?? targets[0] ?? null

  async function autoInspect(fileId: string) {
    setPreviewTarget(fileId)
    try {
      setPreview(await api.preview(fileId))
    } catch {
      setPreview(null)
    }
    try {
      setDiag(await api.diagnose(fileId))
    } catch {
      setDiag(null)
    }
  }

  async function doPreview(fileId: string) {
    setBusy('渲染预览…')
    setError(null)
    try {
      const r = await api.preview(fileId)
      setPreview(r)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  async function doDiagnose(fileId: string) {
    setBusy('体检中…')
    setError(null)
    try {
      setDiag(await api.diagnose(fileId))
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  function fail(e: any) {
    setError({
      message: e?.message ?? '操作失败',
      problems: e?.problems ?? [],
      alternatives: e?.alternatives ?? [],
    })
    setNotice(null)
  }

  async function onPick(file: File) {
    setError(null)
    setNotice(null)
    setBusy('上传并解析中…')
    try {
      const r = await api.upload(file)
      setUploaded(r.file)
      setInfo(r.info)
      setCurrent(r.file)
      setSplits([])
      setRecommend(null)
      setPool([])
      setArranged(null)
      setAssistResult(null)
      setCheckResult(null)
      setPreview(null)
      setDiag(null)
      setPreviewTarget('')
      setStep(r.info.campuses.length > 1 ? 2 : 3)
      await loadRecommend(r.file.id, r.info.week)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  async function loadRecommend(fileId: string, week?: number | null) {
    try {
      const rec = await api.recommend(fileId, week)
      setRecommend(rec)
      setPool(rec.available_now.slice(0, Math.max(rec.suggested_pool_size, 4)))
    } catch (e) {
      fail(e)
    }
  }

  async function doSplit() {
    if (!uploaded) return
    setBusy('拆分中…')
    setError(null)
    try {
      const r = await api.split(uploaded.id, true)
      setSplits(r.outputs)
      const first = r.outputs.find((o) => !o.empty) ?? r.outputs[0]
      if (first) {
        setCurrent(first)
        await loadRecommend(first.id, r.week)
      }
      setStep(3)
      setNotice({ kind: 'ok', text: `已生成 ${r.outputs.length} 份校区表${r.outputs.some((o) => o.empty) ? '（无活动校区为空白表）' : ''}` })
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  async function useFile(f: FileRef) {
    setError(null)
    setBusy('读取中…')
    try {
      setCurrent(f)
      setArranged(null)
      setAssistResult(null)
      setCheckResult(null)
      setPreview(null)
      setDiag(null)
      setPreviewTarget('')
      await loadRecommend(f.id, f.week ?? info?.week)
      setStep(3)
    } finally {
      setBusy('')
    }
  }

  async function doArrange() {
    if (!current) return
    setBusy('安排中…')
    setError(null)
    try {
      const r = await api.arrange(current.id, pool, info?.week, forceNext)
      setArranged(r)
      setForceNext(false)
      setStep(4)
      setNotice({ kind: 'ok', text: `已写入「${r.column}」列并记入台账（第${r.week}周 · ${r.campus}）` })
      if (r?.file?.id) await autoInspect(r.file.id)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  async function doCheck(fileId: string, week?: number | null) {
    setBusy('校验中…')
    try {
      const r = await api.check(fileId, week)
      setCheckResult(r)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  async function doAssistant() {
    if (!current) return
    const slots: Record<string, string[]> = {}
    SLOT_KEYS.forEach((k) => {
      const raw = slotText[k] ?? ''
      slots[k] = raw
        .split(/[,，、\n\r\t]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    })
    setBusy('安排助理中…')
    setError(null)
    try {
      const source = arranged?.file?.id ?? current.id
      const r = await api.assistant(source, slots, info?.week)
      setAssistResult(r)
      setNotice({ kind: 'ok', text: `助理已写入「${r.column}」列` })
      if (r?.file?.id) await autoInspect(r.file.id)
    } catch (e) {
      fail(e)
    } finally {
      setBusy('')
    }
  }

  function toggleCollege(c: string) {
    setPool((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  const slotEmpty = SLOT_KEYS.every((k) => !(slotText[k] ?? '').trim())

  // 页头读数：有表时显示周次与活动数，没表时给一句行动指令
  const headKicker = info
    ? `${info.week != null ? `第 ${info.week} 周` : '未识别周次'} · ${info.campuses.join(' / ') || '未识别校区'}`
    : '尚未载入总表 · 从上传开始'
  const headSide = info
    ? [{ label: '待安排', value: String(info.activity_count) }]
    : [{ label: '待安排', value: '—' }]
  // 学院池是次要读数，挂在主读数下面做小字，不跟「待安排」抢大小
  const headSideNotes = info
    ? [{ label: '学院池', value: `${pool.length} / 建议 ${recommend?.suggested_pool_size ?? '—'}` }]
    : [{ label: '状态', value: '尚未载入总表' }]

  // 步骤状态：当前步骤高亮，前面步骤完成态
  const isDone = (n: Step) => step > n
  const isCurrent = (n: Step) => step === n

  // 折叠摘要：已完成且已经过去的步骤，压缩成一行，可点回去
  const summaries: { n: Step; no: string; title: string; hint?: string }[] = []
  if (isDone(1) && uploaded) summaries.push({ n: 1, no: '01', title: '上传总表', hint: uploaded.name })
  if (isDone(2) && splits.length > 0) summaries.push({ n: 2, no: '02', title: '拆分校区', hint: `已生成 ${splits.length} 份校区表` })
  if (isDone(3) && arranged) summaries.push({ n: 3, no: '03', title: '安排检查学院', hint: `已写入第 ${arranged.week ?? '?'} 周台账` })
  if (isDone(4) && assistResult) summaries.push({ n: 4, no: '04', title: '安排助理', hint: '已完成' })

  return (
    <>
      <PageHead
        kicker={headKicker}
        title={'本周素质拓展\n活动检查排班'}
        side={headSide}
        sideNotes={headSideNotes}
      />

      {/* 步骤条：可点击回看任一已解锁步骤 */}
      <div className="steps">
        {STEPS.map((s) => (
          <button
            key={s.n}
            className={`step ${isCurrent(s.n) ? 'current' : ''} ${isDone(s.n) ? 'done' : ''}`}
            onClick={() => setStep(s.n)}
            title={`跳到：${s.label}`}
          >
            <span className="step-idx"><span>{s.n}</span></span>
            <span>
              <span className="step-label">{s.label}</span>
              <span className="step-meta">{s.meta}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="workspace">
        {/* ==================== 主区 ==================== */}
        <div className="main-col">
          {busy && <div className="alert">⏳ {busy}</div>}
          {notice && <div className={`alert alert-${notice.kind}`}>{notice.text}</div>}
          {error && (
            <div className="alert alert-danger">
              <strong>{error.message}</strong>
              {error.problems && error.problems.length > 0 && (
                <ul>
                  {error.problems.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
              {error.alternatives && error.alternatives.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div className="small">建议改用这些「上周没安排过」的学院：</div>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {error.alternatives.map((c) => (
                      <button key={c} className="chip" onClick={() => setPool((p) => Array.from(new Set([...p, c])))}>
                        + {c}
                      </button>
                    ))}
                  </div>
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => { setForceNext(true); setTimeout(doArrange, 0) }}>
                      仍要按当前选择写入
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 已完成步骤的折叠摘要 */}
          {summaries.map((s) => (
            <div className="step-summary" key={s.n}>
              <span className="p-no">{s.no}</span>
              <p className="p-title">{s.title}</p>
              {s.hint && <span className="small muted">{s.hint}</span>}
              <button className="p-view" onClick={() => setStep(s.n)}>查看 ↑</button>
            </div>
          ))}

          {/* Step 1：上传 */}
          {isCurrent(1) && (
            <section className="card">
              <div className="card-head">
                <span className="card-no">01</span>
                <h2 className="card-title">上传活动登记表</h2>
              </div>
              <p className="card-desc">
                支持规划部发的本周总表、已拆好的单校区表，也支持<strong>历史总表</strong>。
                文件名或表格标题里含「第 X 周」即可自动识别并归档到对应周次，方便长期补录台账。
                格式会原样保留（宋体、边框、标题合并）。
              </p>
              <div
                className={`dropzone ${over ? 'over' : ''}`}
                role="button"
                tabIndex={0}
                aria-label="选择或拖入 Excel 活动登记表"
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    inputRef.current?.click()
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setOver(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) onPick(f)
                }}
              >
                <div className="dropzone-title">{uploaded ? '已上传：' + uploaded.name : '点击选择，或把 Excel 拖到这里'}</div>
                <div className="dropzone-sub">.xlsx / .xlsm · 在线共享表请先导出为本地文件</div>
              </div>
              <input
                ref={inputRef}
                type="file"
              accept=".xlsx,.xlsm"
                hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onPick(f) }}
              />

              {info && (
                <div style={{ marginTop: 14 }}>
                  <div className="btn-row" style={{ marginBottom: 10 }}>
                    <span className="tag tag-brand">第 {info.week ?? '?'} 周</span>
                    {info.campuses.map((c) => (
                      <span key={c} className="tag">{c}</span>
                    ))}
                    <span className="tag">{info.activity_count} 个活动</span>
                  </div>
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
                      {info.activities.map((a) => (
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
              )}
            </section>
          )}

          {/* Step 2：拆分 */}
          {info && isCurrent(2) && (
            <section className="card">
              <div className="card-head">
                <span className="card-no">02</span>
                <h2 className="card-title">按校区拆分</h2>
                <span className="card-hint">无活动的校区也会出空白表，保持归档一致</span>
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" onClick={doSplit} disabled={!!busy}>拆分出全部校区表</button>
                {info.campuses.length <= 1 && (
                  <span className="small muted">这张表本身就是单一校区，可以直接进第 3 步</span>
                )}
              </div>
              {splits.length > 0 && (
                <div className="filelist" style={{ marginTop: 12 }}>
                  {splits.map((f) => (
                    <div key={f.id} className={`fileitem ${current?.id === f.id ? 'active' : ''}`}>
                      <div className="fileitem-main">
                        <div className="fileitem-name">{f.name}</div>
                        <div className="fileitem-meta">
                          {f.empty ? <span className="tag tag-warn">本周无活动</span> : <span className="tag tag-ok">{f.rows} 个活动</span>}
                        </div>
                      </div>
                      {!f.empty && (
                        <button className="btn btn-sm" onClick={() => useFile(f)}>用它安排</button>
                      )}
                      <a className="btn btn-sm" href={api.downloadUrl(f.id)}>下载</a>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Step 3：安排检查学院 */}
          {current && recommend && isCurrent(3) && (
            <section className="card">
              <div className="card-head">
                <span className="card-no">03</span>
                <h2 className="card-title">安排二级学院检查</h2>
                <span className="card-hint">{current.name}</span>
              </div>
              <p className="card-desc">{recommend.rule_note}</p>

              <div className="grid3" style={{ marginBottom: 14 }}>
                <div className="stat">
                  <div className="stat-label">上周已安排（不能再排）</div>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {recommend.last_week_checkers.length ? (
                      recommend.last_week_checkers.map((c) => <span key={c} className="chip avoid">{c}</span>)
                    ) : <span className="small muted">无记录</span>}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">本周主办学院（不自检）</div>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {recommend.host_colleges.length ? (
                      recommend.host_colleges.map((c) => <span key={c} className="chip host">{c}</span>)
                    ) : <span className="small muted">—</span>}
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">已选学院 / 建议数量</div>
                  <div className="stat-value">{pool.length} <span className="small muted">/ {recommend.suggested_pool_size}</span></div>
                </div>
              </div>

              <div className="card-head" style={{ marginTop: 6 }}>
                <h3 className="card-title-sm">本周学院池</h3>
                <span className="card-hint">点选切换；灰色=上周用过，红色=本周主办（不可选）</span>
              </div>
              <div className="pool">
                <div className="chips">
                  {recommend.candidates.map((c) => {
                    if (c.host_this_week) return <span key={c.college} className="chip host">{c.college}</span>
                    return (
                      <button
                        key={c.college}
                        className={`chip ${pool.includes(c.college) ? 'on' : ''} ${c.last_week ? 'avoid' : ''}`}
                        onClick={() => toggleCollege(c.college)}
                      >
                        <span className="chip-dot" />
                        {c.college}
                        {c.last_week && <span className="small">·上周</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="btn-row" style={{ marginTop: 16 }}>
                <button className="btn btn-primary" onClick={doArrange} disabled={!!busy || pool.length === 0}>
                  确认安排并写入
                </button>
                <button
                  className="btn"
                  onClick={() => api.arrange(current.id, pool, info?.week, false, true).then(setArranged).catch(fail)}
                  disabled={!!busy || pool.length === 0}
                >
                  先预览（不写文件）
                </button>
                <button className="btn btn-ghost" onClick={() => setPool(recommend.available_now.slice(0, Math.max(recommend.suggested_pool_size, 4)))}>
                  重置为推荐组合
                </button>
              </div>

              {arranged && (
                <div style={{ marginTop: 16 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>活动</th>
                        <th style={{ width: 160 }}>主办学院</th>
                        <th style={{ width: 240 }}>检查学院</th>
                      </tr>
                    </thead>
                    <tbody>
                      {arranged.plan.map((p: any) => (
                        <tr key={p.row}>
                          <td className="num">{p.no ?? p.row}</td>
                          <td className="name">{p.name}</td>
                          <td className="small">{p.host_college || '—'}</td>
                          <td>
                            {p.checkers?.length
                              ? p.checkers.map((c: string) => <span key={c} className="tag tag-brand" style={{ marginRight: 6 }}>{c}</span>)
                              : <span className="tag tag-danger">未安排</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="readout">
                    <span className="readout-label">各学院承担量</span>
                    <b>
                      {Object.entries(arranged.load as Record<string, number>)
                        .map(([k, v]) => `${k} ×${v}`)
                        .join(' · ') || '—'}
                    </b>
                  </div>
                  {arranged.file && (
                    <div className="btn-row" style={{ marginTop: 10 }}>
                      <a className="btn btn-primary btn-sm" href={api.downloadUrl(arranged.file.id)}>下载已安排表</a>
                      <button className="btn btn-sm" onClick={() => { setPreviewTarget(arranged.file.id); doPreview(arranged.file.id) }}>预览</button>
                      <button className="btn btn-sm" onClick={() => doCheck(arranged.file.id, arranged.week)}>规则校验</button>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Step 4：安排助理 */}
          {arranged && isCurrent(4) && (
            <section className="card">
              <div className="card-head">
                <span className="card-no">04</span>
                <h2 className="card-title">安排助理检查</h2>
                <span className="card-hint">按周末时段自动匹配，每活动 2 人</span>
              </div>
              <p className="card-desc">
                按周一收集的空闲时间表匹配，每活动 2 人。要改名单请到右侧「本周工作流 · 周一」那一段填好。
              </p>
              <div className="chips" style={{ marginBottom: 14 }}>
                {SLOT_KEYS.map((k) => {
                  const n = (slotText[k] ?? '').split(/[,，、\n\r\t]+/).map((s) => s.trim()).filter(Boolean).length
                  return (
                    <span key={k} className={`chip ${n ? 'on' : ''}`}>
                      {k} · {n ? `${n} 人` : '未填'}
                    </span>
                  )
                })}
              </div>
              {slotEmpty && (
                <div className="alert alert-warn">
                  还没填本周的空闲时间表。建议先到右侧「本周工作流 · 周一」填好，再安排助理。
                </div>
              )}
              <div className="btn-row">
                <button className="btn btn-primary" onClick={doAssistant} disabled={!!busy}>安排助理并写入</button>
              </div>

              {assistResult && (
                <div style={{ marginTop: 14 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 40 }}>#</th>
                        <th>活动</th>
                        <th style={{ width: 130 }}>时段</th>
                        <th style={{ width: 220 }}>检查助理</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assistResult.plan.map((p: any) => (
                        <tr key={p.row}>
                          <td className="num">{p.no ?? p.row}</td>
                          <td className="name">{p.name}</td>
                          <td className="small">{p.slots?.length ? p.slots.join('+') : '非周末'}</td>
                          <td>
                            {p.assistants?.length
                              ? p.assistants.map((a: string) => <span key={a} className="tag tag-ok" style={{ marginRight: 6 }}>{a}</span>)
                              : <span className="tag">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {assistResult.problems?.length > 0 && (
                    <div className="alert alert-warn" style={{ marginTop: 10 }}>
                      {assistResult.problems.map((p: string, i: number) => <div key={i}>· {p}</div>)}
                    </div>
                  )}
                  {assistResult.file && (
                    <a className="btn btn-primary btn-sm" href={api.downloadUrl(assistResult.file.id)} style={{ marginTop: 10 }}>
                      下载（已安排助理）
                    </a>
                  )}
                </div>
              )}
            </section>
          )}

          {/* 校验结果 */}
          {checkResult && (
            <section className="card">
              <div className="card-head"><h2 className="card-title">规则校验结果</h2></div>
              {checkResult.ok ? (
                <div className="alert alert-ok">✅ 全部通过：每活动 2 个学院、无自检、无连续两周</div>
              ) : (
                <div className="alert alert-danger">
                  <strong>发现 {checkResult.issues.length} 处问题</strong>
                  <ul>
                    {checkResult.issues.map((i: any, idx: number) => (
                      <li key={idx}>[{i.type}] 第{i.row}行 {i.name} — {i.detail}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {/* 预览 + 下载前体检 */}
          {target && (
            <section className="card">
              <div className="card-head">
                <h2 className="card-title">表格预览 · 下载前体检</h2>
                <span className="card-hint">
                  渲染引擎：{preview?.engine === 'officecli' ? 'OfficeCLI（高保真）' : preview?.engine === 'builtin' ? '内置渲染' : '—'}
                </span>
              </div>
              {targets.length > 1 && (
                <div className="chips" style={{ marginBottom: 10 }}>
                  {targets.map((f) => (
                    <button
                      key={f.id}
                      className={`chip ${target.id === f.id ? 'on' : ''}`}
                      onClick={() => { setPreviewTarget(f.id); setPreview(null); setDiag(null) }}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="btn-row">
                <button className="btn btn-primary btn-sm" onClick={() => doPreview(target.id)} disabled={!!busy}>
                  生成预览
                </button>
                <button className="btn btn-sm" onClick={() => doDiagnose(target.id)} disabled={!!busy}>
                  下载前体检
                </button>
                <a className="btn btn-sm" href={api.downloadUrl(target.id)}>下载</a>
                <span className="small muted">当前：{target.name}</span>
              </div>

              {diag && (
                <div style={{ marginTop: 12 }}>
                  <div className={`alert ${diag.ok ? 'alert-ok' : 'alert-danger'}`}>
                    {diag.ok
                      ? `✅ ${diag.file} 体检全部通过，可以直接下载发出`
                      : `⚠️ ${diag.file} 体检发现问题，建议处理后再下载`}
                  </div>
                  <div className="diag-list">
                    {diag.checks.map((c, i) => (
                      <div key={i} className={`diag-item ${c.ok ? '' : 'bad'}`}>
                        <span className="diag-mark">{c.ok ? '✓' : '!'}</span>
                        <span className="diag-name">{c.name}</span>
                        <span className="diag-detail">{c.detail}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {preview && (
                <div className="preview-wrap" style={{ marginTop: 12 }}>
                  <div className="small muted" style={{ marginBottom: 6 }}>
                    下面是 Excel 的真实渲染效果（{preview.engine === 'officecli' ? 'OfficeCLI 高保真渲染，字体/边框/合并单元格与 Excel 一致' : '内置渲染，字体与边框已还原'}）
                  </div>
                  <iframe className="preview-frame" src={API_BASE + preview.url} title="表格预览" />
                </div>
              )}
            </section>
          )}
        </div>

        {/* ==================== 常驻侧栏 ==================== */}
        <aside className="rail">
          <div className="rcard">
            <h4>本周活动课表 <span className="r">tt</span></h4>
            {info && info.activities.length > 0 ? (
              <Timetable
                compact
                activities={info.activities}
                arrangedPlan={arranged?.plan}
                assistPlan={assistResult?.plan}
                week={info.week}
                campus={info.campuses.join(' / ')}
              />
            ) : (
              <div className="small muted">
                上传总表后，所有活动会按星期自动排进这张迷你课表；安排完成后显示「检 n · 助 n」。
              </div>
            )}
          </div>

          <div className="rcard">
            <h4>本周工作流 <span className="r">flow</span></h4>
            <WeekFlow
              compact
              week={info?.week ?? null}
              step={step}
              assistDone={!!assistResult}
              slotKeys={SLOT_KEYS}
              slotText={slotText}
              onSlotText={setSlotText}
            />
          </div>

          <div className="rcard">
            <h4>本周产物 <span className="r">out</span></h4>
            {products.length > 0 ? (
              <div className="rail-files">
                {products.map((f) => (
                  <div className="rail-file" key={f.id}>
                    <span className="ic">表</span>
                    <span className="nm" title={f.name}>{f.name}</span>
                    <a className="dl" href={api.downloadUrl(f.id)}>下载</a>
                  </div>
                ))}
              </div>
            ) : (
              <div className="small muted">
                完成第 3、4 步后，已安排的表会出现在这里，随时下载。
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
