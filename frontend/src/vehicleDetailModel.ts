import type { Tenant } from './api'
import type { VehicleRecord } from './fleetApi'
import type { StudioSection } from './VehicleStudio'

export const vehicleTaskNames: Record<StudioSection, string> = { data: 'Járműadatok', site: 'Telephely és használó', photos: 'Képek',
  services: 'Szerviz', documents: 'Dokumentumok', leases: 'Lízing', bookings: 'Foglalások', fuel: 'Tankolások',
  handovers: 'Átadás-átvétel', history: 'Kilométerelőzmények', assignees: 'Használati előzmények', audit: 'Módosítási napló' }

export function vehicleTaskAllowed(section: StudioSection, record: VehicleRecord, tenant: Tenant) {
  const can = (code: string) => (record.vehicle.permissions ?? tenant.permissions).includes(code)
  const prefixes: Partial<Record<StudioSection, string>> = { fuel: 'fuel', services: 'service', leases: 'leasing', documents: 'documents', bookings: 'bookings' }
  const prefix = prefixes[section]
  if (prefix) return can(`vehicles.${prefix}.read`) || can(`vehicles.${prefix}.manage`)
  return section === 'audit' ? can('audit.read') : can('vehicles.read')
}
