import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { pdfAssets } from './pdfAssets.ts'
import { readFileSync } from 'node:fs'

const certificate = process.env.HERMES_DEV_TLS_CERT
const key = process.env.HERMES_DEV_TLS_KEY
const https = certificate && key ? { cert: readFileSync(certificate), key: readFileSync(key) } : undefined
const target = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:5080'

export default defineConfig({
  plugins: [react(), pdfAssets()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    https,
    proxy: {
      '/api': { target, headers: { 'X-Forwarded-Proto': https ? 'https' : 'http' } },
      '/health': { target },
    },
  },
})
