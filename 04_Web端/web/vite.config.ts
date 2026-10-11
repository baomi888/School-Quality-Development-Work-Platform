import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 构建时间戳：注入到前端，页面上常驻显示。
// 用途：解决「我改了但你看不到」这类扯皮 —— 打开页面一眼就能确认跑的是哪一版构建。
const d = new Date()
const pad = (n: number) => String(n).padStart(2, '0')
const STAMP = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`

// 构建产物直接输出到引擎的静态目录，由 Python 服务统一托管
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __BUILD_STAMP__: JSON.stringify(STAMP),
  },
  build: {
    outDir: '../engine/web_dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // ECharts 只在「数据看板」用到，单独切一个 chunk，首屏不必为它买单
        manualChunks: {
          echarts: ['echarts'],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8765',
    },
  },
})
