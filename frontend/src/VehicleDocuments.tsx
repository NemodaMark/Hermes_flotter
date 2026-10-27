import { Button } from './ui/Button'
import { Toggle } from './ui/Toggle'
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, Eye, RefreshCw, Upload } from 'lucide-react'
import { AccessDialog } from './AccessDialog'
import { NotesField, QueryMessage, SelectField } from './FleetFields'
import { canPreviewDocument, documentApi, documentCategories, saveDownload } from './documentApi'
import { DocumentPreview } from './DocumentPreview'
import type { DocumentChange, DocumentKind, VehicleDocument } from './documentApi'

export type DocumentTarget = { id: string; name: string; version: number; isVoided?: boolean }
const bytesText = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.ceil(bytes / 1024)).toLocaleString('hu-HU')} KB` : `${(bytes / 1024 / 1024).toLocaleString('hu-HU', { maximumFractionDigits: 1 })} MB`
const maxBytes = 10 * 1024 * 1024

export function VehicleDocuments({ tenantId, vehicleId, registration, kind, target, canRead, canManage, onChanged, onClose, embedded = false }: {
  tenantId: string; vehicleId: string; registration: string; kind: DocumentKind; target: DocumentTarget
  canRead: boolean; canManage: boolean; onChanged: (message?: string) => Promise<void>; onClose: () => void; embedded?: boolean
}) {
  const client = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [version, setVersion] = useState(target.version)
  const [showWithdrawn, setShowWithdrawn] = useState(false)
  const [change, setChange] = useState<{ file: VehicleDocument; withdrawn: boolean } | null>(null)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState('Registration')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const previewButton = useRef<HTMLButtonElement | null>(null)
  const key = ['fleet-management', tenantId, vehicleId, kind, target.id, 'documents']
  const list = useQuery({ queryKey: key, queryFn: ({ signal }) => documentApi.list(tenantId, vehicleId, kind, target.id, signal), enabled: canRead, retry: false })
  const parentVersion = list.data?.parentVersion ?? Math.max(version, target.version)
  async function changed(result: DocumentChange, text: string) {
    setVersion(result.parentVersion)
    setMessage(text)
    await client.invalidateQueries({ queryKey: key })
    await onChanged()
  }
  const upload = useMutation({
    mutationFn: () => kind === 'vehicle' ? documentApi.upload(tenantId, vehicleId, kind, target.id, file!, parentVersion, category) : documentApi.upload(tenantId, vehicleId, kind, target.id, file!, parentVersion),
    onSuccess: async result => {
      setFile(null)
      if (input.current) input.current.value = ''
      await changed(result, `${result.document.fileName} feltöltve.`)
    },
  })
  const status = useMutation({
    mutationFn: () => documentApi.status(tenantId, vehicleId, kind, target.id, change!.file, change!.withdrawn, reason, parentVersion),
    onSuccess: async result => { setChange(null); setReason(''); await changed(result, result.document.isWithdrawn ? 'A dokumentum visszavonva. Az előzménye megmaradt.' : 'A dokumentum visszaállítva.') },
  })
  const download = useMutation({ mutationFn: async (doc: VehicleDocument) => saveDownload(await documentApi.content(tenantId, vehicleId, kind, target.id, doc.id), doc.fileName) })
  const pending = upload.isPending || status.isPending || download.isPending
  const invalidFile = file && (file.size < 1 || file.size > maxBytes || !/\.(pdf|jpe?g|png|docx|xlsx)$/i.test(file.name))
  const items = list.data?.items.filter(x => (showWithdrawn || !x.isWithdrawn) && (!categoryFilter || x.category === categoryFilter)) ?? []
  const editable = canManage && !target.isVoided
  const preview = canRead && !list.error ? list.data?.items.find(x => x.id === previewId && canPreviewDocument(x)) : undefined
  useEffect(() => { if (!preview) previewButton.current?.focus() }, [preview])
  const previewContent = preview && <DocumentPreview key={`${tenantId}:${vehicleId}:${kind}:${target.id}:${preview.id}`} tenantId={tenantId} vehicleId={vehicleId} kind={kind} parentId={target.id} document={preview} onBack={() => setPreviewId(null)} onDownload={() => download.mutate(preview)} downloading={download.isPending} downloadError={download.error?.message} />
  const documents = <>
    {editable && <form className="document-upload" onSubmit={e => { e.preventDefault(); if (file && !invalidFile) { setMessage(''); upload.mutate() } }}>
      {kind === 'vehicle' && <SelectField label="Dokumentumtípus" value={category} options={documentCategories} required disabled={pending} onChange={setCategory} />}
      <label className="org-field"><span>Fájl kiválasztása</span><input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" disabled={pending} onChange={e => { setFile(e.target.files?.[0] ?? null); upload.reset(); setMessage('') }} /></label>
      <p className="field-hint">PDF, JPG, PNG, DOCX vagy XLSX · legfeljebb 10 MB fájlonként.</p>
      {invalidFile && <p className="form-error" role="alert">Válassz megfelelő típusú, nem üres, legfeljebb 10 MB-os fájlt.</p>}
      <Button className="primary-button" disabled={pending || !file || !!invalidFile || canRead && list.isPending}><Upload size={16} />{upload.isPending ? 'Feltöltés…' : 'Feltöltés'}</Button>
    </form>}
    {canRead ? <>
      <div className="document-tools"><Toggle checked={showWithdrawn} onChange={setShowWithdrawn}>Visszavontak is</Toggle>
        {kind === 'vehicle' && <SelectField label="Szűrés dokumentumtípus szerint" value={categoryFilter} options={{ '': 'Minden dokumentumtípus', ...documentCategories }} onChange={setCategoryFilter} />}
        <Button className="icon-button" aria-label="Dokumentumlista frissítése" disabled={pending || list.isFetching} onClick={() => { upload.reset(); status.reset(); void list.refetch() }}><RefreshCw size={17} /></Button></div>
      <QueryMessage pending={list.isPending} error={list.error} retry={() => void list.refetch()} />
      {!list.error && list.data && <ul className="document-list">{items.map(doc => <li key={doc.id}>
        <div><strong>{doc.fileName}</strong>{doc.category && <p className="document-category">{documentCategories[doc.category] ?? doc.category}</p>}<p className="fleet-detail-caption">{bytesText(doc.byteLength)} · {new Date(doc.uploadedAt).toLocaleString('hu-HU')} · {doc.uploadedBy}</p>
          {doc.isWithdrawn && <p className="fleet-detail-caption">Visszavont · {doc.statusReason}</p>}</div>
        <div className="member-actions">
          {canPreviewDocument(doc) && <Button className="secondary-button" aria-label={`Megtekintés: ${doc.fileName}`} disabled={pending} onClick={e => { previewButton.current = e.currentTarget; download.reset(); setPreviewId(doc.id) }}><Eye size={15} />Megtekintés</Button>}
          {!doc.isWithdrawn && <Button className="secondary-button" aria-label={`Letöltés: ${doc.fileName}`} disabled={pending} onClick={() => download.mutate(doc)}><Download size={15} />Letöltés</Button>}
          {editable && <Button className="secondary-button" disabled={pending} onClick={() => { setChange({ file: doc, withdrawn: !doc.isWithdrawn }); setReason(''); status.reset() }}>{doc.isWithdrawn ? 'Visszaállítás' : 'Visszavonás'}</Button>}
        </div>
      </li>)}{!items.length && <li>Még nincs megjeleníthető dokumentum.</li>}</ul>}
    </> : <p className="field-hint">A dokumentumok listázásához és letöltéséhez a bejegyzés megtekintési joga is szükséges.</p>}
    {change && editable && <form className="document-status" onSubmit={e => { e.preventDefault(); status.mutate() }}>
      <p><strong>{change.withdrawn ? 'Visszavonás' : 'Visszaállítás'}: {change.file.fileName}</strong></p>
      <NotesField label="Indoklás" required value={reason} maxLength={500} onChange={setReason} disabled={pending} />
      <div className="dialog-actions"><Button type="button" className="secondary-button" disabled={pending} onClick={() => setChange(null)}>Mégse</Button><Button className="primary-button" disabled={pending}>Állapot mentése</Button></div>
    </form>}
    {[upload.error, status.error, download.error].filter(Boolean).map((error, index) => <p key={index} className="form-error" role="alert">{error!.message}</p>)}
    {message && <p className="access-success" role="status">{message}</p>}
    {!embedded && <div className="dialog-actions"><Button className="secondary-button" disabled={pending} onClick={onClose}>Bezárás</Button></div>}
  </>
  return embedded ? <section className="vehicle-documents" aria-label="Járműokmányok">
    <p className="access-description">Forgalmi engedély, biztosítás és műszaki vizsga dokumentumai.</p>
    {documents}
    {preview && <AccessDialog className="document-preview-dialog" title="Dokumentum előnézete" pending={pending} onClose={() => setPreviewId(null)}><p className="access-description">{registration} · {documentCategories[preview.category ?? ''] ?? target.name}</p>{previewContent}</AccessDialog>}
  </section> : <AccessDialog className={preview ? 'document-preview-dialog' : ''} title={preview ? 'Dokumentum előnézete' : kind === 'vehicle' ? 'Járműokmányok' : kind === 'leases' ? 'Lízingszerződés dokumentumai' : 'Szervizdokumentumok'} pending={pending} onClose={onClose}>
    <p className="access-description">{registration} · {target.name}</p>{previewContent}<div hidden={!!preview}>{documents}</div>
  </AccessDialog>
}
