import { useState } from 'react'

type Section = { key: string; label: string }

const SECTIONS: Section[] = [
  { key: 'start', label: '30 秒上手' },
  { key: 'week', label: '每周节奏' },
  { key: 'pages', label: '三个页面' },
  { key: 'rules', label: '排班铁律' },
  { key: 'faq', label: '常见问题' },
  { key: 'policy', label: '广油素拓政策速查' },
]

const WEEK_FLOW = [
  { day: '周一', todo: '收集各学院空闲时间表', action: '留着周四安排助理用' },
  { day: '周二', todo: '整理校素拓邮箱', action: '清邮件、归档登记表' },
  { day: '周三/四', todo: '与规划部交接，拿到本周总表', action: '上传到「本周工作」' },
  { day: '周四', todo: '安排二级学院检查 + 安排助理', action: '勾选学院 → 导出' },
  { day: '周五', todo: '发校院质检部交流群', action: '发共享表格，不发文件' },
  { day: '周末', todo: '现场检查活动', action: '收《质量检查表》' },
]

const POLICY_GROUPS: {
  title: string
  items: { k: string; v: string }[]
}[] = [
  {
    title: '学分与模块',
    items: [
      { k: '本科生素拓学分', v: '共 4 学分（专科 3 / 专插本 1.5，以当年文件为准）。未修满不予毕业。' },
      { k: '三大模块', v: '学术科技与专业技能 2 学分 · 文化艺术与体育竞技 1 学分 · 社会实践与志愿服务 1 学分。' },
      { k: '学分性质', v: '计入第二课堂，不计入人才培养方案总学分（广油〔2016〕12 号）。' },
    ],
  },
  {
    title: '项目申报与审批',
    items: [
      { k: '提交时点', v: '各机构每学期第 18 周前提交下学期活动项目及方案书，方可参与审批。' },
      { k: '审批节奏', v: '第 1 周审批 → 第 2 周修改复审 → 第 3 周公示。' },
      { k: '项目级别', v: '面向一个学院 = 院（系）级；面向两个及以上学院 = 校级。' },
      { k: '方案书要素', v: '提高学生哪方面素质（一句话，审项目的重要指标）、宗旨、主题、时间、对象、流程、预期效果、加分比例。' },
    ],
  },
  {
    title: '登记表与名单',
    items: [
      { k: '登记表上报', v: '本周有活动须提前交活动登记表，由管理单位统一在每周一中午 12:30 前发至校素拓邮箱 xiaosutuo@163.com。' },
      { k: '活动推迟/取消', v: '务必及时上报相应素拓管理单位，下次举办时按程序重新上报。' },
      { k: '加分名单', v: '活动结束后 3–5 天内交电子版；纸质版 5 天内按院系分开打印、盖章上交（章须与落款一致）。' },
      { k: '核对认定', v: '认证部下发最终版后，周日下发班级核对；学生在 3 天内自主认定，有误需提交证明材料。' },
    ],
  },
  {
    title: '校素拓各部门（与你对接相关）',
    items: [
      { k: '质检部', v: '每周安排二级学院质检部干部对本周活动进行质量检查，并监督二级学院质检工作；收集整理《大学生素质拓展活动质量检查表》；开展学年先进集体/先进个人/素拓标兵/素拓之星评选；对二级学院及校级组织学生干部进行素拓培训。' },
      { k: '规划部', v: '汇总审核全校常规项目；二级审核（含每周临时项目申报书）；收集汇总各学院每周活动登记表并定期清理邮箱，交宣传部和质检部。' },
      { k: '认证部', v: '收集审批活动证明材料并分发二级学院；指导学分认证；管理挂网项目；监督抽查；审批并公示全校素拓学分申请。' },
      { k: '全部门', v: '认证部、质检部、规划部、宣传部、竞赛部、综合部。' },
    ],
  },
  {
    title: '素拓分获取流程（官方六步）',
    items: [
      { k: '① 项目申报', v: '主办方申请为素拓项目 → 二级学院素拓审核 → 校素拓审核 → 每周四公众号推出活动预告。' },
      { k: '② 检查活动', v: '主办方举办活动，由校素拓和学院素拓质检部检查活动规范性等。' },
      { k: '③ 制作名单', v: '活动后主办方制作加分名单，发至校素拓邮箱。' },
      { k: '④ 公示核对', v: '校素拓周末审核整理最终版 → 下发二级学院 → 班级素拓委员发班群 → 学生核对。' },
      { k: '⑤ 导入确认', v: '每周四主办方导入加分名单；有误需提交证明材料，校素拓认可后方可导入错漏名单。' },
      { k: '⑥ 两级审核', v: '学院素拓审核通过 → 校素拓认证部最终审核通过 → 学生获得素拓分。' },
    ],
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: '为什么必须双击「启动.bat」，不能直接双击网页？',
    a: '浏览器里的 JS 库读 Excel 拿不到字体和边框，写回去会变成 Calibri 11、边框全没——这种表发到交流群没法用。启动本地服务后，Excel 处理走 Python 引擎，宋体 9 号、细边框、标题合并、列宽行高全部原样保真。',
  },
  {
    q: '数据存在哪？会联网吗？',
    a: '全部在你自己的电脑里，不联网、不上传。台账存在技能目录 data/ledger.json，和命令行版共用同一份——网页排的班，命令行也能查到。',
  },
  {
    q: '某个校区这周没活动怎么办？',
    a: '拆分时勾「包含无活动校区」，会生成一份只有表头的空白表，备注「本周无活动」，保持两校区归档一致。不勾就只出有活动的校区。',
  },
  {
    q: '为什么有些学院选不了？',
    a: '红色 = 该活动的主办学院（不能自检）；黄色 = 上周已经检查过（连续两周违规）。这两类默认拦截。确有特殊原因可以点「强制安排」，但会留下记录。',
  },
  {
    q: '文件名里带「(1)」「（副本）」之类的乱后缀会出问题吗？',
    a: '不会。引擎会自动剥掉微信/QQ 下载产生的 (1)、(2) 等后缀，并保留原有的校区括号风格（半角或全角都能识别）。',
  },
  {
    q: '输出文件命名规则是什么？',
    a: '2026-2027学年第一学期第X周素质拓展活动登记表(校区)（已安排二级学院）（已安排助理）。校区括号半角、状态后缀全角，安排助理后后缀自动累积。',
  },
  {
    q: '发交流群要注意什么？',
    a: '发共享表格（金山/WPS 云文档，所有人可编辑），不要直接发文件；并删掉「已安排二级学院」字样。',
  },
  {
    q: '怎么确认排出来的表没坏？',
    a: '写完后页面会自动出「表格预览 · 下载前体检」：预览区是 Excel 的真实渲染效果（宋体、边框、标题合并都在）；体检跑 7 项检查——文件可打开、表头识别、关键列齐全、标题合并区、活动数量、每个活动是否都安排了 2 个检查学院、OpenXML 结构校验。全绿再下载。',
  },
  {
    q: '写坏了能恢复吗？',
    a: '能。每次写入前自动在同目录生成一份 xxx.bak.xlsx（保留最近一份）；写文件是原子的——先写临时文件再整体替换，中途出错原文件分毫不动。',
  },
  {
    q: '学期变了怎么办？',
    a: '改一次配置即可：技能目录 assets/config.json 里的 term_name（如改成「2026-2027学年第二学期」）。改完网页和命令行同步生效。',
  },
]

