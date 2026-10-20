import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Download, RefreshCw, ZoomIn, ZoomOut } from 'lucide-react'
import { documentApi } from './documentApi'
import type { DocumentKind, VehicleDocument } from './documentApi'
import { PdfPreview } from './PdfPreview'

type Content = { blob: Blob; imageUrl: string | null }

export function DocumentPreview({ tenantId, vehicleId, kind, parentId, document: doc, onBack, onDownload, downloading, downloadError }: {
  tenantId: string; vehicleId: string; kind: DocumentKind; parentId: string; document: VehicleDocument; onBack: () => void
  onDownload: () => void; downloading: boolean; downloadError?: string
}) {
  const [content, setContent] = useState<Content | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [zoom, setZoom] = useState(100)
  const [imageError, setImageError] = useState(false)
  const back = useRef<HTMLButtonElement>(null)
  useEffect(() => { back.current?.focus() }, [])
  useEffect(() => {
    const controller = new AbortController()
    let imageUrl: string | null = null
    void documentApi.content(tenantId, vehicleId, kind, parentId, doc.id, controller.signal).then(blob => {
      if (controller.signal.aborted) return
      if (blob.type !== doc.contentType) throw new Error('A fájl típusa nem egyezik a dokumentum adataival.')
      if (blob.type !== 'application/pdf') imageUrl = URL.createObjectURL(blob)
      setContent({ blob, imageUrl })
    }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Az előnézet nem tölthető be.') })
    return () => { controller.abort(); if (imageUrl) URL.revokeObjectURL(imageUrl) }
  }, [tenantId, vehicleId, kind, parentId, doc.id, doc.contentType, retry])
  return <section className="document-preview" aria-label={`Előnézet: ${doc.fileName}`}>
    <div className="document-preview-heading">
      <button ref={back} type="button" className="secondary-button" disabled={downloading} onClick={onBack}><ArrowLeft size={16} />Vissza a dokumentumokhoz</button>
      <strong>{doc.fileName}</strong>
      {content && <button type="button" className="secondary-button" disabled={downloading} onClick={onDownload}><Download size={16} />{downloading ? 'Letöltés…' : 'Letöltés'}</button>}
    </div>
    {downloadError && <p className="form-error" role="alert">{downloadError}</p>}
    {error ? <div className="document-preview-message"><p className="form-error" role="alert">{error}</p><button className="secondary-button" onClick={() => { setContent(null); setError(''); setImageError(false); setZoom(100); setRetry(x => x + 1) }}><RefreshCw size={16} />Újrapróbálom</button></div>
      : !content ? <p className="document-preview-message" role="status">Dokumentum betöltése…</p>
      : content.imageUrl ? <>
        <div className="document-preview-toolbar" aria-label="Kép nagyítása">
          <button className="icon-button" aria-label="Kicsinyítés" disabled={zoom <= 50} onClick={() => setZoom(x => x - 25)}><ZoomOut size={18} /></button>
          <output aria-label="Nagyítás">{zoom}%</output>
          <button className="icon-button" aria-label="Nagyítás" disabled={zoom >= 200} onClick={() => setZoom(x => x + 25)}><ZoomIn size={18} /></button>
          <button className="secondary-button" onClick={() => setZoom(100)}>Szélességhez igazítás</button>
        </div>
        {imageError && <p className="form-error" role="alert">A kép nem jeleníthető meg. A Letöltés gombbal az eredeti fájl továbbra is elérhető.</p>}
        <div className="document-preview-surface"><img src={content.imageUrl} alt={doc.fileName} style={{ width: `${zoom}%` }} hidden={imageError} onError={() => setImageError(true)} /></div>
      </> : <PdfPreview blob={content.blob} name={doc.fileName} />}
  </section>
}
