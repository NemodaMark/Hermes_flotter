import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { pdfAssets } from './pdfAssets.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pdfAssets()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:5080' },
      '/health': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:5080' },
    },
  },
})
