import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react'
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

export function PdfPreview({ blob, name }: { blob: Blob; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(100)
  const [width, setWidth] = useState(0)
  const [rendered, setRendered] = useState<{ key: string; error: string } | null>(null)
  const renderKey = `${page}:${zoom}:${width}`
  const rendering = rendered?.key !== renderKey
  const renderError = rendered?.key === renderKey ? rendered.error : ''
  const surface = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    let loading: PDFDocumentLoadingTask | undefined
    void (async () => {
      const [library, bytes] = await Promise.all([import('pdfjs-dist'), blob.arrayBuffer()])
      if (cancelled) return
      library.GlobalWorkerOptions.workerSrc = workerUrl
      const assets = `${import.meta.env.BASE_URL}pdfjs/${library.version}/`
      // Render page content only; no scripting engine, interactive links, forms or external viewer is loaded.
      loading = library.getDocument({ data: new Uint8Array(bytes), cMapUrl: `${assets}cmaps/`, cMapPacked: true,
        standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/`, enableXfa: false, maxImageSize: 32_000_000 })
      const document = await loading.promise
      if (!cancelled) setPdf(document)
    })().catch(e => {
      if (!cancelled) setError(e?.name === 'PasswordException'
        ? 'Ez a PDF jelszóval védett. Megnyitásához töltsd le az eredeti fájlt.'
        : 'A PDF nem jeleníthető meg. Az eredeti fájlt a Letöltés gombbal érheted el.')
    })
    return () => { cancelled = true; void loading?.destroy().catch(() => {}) }
  }, [blob])
  useEffect(() => {
    const element = surface.current
    if (!element) return
    const observer = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!pdf || !width) return
    let cancelled = false
    let task: RenderTask | undefined
    void pdf.getPage(page).then(async pdfPage => {
      if (cancelled || !canvas.current) return
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: Math.max(0.1, (width - 32) / base.width) * zoom / 100 })
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12_000_000 / (viewport.width * viewport.height)))
      const element = canvas.current
      element.width = Math.max(1, Math.floor(viewport.width * ratio)); element.height = Math.max(1, Math.floor(viewport.height * ratio))
      element.style.width = `${viewport.width}px`; element.style.height = `${viewport.height}px`
      task = pdfPage.render({ canvas: element, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
      await task.promise
      if (!cancelled) setRendered({ key: renderKey, error: '' })
    }).catch(() => { if (!cancelled) setRendered({ key: renderKey, error: 'Ez az oldal nem jeleníthető meg. Próbálj másik oldalt, vagy töltsd le az eredeti PDF-et.' }) })
    return () => { cancelled = true; task?.cancel() }
  }, [pdf, page, zoom, width, renderKey])
  return <>
    <div className="document-preview-toolbar" aria-label="PDF vezérlők">
      <button className="icon-button" aria-label="Előző PDF-oldal" disabled={!pdf || page <= 1 || rendering} onClick={() => setPage(x => x - 1)}><ChevronLeft size={18} /></button>
      <output aria-label="PDF-oldal">{page} / {pdf?.numPages ?? '–'}</output>
      <button className="icon-button" aria-label="Következő PDF-oldal" disabled={!pdf || page >= pdf.numPages || rendering} onClick={() => setPage(x => x + 1)}><ChevronRight size={18} /></button>
      <button className="icon-button" aria-label="Kicsinyítés" disabled={!pdf || zoom <= 50 || rendering} onClick={() => setZoom(x => x - 25)}><ZoomOut size={18} /></button>
      <output aria-label="Nagyítás">{zoom}%</output>
      <button className="icon-button" aria-label="Nagyítás" disabled={!pdf || zoom >= 200 || rendering} onClick={() => setZoom(x => x + 25)}><ZoomIn size={18} /></button>
      <button className="secondary-button" disabled={!pdf || rendering} onClick={() => setZoom(100)}>Szélességhez igazítás</button>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : <>
      {(!pdf || rendering) && <p className="field-hint" role="status">PDF-oldal betöltése…</p>}
      {renderError && <p className="form-error" role="alert">{renderError}</p>}
    </>}
    <div className="document-preview-surface" ref={surface}>
      {!error && <canvas key={`${page}:${zoom}:${width}`} ref={canvas} role="img" aria-label={`${name} – ${page}. oldal`} hidden={!pdf || rendering || !!renderError} />}
    </div>
  </>
}
