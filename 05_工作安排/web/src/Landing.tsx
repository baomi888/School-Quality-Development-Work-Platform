import { useEffect, useRef, useState } from 'react'
import type { Org } from './api'

// 版式原型 → 人话标签
const ARCH_LABEL: Record<string, string> = {
  task_x_slot: '任务 × 校区 · 派活型',
  date_x_slot: '日期 × 节次 · 排班型',
  task_x_deadline: '稿件 × 截止 · 排期型',
  event_x_quota: '场次 × 名额 · 招募型',
}
const ARCH_LABEL_FALLBACK = (a: string) => a || '自定义版式'

const DEMO_ROWS = [
  {
    task: '收表',
    west: '西城 · 已安排',
    guandu: '官渡 · 已安排',
    reason: '上周没有做过这项，累计件数也少于其他候选，所以先轮到本周。',
    facts: ['上周回避', '累计 1 件', '主校区匹配'],
  },
  {
    task: '制表',
    west: '西城 · 已安排',
    guandu: '官渡 · 待安排',
    reason: '官渡候选都能完成；按本周累计件数排序后，当前没有额外增加任何人的负担。',
    facts: ['候选 8 人', '校区可派', '负载均衡'],
  },
  {
    task: '现场检查',
    west: '西城 · 已安排',
    guandu: '官渡 · 已安排',
    reason: '两名候选的累计件数相同，系统用周次和人员编号生成稳定排序，结果可以复现。',
    facts: ['2 人并列', '稳定裁决', '不靠随机'],
  },
]

const WORKFLOW = [
  {
    title: '上传总表',
    desc: '识别周次、校区与活动，原表格式不变。',
  },
  {
    title: '按部门拆分',
    desc: '每个部门的规则、名单和台账彼此独立。',
  },
  {
    title: '安排并查看理由',
    desc: '先看覆盖与负载，再决定是否保留或改派。',
  },
  {
    title: '预览体检后导出',
    desc: '表格能打开、字段齐全，再发到交流群。',
  },
]

