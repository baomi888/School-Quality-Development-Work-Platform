import type { Org } from './api'

// 版式原型 → 人话标签
const ARCH_LABEL: Record<string, string> = {
  task_x_slot: '派活型 · 任务 × 列',
  date_x_slot: '排班型 · 日期 × 节次',
  task_x_deadline: '排期型 · 稿件 × 截止',
  event_x_quota: '招募型 · 场次 × 名额',
}
const ARCH_LABEL_FALLBACK = (a: string) => a || '自定义'

// 落地页（部门选择门面）—— 档案台设计语言：暖纸 / 冷墨 / 单正红、零圆角、硬线、留白、衬线巨字。
// 点一张部门卡 → onEnter(id) 进入该部门的工作台；「新建部门」→ onNewDept 打开弹窗。
export function Landing({
  orgs, onEnter, onNewDept,
}: {
  orgs: Org[]
  onEnter: (id: string) => void
  onNewDept: () => void
}) {
  const totalAssists = orgs.reduce((s, o) => s + (o.stats?.assists ?? 0), 0)
  const totalWeeks = orgs.reduce((s, o) => s + (o.stats?.weeks_stored ?? 0), 0)

  return (
    <div className="landing">
      {/* ---------------- 顶栏 ---------------- */}
      <header className="l-top">
        <div className="l-mark">校素拓<b>·</b>工作安排平台</div>
        <button className="btn primary" onClick={onNewDept}>＋ 新建部门</button>
      </header>

      {/* ---------------- Hero ---------------- */}
      <section className="l-hero">
        {/* 红章：平台级品牌印章，不是某个具体部门 */}
        <div className="l-seal l-reveal" style={{ animationDelay: '0ms' }} aria-hidden="true">
          <svg className="seal-svg" viewBox="0 0 100 100" role="img">
            <rect x="4" y="4" width="92" height="92" fill="none" stroke="var(--red)" strokeWidth="3" />
            <rect x="12" y="12" width="76" height="76" fill="none" stroke="var(--red)" strokeWidth="1" />
            <text x="50" y="42" textAnchor="middle" fill="var(--red)" fontFamily="var(--font-serif)" fontWeight="700" fontSize="22" letterSpacing="2">校素拓</text>
            <text x="50" y="70" textAnchor="middle" fill="var(--red)" fontFamily="var(--font-serif)" fontWeight="700" fontSize="24" letterSpacing="2">安排</text>
          </svg>
        </div>
        <div className="l-reveal" style={{ animationDelay: '60ms' }}>
          <div className="kicker"><span className="k-dot" />SUPT · 全校学生组织工作安排平台</div>
        </div>
        <h1 className="l-title l-reveal" style={{ animationDelay: '130ms' }}>
          选你所在的部门，<br />进入它的<span className="hl-red">工作安排台</span>
        </h1>
        <p className="l-sub l-reveal" style={{ animationDelay: '150ms' }}>
          为全校约 122 个机构安排干部工作。公平可解释、长期均衡、可跨届传承——
          同一套内核，每个部门一张独立台账。
        </p>
        <div className="l-stats l-reveal" style={{ animationDelay: '230ms' }}>
          <div className="ls"><b>{orgs.length}</b><span>已接入部门</span></div>
          <div className="ls"><b>{totalAssists}</b><span>在册助理</span></div>
          <div className="ls"><b>{totalWeeks}</b><span>累计存周</span></div>
          <div className="ls"><b>MIT</b><span>开源协议</span></div>
        </div>
      </section>

      {/* ---------------- 01 选择部门 ---------------- */}
      <section className="l-sec">
        <div className="sec-head">
          <span className="idx">01</span>
          <h2>选择部门</h2>
          <span className="note">已接入 {orgs.length} 个部门 · 点卡片进入，或右上角「＋新建部门」继续添加</span>
        </div>
        <div className="dept-grid">
          {orgs.map((o, i) => (
            <button
              className="dept-card l-reveal"
              key={o.id}
              style={{ animationDelay: `${300 + i * 55}ms` }}
              onClick={() => onEnter(o.id)}
            >
              <div className="dc-idx">{String(i + 1).padStart(2, '0')}</div>
              <div className="dc-name">{o.name}</div>
              <div className="dc-arch">{ARCH_LABEL[o.archetype] ?? ARCH_LABEL_FALLBACK(o.archetype)}</div>
              <div className="dc-stats">
                <span>{o.stats?.assists ?? 0} 名助理</span>
                <span>{o.stats?.tasks ?? 0} 件活</span>
                {o.stats?.last_week
                  ? <span>第 {o.stats.last_week} 周在档</span>
                  : <span className="none">尚未排班</span>}
              </div>
              <div className="dc-enter">进入 →</div>
            </button>
          ))}
          <button className="dept-card new" onClick={onNewDept}>
            <div className="dc-plus">＋</div>
            <div className="dc-name">新建部门</div>
            <div className="dc-arch">填名称 · 选版式 · 零代码</div>
          </button>
        </div>
      </section>

      {/* ---------------- 02 平台价值 ---------------- */}
      <section className="l-sec">
        <div className="sec-head">
          <span className="idx">02</span>
          <h2>这套平台替你做什么</h2>
          <span className="note">不是省力气，是让安排靠得住</span>
        </div>
        <div className="l-values">
          <div className="value v1 l-reveal" style={{ animationDelay: '0ms' }}>
            <div className="vtag">公平 · 可解释</div>
            <h3>为什么派他，能直接念给人听</h3>
            <p>
              每条安排按排序链逐级比较——上周回避、累计件数、本校区优先。
              悬停姓名即可看到一句人话理由，不是黑盒结果。部长手算分不出这种依据。
            </p>
          </div>
          <div className="value v2 l-reveal" style={{ animationDelay: '90ms' }}>
            <div className="vtag">长期 · 均衡</div>
            <h3>50 周极差仅 1 件</h3>
            <p>
              同一件活不连着两周派同一批人；单周件数尽量拉平。
              部长手里没有台账，平台替你记着每个人的历史负载。
            </p>
          </div>
          <div className="value v3 l-reveal" style={{ animationDelay: '180ms' }}>
            <div className="vtag">传承 · 可交接</div>
            <h3>换届不丢排法</h3>
            <p>
              台账与规则随部门独立保存。下一届干部接手时，读台账就知道谁做过什么、怎么排，
              不用从头摸索。
            </p>
          </div>
        </div>
      </section>

      {/* ---------------- 页脚 ---------------- */}
      <footer className="l-foot">
        <div className="l-foot-main">校素拓 · 工作安排平台 · 为全校学生组织而做</div>
        <div className="hint">
          MIT 开源 · 数据全部本地 JSON · 可离线使用 · 老样子，可继续迭代
        </div>
      </footer>
    </div>
  )
}
