import { lazy, Suspense, useEffect, useState } from 'react'
import { api } from './api'
import Work from './pages/Work'
import LedgerView from './pages/LedgerView'
import Guide from './pages/Guide'
import Hub from './pages/Hub'
import HistoryView from './pages/HistoryView'
import Embedded from './pages/Embedded'

// ECharts 体积大、且只有「数据看板」用到 —— 按需加载，首屏不为它买单
const Dashboard = lazy(() => import('./pages/Dashboard'))

type Tab = 'hub' | 'work' | 'merge' | 'agent' | 'ledger' | 'stats' | 'guide' | 'history'

const TABS: { key: Tab; label: string }[] = [
  { key: 'work', label: '本周工作' },
  { key: 'merge', label: '活动汇总' },
  { key: 'agent', label: '智能体' },
  { key: 'ledger', label: '排班台账' },
  { key: 'stats', label: '数据看板' },
  { key: 'history', label: '历史归档' },
  { key: 'guide', label: '使用说明' },
]

// 嵌入页走 iframe，本身已经有内边距，不要再套 container 的留白
const EMBED_TABS: Tab[] = ['merge', 'agent']

const TAB_KEYS = TABS.map((t) => t.key) as Tab[]

/** 地址栏 hash ↔ tab 双向同步：可以收藏 / 分享直达链接，如 #agent */
function readHash(): Tab | null {
  const h = (window.location.hash || '').replace(/^#/, '').trim()
  return h && (TAB_KEYS as string[]).includes(h) ? (h as Tab) : null
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() => readHash() ?? 'hub')
  const [term, setTerm] = useState('')
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    // 构建时间戳也打到控制台，方便远程排查「你看到的到底是哪一版」
    console.info(`[质检部周工作平台] 构建时间 ${__BUILD_STAMP__}`)
  }, [])

  // tab → hash
  useEffect(() => {
    const want = tab === 'hub' ? '' : `#${tab}`
    if ((window.location.hash || '') !== want) {
      history.replaceState(null, '', want || window.location.pathname)
    }
  }, [tab])

  // 浏览器前进/后退 ↔ hash → tab
  useEffect(() => {
    const onPop = () => setTab(readHash() ?? 'hub')
    window.addEventListener('popstate', onPop)
    window.addEventListener('hashchange', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('hashchange', onPop)
    }
  }, [])

  useEffect(() => {
    api
      .health()
      .then((h) => setTerm(h.term))
      .catch(() => setOffline(true))
  }, [])

  const goHub = () => setTab('hub')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={goHub} style={{ cursor: 'pointer' }}>
          <span className="brand-mark">质</span>
          <div>
            <div className="brand-title">质检部周工作平台</div>
            <div className="brand-sub">{term || (offline ? '未连接引擎' : '加载中…')}</div>
          </div>
        </div>
        {/* 常驻构建时间戳：页面样式与预期不符时，先核对这里 */}
        <span className="build-stamp" title="当前页面所属的构建时间">
          构建 {__BUILD_STAMP__}
        </span>
        {tab !== 'hub' && (
          <nav className="tabs" role="tablist" aria-label="主导航">
            <button className="tab tab-back" onClick={goHub} aria-label="返回首页">
              ← 首页
            </button>
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={`tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </nav>
        )}
      </header>

      <main
        className={
          tab === 'hub'
            ? 'container hub-container'
            : EMBED_TABS.includes(tab)
              ? 'container container-embed'
              : 'container'
        }
      >
        {offline && tab !== 'hub' && (
          <div className="alert alert-danger" style={{ marginTop: 20 }}>
            连不上引擎服务（127.0.0.1:8765）。请先运行 <span className="mono">启动.bat</span>，再刷新本页。
          </div>
        )}
        <Suspense fallback={<div className="empty"><div className="empty-title">正在加载…</div></div>}>
          {tab === 'hub' && <Hub onNavigate={setTab} />}
          {tab === 'work' && <Work />}
          {tab === 'merge' && <Embedded src="/merge" title="活动登记表汇总" />}
          {tab === 'agent' && <Embedded src="/agent" title="智能体" />}
          {tab === 'ledger' && <LedgerView />}
          {tab === 'stats' && <Dashboard />}
          {tab === 'history' && <HistoryView />}
          {tab === 'guide' && <Guide />}
        </Suspense>
      </main>
    </div>
  )
}
