import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session, Tenant } from './api'
import { vehicleKey } from './api'
import { fleetApi } from './fleetApi'

export function useVehicleDetails(user: Session, tenant: Tenant, id: string) {
  const client = useQueryClient()
  const record = useQuery({ queryKey: ['fleet-management', tenant.id, id, 'vehicle'], queryFn: ({ signal }) => fleetApi.vehicle(tenant.id, id, signal), retry: false })
  const can = (code: string) => !record.isError && !!record.data && (record.data.vehicle.permissions ?? tenant.permissions).includes(code)
  const changed = async () => {
    await Promise.all([
      ['fleet-management', tenant.id], vehicleKey(user.id, tenant.id), ['organization'],
      ['vehicle-photos', tenant.id, id], ['vehicle-assignee', tenant.id, id], ['vehicle-assignee-history', tenant.id, id],
      ['person-profile'], ['vehicle-catalog', tenant.id], ['system-audit'], ['dashboard'],
    ].map(queryKey => client.invalidateQueries({ queryKey })))
  }
  return { record, can, changed }
}
