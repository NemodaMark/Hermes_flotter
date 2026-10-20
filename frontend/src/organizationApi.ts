import { request } from './api'
import type { Page } from './api'

export type CompanyRow = { id: string; name: string; status: string; permissions: string[] }
export type Address = {
  countryCode: string
  postalCode: string | null
  city: string | null
  addressLine1: string | null
  addressLine2: string | null
}
export type CompanyInput = {
  name: string
  legalName: string | null
  taxNumber: string | null
  registrationNumber: string | null
  euVatNumber: string | null
  address: Address
  email: string | null
  phone: string | null
  website: string | null
  timeZone: string
  currency: string
  distanceUnit: string
  version: number
}
export type Metadata = {
  createdAt: string | null
  createdBy: string | null
  updatedAt: string | null
  updatedBy: string | null
}
export type CompanyDetails = Metadata & {
  id: string
  data: CompanyInput
  status: string
  statusReason: string | null
  statusChangedAt: string | null
}
export type CompanyState = {
  version: number
  status: string
  reason: string | null
  changedAt: string | null
}
export type ContactInput = {
  name: string
  position: string | null
  email: string | null
  phone: string | null
  version: number
}
export type ArchiveMetadata = {
  isArchived: boolean
  archivedAt: string | null
  statusReason: string | null
}
export type Contact = Metadata & ArchiveMetadata & { id: string; data: ContactInput }
export type SiteInput = {
  name: string
  code: string
  address: Address
  email: string | null
  phone: string | null
  contactId: string | null
  version: number
}
export type Site = Metadata &
  ArchiveMetadata & {
    id: string
    data: SiteInput
    contactName: string | null
    vehicleCount: number
  }
export type SiteVehicle = {
  id: string
  registration: string
  make: string
  model: string
  siteId: string | null
  siteName: string | null
  version: number
}
export type OrganizationAudit = {
  id: string
  action: string
  actorSubject: string
  details: string
  createdAt: string
}
export const blankAddress = (): Address => ({
  countryCode: 'HU',
  postalCode: '',
  city: '',
  addressLine1: '',
  addressLine2: '',
})
export const companyStatusName = (status: string) =>
  ({ Active: 'Aktív', Suspended: 'Felfüggesztett', Archived: 'Archivált' })[status] ?? status

export const organizationApi = {
  companies: (page: number, search: string, status: string, signal?: AbortSignal) =>
    request<Page<CompanyRow>>(
      `/api/v1/companies?${new URLSearchParams({ page: String(page), search, status })}`,
      { signal },
    ),
  company: (tenantId: string, signal?: AbortSignal) =>
    request<CompanyDetails>('/api/v1/company', { tenantId, signal }),
  saveCompany: (tenantId: string, body: CompanyInput) =>
    request<CompanyDetails>('/api/v1/company', { tenantId, body, method: 'PUT' }),
  companyState: (tenantId: string, signal?: AbortSignal) =>
    request<CompanyState>('/api/v1/company/state', { tenantId, signal }),
  companyStatus: (tenantId: string, status: string, reason: string, version: number) =>
    request<CompanyState>('/api/v1/company/status', {
      tenantId,
      body: { status, reason, version },
      method: 'PATCH',
    }),
  contacts: (tenantId: string, includeArchived: boolean, signal?: AbortSignal) =>
    request<Contact[]>(`/api/v1/company/contacts?includeArchived=${includeArchived}`, {
      tenantId,
      signal,
    }),
  saveContact: (tenantId: string, id: string | null, body: ContactInput) =>
    request<Contact>(`/api/v1/company/contacts${id ? '/' + id : ''}`, {
      tenantId,
      body,
      method: id ? 'PUT' : 'POST',
    }),
  contactStatus: (tenantId: string, contact: Contact, reason: string) =>
    request<Contact>(`/api/v1/company/contacts/${contact.id}/status`, {
      tenantId,
      body: { isArchived: !contact.isArchived, reason, version: contact.data.version },
      method: 'PATCH',
    }),
  sites: (tenantId: string, includeArchived: boolean, signal?: AbortSignal) =>
    request<Site[]>(`/api/v1/company/sites?includeArchived=${includeArchived}`, {
      tenantId,
      signal,
    }),
  saveSite: (tenantId: string, id: string | null, body: SiteInput) =>
    request<Site>(`/api/v1/company/sites${id ? '/' + id : ''}`, {
      tenantId,
      body,
      method: id ? 'PUT' : 'POST',
    }),
  siteStatus: (tenantId: string, site: Site, reason: string) =>
    request<Site>(`/api/v1/company/sites/${site.id}/status`, {
      tenantId,
      body: { isArchived: !site.isArchived, reason, version: site.data.version },
      method: 'PATCH',
    }),
  vehicles: (tenantId: string, signal?: AbortSignal) =>
    request<SiteVehicle[]>('/api/v1/company/vehicles', { tenantId, signal }),
  assignVehicle: (tenantId: string, vehicle: SiteVehicle, siteId: string | null) =>
    request<SiteVehicle>(`/api/v1/company/vehicles/${vehicle.id}/site`, {
      tenantId,
      body: { siteId, version: vehicle.version },
      method: 'PUT',
    }),
  audit: (tenantId: string, page: number, signal?: AbortSignal) =>
    request<Page<OrganizationAudit>>(`/api/v1/company/audit-events?page=${page}`, {
      tenantId,
      signal,
    }),
}
