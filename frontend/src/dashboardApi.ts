import { request } from './api'
import type { Vehicle } from './api'

export type DashboardCar = {
  vehicle: Vehicle; bodyType: string; color: string | null; isAssignedToMe: boolean
  inspectionDueDate: string | null; insuranceDueDate: string | null; nextServiceDate: string | null; nextServiceKm: number | null
  serviceAppointmentAt?: string | null
}
export type Dashboard = {
  mode: 'Overview' | 'Vehicle'; priority: number; sourceGroup: string | null; canReadVehicles: boolean
  canReadOverview: boolean; canRecordMileage?: boolean; mileageDueMonth?: string | null; today: string; vehicles: DashboardCar[]
}
export type DashboardOverview = {
  today: string
  vehicles: DashboardCar[]
  monthlyMileage: { month: string; kilometers: number | null }[]
  topVehicles: { vehicleId: string; registration: string; make: string; model: string; kilometers: number }[]
}
export const dashboardApi = {
  read: (tenantId: string, signal?: AbortSignal) => request<Dashboard>('/api/v1/dashboard', { tenantId, signal }),
  overview: (tenantId: string, site: string, signal?: AbortSignal) =>
    request<DashboardOverview>(`/api/v1/dashboard/overview?site=${encodeURIComponent(site)}`, { tenantId, signal }),
  configure: (id: string, mode: string, priority: number, version: number) => request(`/api/v1/permission-groups/${id}/dashboard`, { method: 'PUT', body: { mode, priority, version } }),
}
