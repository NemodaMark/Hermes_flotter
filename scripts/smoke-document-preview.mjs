import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const baseUrl = process.env.HERMES_BASE_URL ?? 'http://localhost:8080'
async function get(path) {
  const response = await fetch(new URL(path, baseUrl))
  assert.equal(response.status, 200, `Missing preview asset: ${path}`)
  return response
}
const html = await (await get('/')).text()
const entry = html.match(/<script[^>]+src="([^"]+)"/)
assert.ok(entry, 'The frontend entry module must exist')
const bundle = await (await get(entry[1])).text()
const worker = bundle.match(/[`"']([^`"']*pdf\.worker\.min-[^`"']+\.mjs)[`"']/)
assert.ok(worker, 'The bundled PDF worker must be discoverable')
const workerResponse = await get(worker[1])
assert.match(workerResponse.headers.get('content-type') ?? '', /(?:text|application)\/javascript/)
const manifest = JSON.parse(await readFile(new URL('../frontend/package.json', import.meta.url), 'utf8'))
const version = manifest.dependencies['pdfjs-dist']
assert.match(version, /^\d+\.\d+\.\d+$/)
const prefix = `/pdfjs/${version}/`
const wasm = await get(`${prefix}wasm/openjpeg.wasm`)
assert.match(wasm.headers.get('content-type') ?? '', /application\/wasm/)
assert.deepEqual([...new Uint8Array(await wasm.arrayBuffer()).subarray(0, 4)], [0, 97, 115, 109])
assert.ok((await (await get(`${prefix}standard_fonts/LiberationSans-Regular.ttf`)).arrayBuffer()).byteLength > 1000)
assert.equal((await fetch(new URL(`${prefix}missing.file`, baseUrl))).status, 404)
console.log('Document preview worker, fonts and image decoder are available with the correct content types.')
