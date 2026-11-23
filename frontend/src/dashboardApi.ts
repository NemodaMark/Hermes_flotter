import { request } from './api'
import type { Vehicle } from './api'

export type DashboardCar = {
  vehicle: Vehicle; bodyType: string; color: string | null; isAssignedToMe: boolean
  inspectionDueDate: string | null; insuranceDueDate: string | null; nextServiceDate: string | null; nextServiceKm: number | null
  serviceAppointmentAt?: string | null
  bookingEnabled?: boolean | null
}
export type Dashboard = {
  mode: 'Overview' | 'Vehicle'; priority: number; sourceGroup: string | null; canReadVehicles: boolean
  canReadOverview: boolean; canReadMileage?: boolean; canRecordMileage?: boolean; mileageDueMonth?: string | null; today: string; vehicles: DashboardCar[]
}
export type DashboardOverview = {
  today: string
  vehicles: DashboardCar[]
  monthlyMileage: { month: string; kilometers: number | null }[]
  topVehicles: { vehicleId: string; registration: string; make: string; model: string; kilometers: number }[]
}
export type OverviewFilters = { search: string; status: string; months: number; includeMileage: boolean }
export type MileageChartData = {
  firstMonth: string; months: number; canSelectPeople: boolean; people: { id: string; name: string }[]
  points: { userId: string | null; month: string; kilometers: number }[]
}

export const dashboardApi = {
  read: (tenantId: string, signal?: AbortSignal) => request<Dashboard>('/api/v1/dashboard', { tenantId, signal }),
  overview: (tenantId: string, site: string, signal?: AbortSignal, filters?: OverviewFilters) => {
    const params = new URLSearchParams({ site })
    if (filters) {
      params.set('search', filters.search)
      params.set('status', filters.status)
      params.set('months', String(filters.months))
      params.set('includeMileage', String(filters.includeMileage))
    }
    return request<DashboardOverview>(`/api/v1/dashboard/overview?${params}`, { tenantId, signal })
  },
  mileageChart: (tenantId: string, months: number, people: string[], signal?: AbortSignal) => {
    const params = new URLSearchParams({ months: String(months) })
    for (const id of people) params.append('userId', id)
    return request<MileageChartData>(`/api/v1/dashboard/mileage?${params}`, { tenantId, signal })
  },
  configure: (id: string, mode: string, priority: number, version: number) => request(`/api/v1/permission-groups/${id}/dashboard`, { method: 'PUT', body: { mode, priority, version } }),
}
