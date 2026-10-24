import { request } from './api'
import type { Vehicle } from './api'

export type DashboardCar = {
  vehicle: Vehicle; bodyType: string; color: string | null; isAssignedToMe: boolean
  inspectionDueDate: string | null; insuranceDueDate: string | null; nextServiceDate: string | null; nextServiceKm: number | null
}
export type Dashboard = { mode: 'Overview' | 'Vehicle'; priority: number; sourceGroup: string | null; canReadVehicles: boolean; vehicles: DashboardCar[] }
export const dashboardApi = {
  read: (tenantId: string, signal?: AbortSignal) => request<Dashboard>('/api/v1/dashboard', { tenantId, signal }),
  configure: (id: string, mode: string, priority: number, version: number) => request(`/api/v1/permission-groups/${id}/dashboard`, { method: 'PUT', body: { mode, priority, version } }),
}
