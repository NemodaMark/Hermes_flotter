import { request } from './api'

export type SettlementRules = { freeKm: number; firstBandKm: number; firstRate: number; secondRate: number }
export type SettlementLine = { vehicleId: string; startKm: number | null; endKm: number | null; liters: number | null; privateKm: number | null; unitPrice: number | null; useRecordedFuel?: boolean; priceSource?: string | null }
export type SettlementDraft = { version: number; rules: SettlementRules; lines: SettlementLine[]; agreedAmount: number | null; agreementReason: string | null; reason: string | null }
export type SettlementResult = { vehicleId: string; totalKm: number | null; consumption: number | null; freeKm: number | null; paidKm: number | null; firstBandKm: number | null; secondBandKm: number | null; fuelAmount: number | null; firstAmount: number | null; secondAmount: number | null; amount: number | null }
export type SettlementCalculation = { lines: SettlementResult[]; standardAmount: number | null; amount: number | null; issues: string[] }
export type SettlementVehicle = { id: string; registration: string; odometerKm: number | null }
export type SettlementPolicy = { month: string; version: number; rules: SettlementRules }
export type SettlementOptions = { people: { id: string; name: string }[]; vehicles: SettlementVehicle[]; policy: SettlementPolicy }
export type SettlementSource = { vehicleId: string; fileName: string; sheet: string; originalAmount: number | null; formula: string | null; sha256: string }
export type SettlementReport = { userId: string; month: string; version: number; status: 'Draft' | 'Submitted' | 'Approved'; data: SettlementDraft; calculation: SettlementCalculation; sources: SettlementSource[]; vehicles: SettlementVehicle[]; updatedBy: string | null; updatedAt: string | null; approvedBy: string | null; approvedAt: string | null }
export type SettlementRevision = { version: number; status: string; actor: string; createdAt: string; reason: string | null; report: SettlementReport }
export type LegacySettlement = { id: string; fileName: string; sheet: string; month: string; registration: string; employee: string | null; startKm: number | null; endKm: number | null; liters: number | null; privateKm: number | null; unitPrice: number | null; rules: SettlementRules; originalAmount: number | null; formula: string | null; warnings: string[] }
const root = '/api/v1/fuel-settlements'
const url = (user: string, month: string, suffix = '') => `${root}/months/${month}${suffix}?userId=${encodeURIComponent(user)}`
export const settlementApi = {
  read: (tenantId: string, user: string, month: string, signal?: AbortSignal) => request<SettlementReport>(url(user, month), { tenantId, signal }),
  options: (tenantId: string, user: string, month: string, signal?: AbortSignal) => request<SettlementOptions>(`${root}/options?month=${month}${user ? '&userId=' + encodeURIComponent(user) : ''}`, { tenantId, signal }),
  preview: (tenantId: string, user: string, month: string, draft: SettlementDraft) => request<SettlementCalculation>(url(user, month, '/preview'), { tenantId, body: draft }),
  save: (tenantId: string, user: string, month: string, draft: SettlementDraft) => request<SettlementReport>(url(user, month), { tenantId, method: 'PUT', body: draft }),
  action: (tenantId: string, report: SettlementReport, action: string, reason: string | null = null) => request<SettlementReport>(url(report.userId, report.month, '/' + action), { tenantId, body: { version: report.version, reason } }),
  policy: (tenantId: string, month: string, version: number, rules: SettlementRules) => request<SettlementPolicy>(`${root}/policies/${month}`, { tenantId, method: 'PUT', body: { version, rules } }),
  history: (tenantId: string, user: string, month: string) => request<SettlementRevision[]>(url(user, month, '/history'), { tenantId }),
  export: (tenantId: string, report: SettlementReport) => request<Blob>(url(report.userId, report.month, '/export'), { tenantId, responseType: 'blob' }),
  source: (tenantId: string, report: SettlementReport, vehicle: string) => request<Blob>(url(report.userId, report.month, '/sources/' + vehicle), { tenantId, responseType: 'blob' }),
  importPreview: (tenantId: string, data: FormData) => request<LegacySettlement[]>(root + '/import/preview', { tenantId, body: data }),
  importDraft: (tenantId: string, data: FormData) => request<SettlementReport>(root + '/import/draft', { tenantId, body: data }),
}
export function saveSettlementFile(blob: Blob, name: string) {
  const address = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = address; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(address), 1000)
}
