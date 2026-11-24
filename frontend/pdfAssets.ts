import { cpSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ResolvedConfig } from 'vite'

// Keep PDF fonts, character maps and image decoders local in development and production.
export function pdfAssets(): Plugin {
  const source = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url))
  const version = (JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8')) as { version: string }).version
  const folders = ['cmaps', 'standard_fonts', 'wasm']
  const files = new Map<string, string>(folders.flatMap(folder => readdirSync(resolve(source, folder)).map(file => [`/pdfjs/${version}/${folder}/${file}`, resolve(source, folder, file)] as const)))
  files.set(`/pdfjs/${version}/LICENSE`, resolve(source, 'LICENSE'))
  let config: ResolvedConfig
  return {
    name: 'local-pdf-assets',
    configResolved(value) { config = value },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] ?? ''
        if (!path.startsWith('/pdfjs/')) { next(); return }
        const file = files.get(path)
        if (!file) { response.statusCode = 404; response.end(); return }
        response.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        response.end(readFileSync(file))
      })
    },
    configurePreviewServer(server) {
      const output = resolve(config.root, config.build.outDir)
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] ?? ''
        // Match production's 404 for missing assets before the SPA rewrites the request to index.html.
        if (!path.startsWith('/pdfjs/') || (files.has(path) && existsSync(resolve(output, `.${path}`)))) {
          next()
          return
        }
        response.statusCode = 404
        response.end()
      })
    },
    closeBundle() {
      if (config.command !== 'build') return
      for (const folder of folders) cpSync(resolve(source, folder), resolve(config.root, config.build.outDir, 'pdfjs', version, folder), { recursive: true })
      cpSync(resolve(source, 'LICENSE'), resolve(config.root, config.build.outDir, 'pdfjs', version, 'LICENSE'))
    },
  }
}
