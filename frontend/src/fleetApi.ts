import { request } from './api'
import type { Page, Vehicle } from './api'
import type { Address, Metadata, OrganizationAudit } from './organizationApi'

export type VehicleSpecification = {
  registrationCountry: string
  vin: string | null
  fleetNumber: string | null
  category: string
  year: number | null
  firstRegistration: string | null
  color: string | null
  fuelType: string
  powerKw: number | null
  engineCapacityCc: number | null
  transmission: string
  seats: number | null
  grossWeightKg: number | null
  payloadKg: number | null
  cargoVolumeM3: number | null
  batteryKwh: number | null
  ownership: string
  fleetEntryDate: string | null
  fleetExitDate: string | null
  inspectionDueDate: string | null
  insuranceDueDate: string | null
  nextServiceDate: string | null
  nextServiceKm: number | null
  preferredServicePartnerId: string | null
  notes: string | null
}
export type VehicleRecord = {
  vehicle: Vehicle
  data: VehicleSpecification
  preferredServicePartnerName: string | null
  statusReason: string | null
  updatedAt: string | null
  updatedBy: string | null
}
export type SaveVehicle = { registration: string; make: string; model: string; status: string; version: number; data: VehicleSpecification }
export type PartnerContact = { name: string; position: string | null; email: string | null; phone: string | null }
export type PartnerInput = {
  name: string; isLessor: boolean; isService: boolean; address: Address
  email: string | null; phone: string | null; website: string | null; notes: string | null
  contacts: PartnerContact[]; version: number
}
export type Partner = Metadata & { id: string; data: PartnerInput; isArchived: boolean; statusReason: string | null }
export type PartnerOption = { id: string; name: string }
export type LeaseInput = {
  partnerId: string; contractNumber: string; startDate: string; endDate: string
  paymentAmount: number | null; currency: string; billingFrequency: string
  annualKmLimit: number | null; totalKmLimit: number | null; status: string
  documentUrl: string | null; notes: string | null; version: number
}
export type Lease = Metadata & { id: string; partnerName: string; data: LeaseInput }
export type ServiceInput = {
  partnerId: string; performedOn: string; kilometers: number | null; description: string
  workOrderNumber: string | null; cost: number | null; currency: string
  nextServiceDate: string | null; nextServiceKm: number | null
  documentUrl: string | null; notes: string | null; version: number
}
export type Service = Metadata & { id: string; partnerName: string; data: ServiceInput; isVoided: boolean; voidReason: string | null }
export type RegistrationEntry = { id: string; registration: string; countryCode: string; recordedBy: string; recordedAt: string }
export type OdometerEntry = { id: string; kilometers: number; recordedBy: string; recordedAt: string }
const carPath = (id: string) => `/api/v1/vehicles/${id}`
export const fleetApi = {
  siteOptions: (tenantId: string, id: string, signal?: AbortSignal) => request<{ canUnassign: boolean; sites: { id: string; name: string; code: string }[] }>(`${carPath(id)}/site-options`, { tenantId, signal }),
  assignSite: (tenantId: string, id: string, siteId: string | null, version: number) => request(`/api/v1/company/vehicles/${id}/site`, { tenantId, body: { siteId, version }, method: 'PUT' }),
  vehicle: (tenantId: string, id: string, signal?: AbortSignal) => request<VehicleRecord>(`${carPath(id)}/details`, { tenantId, signal }),
  saveVehicle: (tenantId: string, id: string, body: SaveVehicle) => request<VehicleRecord>(`${carPath(id)}/details`, { tenantId, body, method: 'PUT' }),
  vehicleStatus: (tenantId: string, id: string, isArchived: boolean, reason: string, version: number) =>
    request<VehicleRecord>(`${carPath(id)}/status`, { tenantId, body: { isArchived, reason, version }, method: 'PATCH' }),
  registrations: (tenantId: string, id: string, page: number, signal?: AbortSignal) => request<Page<RegistrationEntry>>(`${carPath(id)}/registrations?page=${page}`, { tenantId, signal }),
  odometer: (tenantId: string, id: string, page: number, signal?: AbortSignal) => request<Page<OdometerEntry>>(`${carPath(id)}/odometer?page=${page}`, { tenantId, signal }),
  partners: (tenantId: string, page: number, search: string, kind: string, includeArchived: boolean, signal?: AbortSignal) =>
    request<Page<Partner>>(`/api/v1/partners?${new URLSearchParams({ page: String(page), search, kind, includeArchived: String(includeArchived) })}`, { tenantId, signal }),
  partner: (tenantId: string, id: string, signal?: AbortSignal) => request<Partner>(`/api/v1/partners/${id}`, { tenantId, signal }),
  savePartner: (tenantId: string, id: string | null, body: PartnerInput) => request<Partner>(`/api/v1/partners${id ? `/${id}` : ''}`, { tenantId, body, method: id ? 'PUT' : 'POST' }),
  partnerStatus: (tenantId: string, partner: Partner, reason: string) => request<Partner>(`/api/v1/partners/${partner.id}/status`, { tenantId, body: { isArchived: !partner.isArchived, version: partner.data.version, reason }, method: 'PATCH' }),
  partnerOptions: (tenantId: string, id: string, purpose: string, signal?: AbortSignal) => request<PartnerOption[]>(`${carPath(id)}/partner-options?purpose=${purpose}`, { tenantId, signal }),
  leases: (tenantId: string, id: string, page: number, signal?: AbortSignal) => request<Page<Lease>>(`${carPath(id)}/leases?page=${page}`, { tenantId, signal }),
  saveLease: (tenantId: string, car: string, id: string | null, body: LeaseInput) => request<Lease>(`${carPath(car)}/leases${id ? `/${id}` : ''}`, { tenantId, body, method: id ? 'PUT' : 'POST' }),
  services: (tenantId: string, id: string, page: number, includeVoided: boolean, signal?: AbortSignal) => request<Page<Service>>(`${carPath(id)}/services?page=${page}&includeVoided=${includeVoided}`, { tenantId, signal }),
  saveService: (tenantId: string, car: string, id: string | null, body: ServiceInput) => request<Service>(`${carPath(car)}/services${id ? `/${id}` : ''}`, { tenantId, body, method: id ? 'PUT' : 'POST' }),
  voidService: (tenantId: string, car: string, item: Service, reason: string) => request<Service>(`${carPath(car)}/services/${item.id}/void`, { tenantId, body: { version: item.data.version, reason } }),
  audit: (tenantId: string, id: string, vehicle: boolean, page: number, signal?: AbortSignal) => request<Page<OrganizationAudit>>(`${vehicle ? carPath(id) : `/api/v1/partners/${id}`}/audit-events?page=${page}`, { tenantId, signal }),
}
export const vehicleStatuses = { Active: 'Aktív', Maintenance: 'Szervizben', Inactive: 'Inaktív', Archived: 'Archivált' }
export const categories = { Unknown: 'Nincs megadva', PassengerCar: 'Személyautó', Van: 'Kisteherautó', Truck: 'Teherautó', Bus: 'Autóbusz', Motorcycle: 'Motorkerékpár', Trailer: 'Pótkocsi', Other: 'Egyéb' }
export const fuels = { Unknown: 'Nincs megadva', Petrol: 'Benzin', Diesel: 'Dízel', Hybrid: 'Hibrid', PluginHybrid: 'Plug-in hibrid', Electric: 'Elektromos', Lpg: 'LPG', Cng: 'CNG', Hydrogen: 'Hidrogén', Other: 'Egyéb' }
export const transmissions = { Unknown: 'Nincs megadva', Manual: 'Kézi', Automatic: 'Automata', Other: 'Egyéb' }
export const ownerships = { Unknown: 'Nincs megadva', Owned: 'Saját', Leased: 'Lízingelt', Rented: 'Bérelt' }
export const frequencies = { Monthly: 'Havi', Quarterly: 'Negyedéves', Annual: 'Éves', Upfront: 'Egyszeri' }
export const leaseStatuses = { Active: 'Aktív', Closed: 'Lezárt', Cancelled: 'Visszavont' }
export const dateText = (value: string | null) => value ? new Date(`${value}T12:00:00`).toLocaleDateString('hu-HU') : '–'
export const moneyText = (value: number | null, currency: string) => value === null ? '–' : new Intl.NumberFormat('hu-HU', { style: 'currency', currency }).format(value)