export function Landing({
  orgs,
  onEnter,
  onNewDept,
  role,
  onRole,
  onAssistEnter,
}: {
  orgs: Org[]
  onEnter: (id: string) => void
  onNewDept: () => void
  role: 'manage' | 'assist'
  onRole: (r: 'manage' | 'assist') => void
  onAssistEnter: (id: string) => void
}) {
  const totalAssists = orgs.reduce((sum, org) => sum + (org.stats?.assists ?? 0), 0)
  const totalWeeks = orgs.reduce((sum, org) => sum + (org.stats?.weeks_stored ?? 0), 0)
  const isAssist = role === 'assist'
  const [demoRow, setDemoRow] = useState(0)
  const landingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = landingRef.current
    if (!root || !('IntersectionObserver' in window)) return

    root.classList.add('reveal-ready')
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    )

    root.querySelectorAll('.l-reveal').forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  const selected = DEMO_ROWS[demoRow]

  return (
    <div className="landing" ref={landingRef}>
      <header className="l-top">
        <div className="l-top-inner">
          <div className="l-mark">
            <span className="l-mark-badge" aria-hidden="true">素</span>
            <span>校素拓 · 工作安排平台</span>
          </div>
          <div className="l-actions">
            <div className="role-switch" aria-label="选择使用身份">
              <button
                className={`role-tab ${!isAssist ? 'on' : ''}`}
                aria-pressed={!isAssist}
                onClick={() => onRole('manage')}
              >
                管理层
              </button>
              <button
                className={`role-tab ${isAssist ? 'on' : ''}`}
                aria-pressed={isAssist}
                onClick={() => onRole('assist')}
              >
                小助理
              </button>
            </div>
            {!isAssist && (
              <button className="l-new" onClick={onNewDept}>
                新建部门
              </button>
            )}
          </div>
        </div>
      </header>

      <main>
        <section className="l-hero">
          <div className="l-hero-copy">
            <h1 className="l-title">
              学生组织的活，
              <br />
              排进工作周历。
            </h1>
            <p className="l-sub">
              {isAssist
                ? '这是校素拓的学生组织工作安排平台。查看管理层已经定稿的本周任务，选择部门和姓名即可，不需要口令，也不能自行改派。'
                : '这是校素拓的学生组织工作安排平台，为各部门安排干部工作。公平、可解释、可交接，同一条规则贯穿每周。'}
            </p>
            <div className="l-hero-actions">
              <button
                className="l-primary"
                onClick={() => document.getElementById('departments')?.scrollIntoView({ behavior: 'smooth' })}
              >
                {isAssist ? '查看本周我负责' : '选择部门进入'}
              </button>
            </div>
            <div className="l-hero-meta" aria-label="平台概况">
              <div>
                <span className="l-meta-value">{orgs.length}</span>
                <span>个部门已接入</span>
              </div>
              <div>
                <span className="l-meta-value">{totalAssists}</span>
                <span>名助理参与轮值</span>
              </div>
              <div>
                <span className="l-meta-value">{totalWeeks || '50+'}</span>
                <span>{totalWeeks ? '周台账已留存' : '周公平性回归'}</span>
              </div>
            </div>
          </div>

          <div className="l-demo l-reveal" data-ui aria-label="排班理由交互演示">
            <div className="l-demo-head">
              <div>
                <span className="l-demo-label">规则演示</span>
                <strong>第 11 周 · 示例排班</strong>
              </div>
              <span className="l-demo-coverage">覆盖 5 / 6</span>
            </div>
            <div className="l-demo-cols" aria-hidden="true">
              <span>工作内容</span>
              <span>西城</span>
              <span>官渡</span>
            </div>
            <div className="l-demo-rows">
              {DEMO_ROWS.map((row, index) => (
                <button
                  key={row.task}
                  className={`l-demo-row ${demoRow === index ? 'selected' : ''}`}
                  aria-expanded={demoRow === index}
                  onClick={() => setDemoRow(index)}
                >
                  <span className="l-demo-task">{row.task}</span>
                  <span>{row.west}</span>
                  <span>{row.guandu}</span>
                </button>
              ))}
            </div>
            <div className="l-demo-reason" key={selected.task}>
              <span className="l-reason-title">为什么是这个安排</span>
              <p>{selected.reason}</p>
              <div className="l-reason-facts">
                {selected.facts.map((fact) => <span key={fact}>{fact}</span>)}
              </div>
            </div>
            <p className="l-demo-foot">点击任一行查看理由 · 示例不包含真实姓名</p>
          </div>
        </section>

        <section className="l-departments" id="departments">
          <div className="l-section-head l-reveal">
            <div>
              <h2>{isAssist ? '选择部门和姓名' : '选择你所在的部门'}</h2>
              <p>
                {isAssist
                  ? '只展示已定稿的任务。选好部门后，再选择自己的姓名。'
                  : '每个部门有独立名单、规则和台账，互不覆盖。'}
              </p>
            </div>
            <span className="l-section-count">已接入 {orgs.length} 个部门</span>
          </div>

          <div className="dept-grid">
            {orgs.map((org, index) => (
              <button
                className="dept-card l-reveal"
                key={org.id}
                style={{ ['--delay' as string]: `${index * 70}ms` }}
                onClick={() => (isAssist ? onAssistEnter(org.id) : onEnter(org.id))}
              >
                <div className="dc-head">
                  <span className="dc-name">{org.name}</span>
                  <span className={`dc-state ${org.stats?.last_week ? 'active' : ''}`}>
                    {org.stats?.last_week ? `第 ${org.stats.last_week} 周在档` : '尚未排班'}
                  </span>
                </div>
                <span className="dc-arch">{ARCH_LABEL[org.archetype] ?? ARCH_LABEL_FALLBACK(org.archetype)}</span>
                <div className="dc-stats">
                  <span><b>{org.stats?.assists ?? 0}</b> 名助理</span>
                  <span><b>{org.stats?.tasks ?? 0}</b> 项工作</span>
                </div>
                <span className="dc-enter">{isAssist ? '查看我的任务' : '进入工作台'} →</span>
              </button>
            ))}
            {!isAssist && (
              <button className="dept-card new l-reveal" onClick={onNewDept}>
                <span className="dc-plus" aria-hidden="true">＋</span>
                <span className="dc-name">接入新部门</span>
                <span className="dc-arch">填写名称，选择版式，无需改代码</span>
                <span className="dc-enter">开始配置 →</span>
              </button>
            )}
          </div>
        </section>

        <section className="l-how" id="how">
          <div className="l-section-head l-reveal">
            <div>
              <h2>不靠随机，靠能复看的顺序。</h2>
              <p>同一条规则逐级比较。不满意可以改派，改过的安排会被锁定，重摇时不动。</p>
            </div>
          </div>
          <div className="l-how-layout">
            <ol className="l-workflow">
              {WORKFLOW.map((step, index) => (
                <li className="l-reveal" key={step.title} style={{ ['--delay' as string]: `${index * 60}ms` }}>
                  <span className="l-workflow-index">{index + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.desc}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="l-rule-proof l-reveal" data-ui aria-label="候选排序界面片段">
              <div className="l-rule-head">
                <strong>制表 · 官渡候选</strong>
                <span>按规则排序</span>
              </div>
              {[
                ['候选 01', '上周未做', '累计 0 件'],
                ['候选 02', '上周未做', '累计 1 件'],
                ['候选 03', '上周已做', '累计 1 件'],
              ].map((candidate, index) => (
                <div className={`l-rule-row ${index === 0 ? 'selected' : ''}`} key={candidate[0]}>
                  <span>{candidate[0]}</span>
                  <span>{candidate[1]}</span>
                  <span>{candidate[2]}</span>
                </div>
              ))}
              <p className="l-rule-foot">候选 01 同时满足回避与负载优先。</p>
            </div>
          </div>
        </section>

        <section className="l-proof l-reveal" aria-labelledby="proof-title">
          <div className="l-proof-copy">
            <h2 id="proof-title">长期均衡不是口号，是连续排出来的结果。</h2>
            <p>
              连续模拟 50 周后，人均累计件数极差为 1 件，标准差为 0.24，
              单周每人最多承担 2 件。每条结果都能由周次和名单重新复现。
            </p>
          </div>
          <div className="l-proof-visual" data-ui aria-label="50 周公平性回归结果">
            <div className="l-proof-vhead">
              <strong>50 周回归结果</strong>
              <span>负载越平，柱越接近</span>
            </div>
            <div className="l-proof-metrics">
              <div>
                <b>1</b>
                <span>件 · 50 周累计极差</span>
              </div>
              <div>
                <b>0.24</b>
                <span>人均累计标准差</span>
              </div>
              <div>
                <b>2</b>
                <span>件 · 单周负载上限</span>
              </div>
            </div>
            <div className="l-proof-weeks" aria-hidden="true">
              {Array.from({ length: 18 }, (_, i) => (
                <span key={i} style={{ height: `${28 + ((i * 17) % 54)}%` }} />
              ))}
            </div>
          </div>
        </section>

        <section className="l-output">
          <div className="l-output-copy l-reveal">
            <h2>最后交出去的，仍是学校熟悉的那张表。</h2>
            <p>
              安排完成后先预览、再体检，确认表头、字段、合并单元格和活动数量都没有问题。
              导出后的字体、边框与行高保持原样。
            </p>
            <div className="l-output-notes">
              <span>本地数据</span>
              <span>可复现分配</span>
              <span>官方版式导出</span>
            </div>
          </div>
          <div className="l-export-preview l-reveal" data-ui aria-label="安排表导出预览">
            <div className="l-sheet-title">第 11 周素质拓展活动检查安排表</div>
            <div className="l-sheet-meta">
              <span>官渡校区</span>
              <span>已通过结构检查</span>
            </div>
            <div className="l-sheet-grid">
              <div className="sheet-head">活动</div>
              <div className="sheet-head">检查学院</div>
              <div className="sheet-head">助理</div>
              {[
                ['活动检查（一）', '材料学院', '已安排'],
                ['活动检查（二）', '机电学院', '已安排'],
                ['活动检查（三）', '环境学院', '待确认'],
              ].map((row) => row.map((cell, index) => (
                <div key={`${row[0]}-${index}`} className={index === 0 ? 'sheet-name' : ''}>{cell}</div>
              )))}
            </div>
            <div className="l-sheet-foot">
              <span>预览为示例版式，不含真实名单</span>
              <b>导出 xlsx →</b>
            </div>
          </div>
        </section>
      </main>

      <footer className="l-foot">
        <div className="l-foot-main">
          <strong>校素拓 · 工作安排平台</strong>
          <span>公平、可解释、长期均衡的学生组织工作安排工具。</span>
        </div>
        <div className="l-foot-note">
          <span>数据保存在本机</span>
          <span>管理层口令保护</span>
          <span>MIT 开源</span>
        </div>
      </footer>
    </div>
  )
}
