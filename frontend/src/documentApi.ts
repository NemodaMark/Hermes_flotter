import { request } from './api'

export type DocumentKind = 'leases' | 'services' | 'vehicle'
export const documentCategories: Record<string, string> = { Registration: 'Forgalmi engedély', Insurance: 'Biztosítás', Inspection: 'Műszaki vizsga' }
export type VehicleDocument = {
  id: string; fileName: string; contentType: string; byteLength: number; sha256: string
  uploadedBy: string; uploadedAt: string; version: number; isWithdrawn: boolean
  statusReason: string | null; statusChangedBy: string | null; statusChangedAt: string | null
  category?: string | null
}
export type DocumentCollection = { items: VehicleDocument[]; parentVersion: number; vehicleVersion: number; totalBytes: number }
export type DocumentChange = { document: VehicleDocument; parentVersion: number; vehicleVersion: number }
const path = (vehicleId: string, kind: DocumentKind, parentId: string) => kind === 'vehicle' ? `/api/v1/vehicles/${vehicleId}/documents` : `/api/v1/vehicles/${vehicleId}/${kind}/${parentId}/documents`
export const documentApi = {
  list: (tenantId: string, car: string, kind: DocumentKind, parent: string, signal?: AbortSignal) =>
    request<DocumentCollection>(path(car, kind, parent), { tenantId, signal }),
  upload: (tenantId: string, car: string, kind: DocumentKind, parent: string, file: File, version: number, category?: string) => {
    const body = new FormData()
    body.set('file', file)
    body.set('version', String(version))
    if (kind === 'vehicle' && category) body.set('category', category)
    return request<DocumentChange>(path(car, kind, parent), { tenantId, body })
  },
  status: (tenantId: string, car: string, kind: DocumentKind, parent: string, file: VehicleDocument, isWithdrawn: boolean, reason: string, parentVersion: number) =>
    request<DocumentChange>(`${path(car, kind, parent)}/${file.id}/status`, { tenantId, method: 'PATCH', body: { isWithdrawn, reason, version: file.version, parentVersion } }),
  content: (tenantId: string, car: string, kind: DocumentKind, parent: string, id: string, signal?: AbortSignal) =>
    request<Blob>(`${path(car, kind, parent)}/${id}/content`, { tenantId, responseType: 'blob', signal }),
}
export const canPreviewDocument = (doc: VehicleDocument) => !doc.isWithdrawn && ['application/pdf', 'image/jpeg', 'image/png'].includes(doc.contentType)
export function saveDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  // Let the browser begin reading the blob before releasing the temporary URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