export default function Guide() {
  const [open, setOpen] = useState<string | null>('start')
  const [faqOpen, setFaqOpen] = useState<number | null>(0)

  const jump = (key: string) => {
    setOpen(key)
    document.getElementById(`g-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div>
      <div className="card">
        <div className="card-head">
          <h2 className="card-title">使用说明</h2>
          <span className="tag tag-brand">广东石油化工学院 · 校素拓质检部</span>
        </div>
        <p className="card-desc">
          给质检部干事看的操作手册。核心用法只有一句：<b>上传总表 → 勾选学院 → 下载成品</b>。
          下面是完整说明、常见问题，以及从学校官网整理的最新素拓政策速查。
        </p>
        <div className="chips">
          {SECTIONS.map((s) => (
            <button key={s.key} className={`chip ${open === s.key ? 'on' : ''}`} onClick={() => jump(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* 30 秒上手 */}
      <section id="g-start" className="card">
        <div className="card-head">
          <span className="card-no">01</span>
          <h3 className="card-title">30 秒上手</h3>
        </div>
        <ol className="guide-steps">
          <li>
            <b>双击 <span className="mono">启动.bat</span></b> → 自动打开浏览器（黑窗口别关，用完再关）。
          </li>
          <li>
            <b>上传本周总表</b> → 点「本周工作」，把规划部给的总表 xlsx 拖进去。
          </li>
          <li>
            <b>勾选检查学院</b> → 系统已自动排除主办学院（红）和上周用过的（黄），你从剩下的里面勾。
          </li>
          <li>
            <b>下载成品</b> → 得到「（已安排二级学院）」表，格式和原表一模一样，可直接发群。
          </li>
        </ol>
        <div className="alert alert-ok">
          不确定的时候：先点每步的「预览/试排」，确认无误再下载。系统不会替你决定学院名单，只在你选完之后帮你守规则。
        </div>
      </section>

      {/* 每周节奏 */}
      <section id="g-week" className="card">
        <div className="card-head">
          <span className="card-no">02</span>
          <h3 className="card-title">每周节奏对照</h3>
        </div>
        <p className="card-desc">这张表对应你的实际工作流，看看哪一步可以用平台代替。</p>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>时间</th>
              <th>要做什么</th>
              <th>平台能帮什么</th>
            </tr>
          </thead>
          <tbody>
            {WEEK_FLOW.map((w) => (
              <tr key={w.day}>
                <td>
                  <span className="tag tag-brand">{w.day}</span>
                </td>
                <td>{w.todo}</td>
                <td className="muted">{w.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 三个页面 */}
      <section id="g-pages" className="card">
        <div className="card-head">
          <span className="card-no">03</span>
          <h3 className="card-title">三个页面分别干什么</h3>
        </div>
        <div className="guide-cards">
          <div className="guide-box">
            <div className="guide-box-title">本周工作</div>
            <p>
              主战场。四步流程：上传总表 → 拆分校区 → 勾选学院安排 → 填时段安排助理。
              每一步的产物都能单独下载，也能直接进入下一步。
            </p>
            <p className="muted small">
              助理安排：把「谁周六上午有空」这类名单直接粘进文本框（逗号分隔），系统按每活动 2 人匹配。
            </p>
            <p className="muted small">
              每次写入后会自动出「表格预览 · 下载前体检」：先看渲染效果，再跑 7 项检查，全绿再下载。
            </p>
          </div>
          <div className="guide-box">
            <div className="guide-box-title">排班台账</div>
            <p>
              历史记录。哪一周、哪个校区、哪个活动、由哪两个学院检查，一查就知道。
              与命令行技能<b>共用同一份台账</b>。
            </p>
            <p className="muted small">
              如果你在别处已经排好了表，也发给我一句话就能入档（只读不改表）。
            </p>
          </div>
          <div className="guide-box">
            <div className="guide-box-title">数据看板</div>
            <p>
              各学院出动次数排行、每周工作量趋势、校区分布，还会列出<b>从没排到过的学院</b>——
              派活均不均衡一眼看穿，评优时也有依据。
            </p>
          </div>
        </div>
      </section>

      {/* 排班铁律 */}
      <section id="g-rules" className="card">
        <div className="card-head">
          <span className="card-no">04</span>
          <h3 className="card-title">排班三条铁律（系统自动守住）</h3>
        </div>
        <div className="guide-rules">
          <div className="guide-rule">
            <span className="tag tag-ok">规则一</span>
            <div>
              <b>每个活动安排 2 个检查学院</b>
              <div className="muted small">少一个或多一个都会被拦下，不给导出。</div>
            </div>
          </div>
          <div className="guide-rule">
            <span className="tag tag-danger">规则二</span>
            <div>
              <b>举办学院不能检查自己的活动</b>
              <div className="muted small">主办学院在候选里标红、不可勾选。</div>
            </div>
          </div>
          <div className="guide-rule">
            <span className="tag tag-warn">规则三</span>
            <div>
              <b>同一个学院不连续两周检查</b>
              <div className="muted small">上周用过的标黄，选中时会拦截并列出可替代的学院。</div>
            </div>
          </div>
        </div>
        <div className="alert alert-warn">
          硬要违反规则也能过：点「强制安排」。但请先确认是真的必要——台账会留下记录，评优查起来不好看。
        </div>
      </section>

      {/* 常见问题 */}
      <section id="g-faq" className="card">
        <div className="card-head">
          <span className="card-no">05</span>
          <h3 className="card-title">常见问题</h3>
        </div>
        <div className="guide-faq">
          {FAQ.map((f, i) => (
            <div key={i} className={`guide-qa ${faqOpen === i ? 'open' : ''}`}>
              <button className="guide-q" onClick={() => setFaqOpen(faqOpen === i ? null : i)}>
                <span>{f.q}</span>
                <span className="guide-caret">{faqOpen === i ? '−' : '+'}</span>
              </button>
              {faqOpen === i && <div className="guide-a">{f.a}</div>}
            </div>
          ))}
        </div>
      </section>

      {/* 政策速查 */}
      <section id="g-policy" className="card">
        <div className="card-head">
          <span className="card-no">06</span>
          <h3 className="card-title">广油素拓政策速查</h3>
        </div>
        <p className="card-desc">
          整理自广东石油化工学院官网、创新创业学院（校素拓）网站公开文件，检索日期 2026-09-29。
          <b>正式执行以学校最新文件为准</b>，本页仅作日常速查。
        </p>

        {POLICY_GROUPS.map((g) => (
          <div key={g.title} className="policy-group">
            <div className="policy-title">{g.title}</div>
            <table className="table">
              <tbody>
                {g.items.map((it) => (
                  <tr key={it.k}>
                    <td className="table-key">{it.k}</td>
                    <td>{it.v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

        <div className="alert">
          <b>官方信息源</b>
          <ul>
            <li>校素拓（创新创业学院）官网：<span className="mono">cxcy.gdupt.edu.cn</span> — 项目公示、中心简介、素拓分流程指引</li>
            <li>项目公示页（每周活动与加分名单）：<span className="mono">cxcy.gdupt.edu.cn/sztz1/xmgs.htm</span></li>
            <li>校素拓邮箱：<span className="mono">xiaosutuo@163.com</span>（每周一 12:30 前上交活动登记表）</li>
            <li>核心文件：《广东石油化工学院大学生素质拓展学分实施办法》（广油〔2016〕12 号）</li>
          </ul>
        </div>

        <div className="alert alert-warn">
          <b>宣传口径提醒</b>：活动宣传中不应出现明确的素拓分，或以素拓分为条件诱导参加。
          规范表述是「该活动项目已规划为素拓项目，参加者经检查考核合格后可获得相应的素质拓展学分」。
        </div>
      </section>
    </div>
  )
}
