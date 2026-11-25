import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { chromium } = await import(process.env.HERMES_PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.HERMES_PLAYWRIGHT_MODULE)).href : 'playwright')
const path = new URL('../diagrams/', import.meta.url)
const browser = await chromium.launch({ executablePath: process.env.HERMES_BROWSER_BINARY })
try {
  const page = await browser.newPage()
  await page.setContent('<!doctype html><title>HERMES diagrams</title>')
  await page.addScriptTag({ path: resolve(process.env.HERMES_MERMAID_BUNDLE) })
  const sources = (await readdir(path)).filter(name => name.endsWith('.mmd')).sort()
  for (const name of sources) {
    const source = await readFile(new URL(name, path), 'utf8')
    const svg = await page.evaluate(async ({ id, source }) => {
      window.mermaid.initialize({
        startOnLoad: false, theme: 'neutral', securityLevel: 'strict',
        flowchart: { htmlLabels: false },
        themeVariables: { fontFamily: 'Arial, sans-serif', fontSize: '16px' },
      })
      const { svg } = await window.mermaid.render(id, source)
      const element = new DOMParser().parseFromString(svg, 'text/html').querySelector('svg')
      return new XMLSerializer().serializeToString(element)
    }, { id: 'hermes-' + name.slice(0, 2), source })
    await writeFile(new URL(name.replace(/\.mmd$/, '.svg'), path), svg + '\n')
    console.log(name)
  }
} finally {
  await browser.close()
}
