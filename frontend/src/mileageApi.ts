import { request } from './api'

export type MileageMode = 'Entries' | 'Monthly'
export type MileageUsage = { month: string; totalKm: number; privateKm: number }
export type MileageEntry = { id: string; occurredOn: string; totalKm: number; privateKm: number; source: string; version: number; isVoided: boolean; recordedBy: string; recordedAt: string; updatedBy: string | null; updatedAt: string | null }
export type MileageReport = { userId: string; month: string; mode: MileageMode; totalKm: number; privateKm: number; monthlyLimitKm: number | null; version: number; submittedAt: string | null; updatedBy: string | null; updatedAt: string | null; dueMonth: string | null; entries: MileageEntry[] }
export type MileageUser = { userId: string; name: string; monthlyLimitKm: number | null; version: number }
const monthUrl = (month: string, userId: string, suffix = '') => `/api/v1/mileage/months/${month}${suffix}?userId=${encodeURIComponent(userId)}`
export const mileageApi = {
  read: (tenantId: string, userId: string, month: string, signal?: AbortSignal) => request<MileageReport>(monthUrl(month, userId), { tenantId, signal }),
  users: (tenantId: string, signal?: AbortSignal) => request<MileageUser[]>('/api/v1/mileage/accounts', { tenantId, signal }),
  limit: (tenantId: string, user: MileageUser, monthlyLimitKm: number | null) => request<MileageUser>(`/api/v1/mileage/accounts/${encodeURIComponent(user.userId)}`, { tenantId, method: 'PUT', body: { monthlyLimitKm, version: user.version } }),
  mode: (tenantId: string, report: MileageReport, mode: MileageMode) => request<MileageReport>(monthUrl(report.month, report.userId, '/mode'), { tenantId, method: 'PUT', body: { mode, version: report.version } }),
  save: (tenantId: string, report: MileageReport, data: { totalKm: number | null; privateKm: number | null; submit: boolean; confirmNoUsage: boolean; reason: string }) =>
    request<MileageReport>(monthUrl(report.month, report.userId), { tenantId, method: 'PUT', body: { ...data, version: report.version } }),
  entry: (tenantId: string, report: MileageReport, entry: MileageEntry | null, data: { occurredOn: string; totalKm: number; privateKm: number; reason: string }, voidEntry = false) =>
    request<MileageReport>(monthUrl(report.month, report.userId, `/entries${entry ? '/' + entry.id : ''}${voidEntry ? '/void' : ''}`), {
      tenantId, method: entry && !voidEntry ? 'PUT' : 'POST', body: { ...data, version: entry?.version ?? 0, monthVersion: report.version },
    }),
}
export const mileageMonth = (date: string) => date.slice(0, 7) + '-01'
export const localMileageDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
