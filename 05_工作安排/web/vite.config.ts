import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../engine/web_dist',
    emptyOutDir: true,
  },
  define: {
    __BUILD_STAMP__: JSON.stringify(new Date().toISOString().replace('T', ' ').slice(0, 19)),
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8766',
    },
  },
})
