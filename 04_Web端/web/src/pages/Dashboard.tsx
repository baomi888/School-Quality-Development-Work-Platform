import { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { api } from '../api'

/* ECharts 的配置只认字面 hex，读不到 CSS 变量，所以这里单开一份常量。
   取值与 web/src/styles/tokens.css 保持一致（档案台：暖纸底 + 冷墨主色 + 正红强调）。
   仅浅色一套 —— 全站已统一为浅色。 */
const CHART_LIGHT = {
  ink: '#14151A', // 冷墨主色
  accent: '#B72C24', // 质检正红强调色
  grey: '#8a8a8a',
  faint: '#DFDAD0',
  muted: '#55575E',
  hair: '#DFDAD0',
  /** 环形图分段之间的缝，等于卡片底色 */
  surface: '#FCFBF8',
  /* 图内文字：对应 --fs-caption（11px），画布上同样读不到 CSS 变量 */
  text: 11,
}

type ChartPalette = typeof CHART_LIGHT

interface Stats {
  college_load: { college: string; count: number }[]
  per_week: { label: string; week: number; activities: number; colleges: number }[]
  campus_distribution: { campus: string; count: number }[]
  total_weeks: number
  total_activities: number
  college_pool: string[]
  ledger_file: string
}

function Chart({ option, height = 300 }: { option: any; height?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const inst = echarts.init(ref.current)
    inst.setOption(option)
    const onResize = () => inst.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      inst.dispose()
    }
  }, [option])
  return <div ref={ref} style={{ width: '100%', height }} />
}

export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.stats().then(setS).catch((e: any) => setErr(e?.message ?? '读取统计失败'))
  }, [])

  if (err) return <div className="alert alert-danger">{err}</div>
  if (!s) return <div className="empty"><div className="empty-title">加载中…</div></div>

  const C: ChartPalette = CHART_LIGHT

  const never = s.college_pool.filter((c) => !s.college_load.some((x) => x.college === c))

  const barOption = {
    grid: { left: 8, right: 24, top: 12, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const } },
    xAxis: {
      type: 'value' as const,
      minInterval: 1,
      splitLine: { lineStyle: { color: C.hair, type: 'dashed' } },
      axisLabel: { color: C.muted, fontSize: C.text },
    },
    yAxis: {
      type: 'category' as const,
      data: s.college_load.map((x) => x.college).reverse(),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: C.text },
    },
    series: [
      {
        type: 'bar' as const,
        data: s.college_load.map((x) => x.count).reverse(),
        barMaxWidth: 18,
        // 圆润风格：柱子带圆角
        itemStyle: {
          color: C.ink,
          borderRadius: [8, 8, 0, 0]
        },
        label: { show: true, position: 'right' as const, fontSize: C.text, color: C.muted },
      },
    ],
  }

  const weekOption = {
    grid: { left: 8, right: 20, top: 24, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis' as const },
    legend: {
      data: ['活动数', '参与学院数'], right: 0, top: 0, itemHeight: 8,
      textStyle: { fontSize: C.text, color: C.muted },
    },
    xAxis: {
      type: 'category' as const,
      data: s.per_week.map((x) => x.label),
      axisLine: { lineStyle: { color: C.hair } },
      axisTick: { show: false },
      axisLabel: { color: C.muted, fontSize: C.text },
    },
    yAxis: {
      type: 'value' as const,
      minInterval: 1,
      splitLine: { lineStyle: { color: C.hair } },
      axisLabel: { color: C.muted, fontSize: C.text },
    },
    series: [
      {
        name: '活动数', type: 'bar' as const, data: s.per_week.map((x) => x.activities),
        barMaxWidth: 26, itemStyle: { color: C.ink, borderRadius: [6, 6, 0, 0] },
      },
      {
        name: '参与学院数', type: 'line' as const, data: s.per_week.map((x) => x.colleges),
        // 折线走粉紫强调色
        smooth: true, symbolSize: 8, lineStyle: { color: C.accent, width: 3 }, itemStyle: { color: C.accent },
      },
    ],
  }

  const pieOption = {
    tooltip: { trigger: 'item' as const, formatter: '{b}: {c} 个活动 ({d}%)' },
    legend: { bottom: 0, itemHeight: 10, textStyle: { fontSize: C.text, color: C.muted } },
    series: [
      {
        type: 'pie' as const,
        radius: ['45%', '70%'],
        center: ['50%', '44%'],
        avoidLabelOverlap: true,
        // 圆润风格：更大的圆角和柔和边框
        itemStyle: { borderColor: C.surface, borderWidth: 3, borderRadius: 6 },
        label: { fontSize: C.text, color: C.muted },
        data: s.campus_distribution.map((x, i) => ({
          name: x.campus,
          value: x.count,
          // 主色 / 强调 / 两级灰，按 tokens.css 的语义顺序排
          itemStyle: { color: [C.ink, C.accent, C.grey, C.faint][i % 4] },
        })),
      },
    ],
  }

  return (
    <>
      <div className="grid3" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">累计记录周次</div>
          <div className="stat-value">{s.total_weeks}</div>
        </div>
        <div className="stat">
          <div className="stat-label">累计检查活动</div>
          <div className="stat-value">{s.total_activities}</div>
        </div>
        <div className="stat">
          <div className="stat-label">已出动学院 / 学院总数</div>
          <div className="stat-value">{s.college_load.length} <span className="small muted">/ {s.college_pool.length}</span></div>
        </div>
      </div>

      <section className="card">
        <div className="card-head"><h2 className="card-title">各学院出动次数</h2></div>
        <p className="card-desc">谁干得多、谁还没轮到，一眼看清。差距太大时可以优先安排排名靠后的学院。</p>
        {s.college_load.length ? <Chart option={barOption} height={Math.max(240, s.college_load.length * 26)} />
          : <div className="empty"><div className="empty-title">暂无数据</div></div>}
        {never.length > 0 && (
          <div className="alert" style={{ marginTop: 12 }}>
            <strong>还没安排过的学院（{never.length} 个）：</strong>
            <div className="chips" style={{ marginTop: 8 }}>
              {never.map((c) => <span key={c} className="chip">{c}</span>)}
            </div>
          </div>
        )}
      </section>

      <div className="grid2">
        <section className="card">
          <div className="card-head"><h2 className="card-title">每周工作量</h2></div>
          {s.per_week.length ? <Chart option={weekOption} /> : <div className="empty"><div className="empty-title">暂无数据</div></div>}
        </section>
        <section className="card">
          <div className="card-head"><h2 className="card-title">校区分布</h2></div>
          {s.campus_distribution.length ? <Chart option={pieOption} /> : <div className="empty"><div className="empty-title">暂无数据</div></div>}
        </section>
      </div>

      <div className="small muted" style={{ marginTop: 8 }}>数据来源：<span className="mono">{s.ledger_file}</span></div>
    </>
  )
}
