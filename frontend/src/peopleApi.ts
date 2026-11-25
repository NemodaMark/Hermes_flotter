import { request } from './api'
import type { Page } from './api'
export type Person = { id: string; displayName: string; email: string; phoneNumber: string | null; avatarRevision: string | null; cardBackgroundRevision?: string | null }
export type PersonVehicle = { id: string; registration: string; make: string; model: string; siteName: string | null }
export type PersonProfile = { person: Person; version: number; canEdit: boolean; canManageAccount: boolean; vehicles: PersonVehicle[] }
export type Photo = { id: string; slot: number; sha256: string; uploadedAt: string }
export type Photos = { items: Photo[]; vehicleVersion: number }
export type AssignmentHistory = { id: string; userId: string; displayName: string; assignedAt: string; releasedAt: string | null; assignedBy: string; assignedByDisplayName: string; releasedBy: string | null; releasedByDisplayName: string | null }
const personPath = (id: string) => `/api/v1/people/${encodeURIComponent(id)}`
export const peopleApi = {
  colleagues: (tenantId: string, page: number, search: string, signal?: AbortSignal) => request<Page<Person>>(`/api/v1/people?${new URLSearchParams({ page: String(page), search })}`, { tenantId, signal }),
  profile: (id: string, tenantId?: string, signal?: AbortSignal) => request<PersonProfile>(personPath(id), { tenantId, signal }),
  editSelf: (body: { displayName: string; phoneNumber: string | null; version: number }) => request<Person>('/api/v1/people/me', { method: 'PUT', body }),
  avatarPath: (id: string) => `${personPath(id)}/avatar`,
  avatar: (id: string, file: File, version: number) => request<Person>(`${personPath(id)}/avatar`, { body: imageForm(file, version) }),
  deleteAvatar: (id: string, version: number) => request<Person>(`${personPath(id)}/avatar?version=${version}`, { method: 'DELETE' }),
  cardBackgroundPath: (id: string) => `${personPath(id)}/card-background`,
  saveCardBackground: (file: File, version: number) => request<Person>('/api/v1/people/me/card-background', { body: imageForm(file, version) }),
  deleteCardBackground: (version: number) => request<Person>(`/api/v1/people/me/card-background?version=${version}`, { method: 'DELETE' }),
}
export function imageForm(file: File, version: number) { const form = new FormData(); form.set('file', file); form.set('version', String(version)); return form }
const carPath = (id: string) => `/api/v1/vehicles/${id}`
export const mediaApi = {
  photos: (tenantId: string, id: string, signal?: AbortSignal) => request<Photos>(`${carPath(id)}/photos`, { tenantId, signal }),
  photoPath: (id: string, photo: string) => `${carPath(id)}/photos/${photo}`,
  upload: (tenantId: string, id: string, file: File, version: number) => request<Photos>(`${carPath(id)}/photos`, { tenantId, body: imageForm(file, version) }),
  remove: (tenantId: string, id: string, photo: string, version: number) => request<Photos>(`${carPath(id)}/photos/${photo}?version=${version}`, { tenantId, method: 'DELETE' }),
  assignee: (tenantId: string, id: string, signal?: AbortSignal) => request<{ current: { userId: string; displayName: string; assignedAt: string } | null }>(`${carPath(id)}/assignee`, { tenantId, signal }),
  assigneeHistory: (tenantId: string, id: string, page: number, signal?: AbortSignal) => request<Page<AssignmentHistory>>(`${carPath(id)}/assignee-history?${new URLSearchParams({ page: String(page) })}`, { tenantId, signal }),
  assigneeOptions: (tenantId: string, id: string, signal?: AbortSignal) => request<Person[]>(`${carPath(id)}/assignee-options`, { tenantId, signal }),
  assign: (tenantId: string, id: string, userId: string | null, version: number) => request(`${carPath(id)}/assignee`, { tenantId, method: 'PUT', body: { userId, version } }),
}
