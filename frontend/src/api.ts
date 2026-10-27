export type Session = {
  id: string
  displayName: string
  email: string
  passwordChangeRequired?: boolean
  systemPermissions?: string[]
}
export type RegistrationResult = Session | { requiresEmailConfirmation: true; message: string }
export type AccountToken = { userId: string; email: string; token: string }
export type UserProfile = {
  avatarRevision?: string | null
  id: string
  displayName: string
  email: string
  phoneNumber: string | null
  version: number
  passwordChangeRequired: boolean
  passwordChangeRequestedAt: string | null
  passwordChangedAt: string | null
  systemPermissions: string[]
  isAdministrator?: boolean
  companyAccess?: {
    id: string
    name: string
    hasAccess: boolean
    isAdmin: boolean
    isSuspended: boolean
  }[]
}
export type EditUserProfile = Pick<UserProfile, 'displayName' | 'email' | 'phoneNumber' | 'version'>
export type SystemAudit = {
  id: string
  actorSubject: string
  targetSubject: string | null
  tenantId: string | null
  action: string
  details: string
  createdAt: string
  originalActorSubject?: string | null
  originalTargetSubject?: string | null
}
export type Tenant = { id: string; name: string; permissions: string[]; permissionScopes?: PermissionSiteScope[] }
export type AssignedGroup = { id: string; name: string; isAdmin: boolean }
export type PermissionSiteScope = { code: string; allSites: boolean; siteIds: string[] }
export type GroupSiteOption = { id: string; name: string; code: string; isArchived: boolean }
export type GroupSiteSelection = { companyId: string; allSites: boolean; siteIds: string[] }
export type GroupCompanyOption = Tenant & {
  canEdit: boolean
  canAssign: boolean
  canGrantAll: boolean
  sites?: GroupSiteOption[]
  permissionScopes?: PermissionSiteScope[]
}
export type PermissionGroup = {
  dashboardMode?: 'Overview' | 'Vehicle'
  dashboardPriority?: number
  canConfigureDashboard?: boolean
  id: string
  name: string
  createdBy: string
  version: number
  allPermissions: boolean
  isAdmin: boolean
  permissions: string[]
  companies: { id: string; name: string; allSites?: boolean; sites?: GroupSiteOption[] }[]
  memberCount: number
  canEdit: boolean
  canAssign: boolean
}
export type GroupDraft = {
  dashboardMode?: 'Overview' | 'Vehicle'
  dashboardPriority?: number
  name: string
  permissions: string[]
  companyIds: string[]
  allPermissions: boolean
  siteScopes?: GroupSiteSelection[]
}
export type GroupUser = {
  userId: string
  version: number
  groupIds: string[]
  hasOtherGroups: boolean
  adminCompanyIds: string[]
}
export type Vehicle = {
  id: string
  registration: string
  make: string
  model: string
  status: string
  version?: number
  odometerKm?: number | null
  siteId?: string | null
  siteName?: string | null
  permissions?: string[]
  previousRegistrations?: string[]
}
export type NewVehicle = { registration: string; make: string; model: string; siteId?: string | null; data?: import('./fleetApi').VehicleSpecification; status?: string; odometerKm?: number | null }
export type VehicleCreationOptions = { canCreateUnassigned: boolean; sites: { id: string; name: string; code: string }[]; servicePartners?: { id: string; name: string }[] }
export type RegisterInput = {
  userName: string
  displayName: string
  email: string
  password: string
}
export type Permission = { code: string; name: string }
export type Page<T> = {
  items: T[]
  total: number
  page: number
  pageSize: number
}
export type MemberAccess = {
  directPermissions?: string[]
  groups?: AssignedGroup[]
  tenantId: string
  userId: string
  isActive: boolean
  version: number
  permissions: string[]
}
export type Member = Omit<MemberAccess, 'tenantId'> & {
  avatarRevision?: string | null
  displayName: string | null
  email: string | null
  joinedAt: string | null
  disabledAt: string | null
}
export type Invitation = {
  id: string
  email: string
  permissions: string[]
  createdAt: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
}
export type InvitationAcceptance = {
  tenantId: string
  invitationId: string
  token: string
}
export type CreatedInvitation = {
  invitation: Invitation
  acceptance: InvitationAcceptance
  emailDelivery?: 'sent' | 'saved' | 'failed' | 'disabled'
}
export const vehicleKey = (userId: string, tenantId?: string) =>
  ['vehicles', userId, tenantId] as const

export class ApiError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

let csrfToken: Promise<string> | undefined
export function resetCsrfToken() {
  csrfToken = undefined
}

async function getCsrfToken() {
  csrfToken ??= request<{ requestToken: string }>('/api/v1/auth/csrf').then(
    (value) => value.requestToken,
  )
  try {
    return await csrfToken
  } catch (error) {
    csrfToken = undefined
    throw error
  }
}

export async function request<T>(
  path: string,
  options: {
    tenantId?: string
    body?: unknown
    method?: string
    signal?: AbortSignal
    responseType?: 'json' | 'blob'
  } = {},
): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET')
  const headers = new Headers({ Accept: 'application/json' })
  if (options.tenantId) headers.set('X-Tenant-Id', options.tenantId)
  const multipart = options.body instanceof FormData
  if (options.body !== undefined && !multipart) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method))
    headers.set('X-CSRF-TOKEN', await getCsrfToken())
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: multipart ? options.body as FormData : options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
      credentials: 'same-origin',
    })
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'name' in error &&
      error.name === 'AbortError'
    )
      throw error
    throw new ApiError(0, 'A szerver nem érhető el. Ellenőrizd a kapcsolatot, majd próbáld újra.')
  }
  if (!response.ok) {
    const problem = (await response.json().catch(() => null)) as {
      title?: string
      errors?: Record<string, string[]>
      code?: string
    } | null
    const validationMessage = problem?.errors
      ? Object.values(problem.errors).flat().join(' ')
      : undefined
    if (response.status === 400) resetCsrfToken()
    const message =
      response.status === 429
        ? 'Túl sok próbálkozás. Várj egy percet, majd próbáld újra.'
        : response.status === 401
          ? (path.endsWith('/login') ? problem?.title : undefined) ||
            'A folytatáshoz bejelentkezés szükséges.'
          : response.status === 403
            ? problem?.title || 'Ehhez a művelethez nincs jogosultságod.'
            : validationMessage || problem?.title || 'A kérés nem sikerült. Próbáld újra.'
    throw new ApiError(response.status, message, problem?.code)
  }
  return response.status === 204 ? (undefined as T) : options.responseType === 'blob' ? (response.blob() as Promise<T>) : (response.json() as Promise<T>)
}

async function authenticate(path: string, body: unknown) {
  const user = await request<Session>(path, { body })
  resetCsrfToken()
  return user
}

export const api = {
  groupCompanies: (signal?: AbortSignal) =>
    request<GroupCompanyOption[]>('/api/v1/permission-groups/companies', { signal }),
  groups: (signal?: AbortSignal) =>
    request<PermissionGroup[]>('/api/v1/permission-groups', { signal }),
  createGroup: (body: GroupDraft) =>
    request<PermissionGroup>('/api/v1/permission-groups', { body }),
  updateGroup: (id: string, body: GroupDraft & { version: number }) =>
    request<PermissionGroup>(`/api/v1/permission-groups/${id}`, { method: 'PUT', body }),
  deleteGroup: (id: string, version: number) =>
    request<void>(`/api/v1/permission-groups/${id}?version=${version}`, { method: 'DELETE' }),
  groupUser: (id: string, signal?: AbortSignal) =>
    request<GroupUser>(`/api/v1/permission-groups/users/${encodeURIComponent(id)}`, {
      signal,
    }),
  assignGroups: (id: string, groupIds: string[], version: number, adminCompanyIds: string[] = []) =>
    request<GroupUser>(`/api/v1/permission-groups/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { groupIds, version, adminCompanyIds },
    }),
  updateVehicle: (tenantId: string, vehicle: Vehicle, input: NewVehicle) =>
    request<Vehicle>(`/api/v1/vehicles/${vehicle.id}`, {
      tenantId,
      method: 'PUT',
      body: { ...input, version: vehicle.version },
    }),
  recordOdometer: (tenantId: string, vehicle: Vehicle, kilometers: number) =>
    request<Vehicle>(`/api/v1/vehicles/${vehicle.id}/odometer`, {
      tenantId,
      body: { kilometers, version: vehicle.version },
    }),
  session: async (signal?: AbortSignal) => {
    try {
      return await request<Session>('/api/v1/auth/session', { signal })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        resetCsrfToken()
        return null
      }
      throw error
    }
  },
  register: async (input: RegisterInput) => {
    const result = await request<RegistrationResult>('/api/v1/auth/register', { body: input })
    resetCsrfToken()
    return result
  },
  accountOptions: () => request<{ emailEnabled: boolean; requireEmailConfirmation: boolean }>('/api/v1/auth/options'),
  requestAccountEmail: (email: string, confirmation: boolean) => request<{ message: string }>(
    `/api/v1/auth/${confirmation ? 'resend-confirmation' : 'forgot-password'}`, { body: { email } }),
  confirmEmail: (token: AccountToken) => request<{ message: string }>('/api/v1/auth/confirm-email', { body: token }),
  resetPassword: (token: AccountToken, newPassword: string, confirmPassword: string) =>
    request<{ message: string }>('/api/v1/auth/reset-password', { body: { ...token, newPassword, confirmPassword } }),
  login: (login: string, password: string) =>
    authenticate(
      '/api/v1/auth/login',
      login.includes('@') ? { email: login, password } : { userName: login, password },
    ),
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) =>
    authenticate('/api/v1/auth/change-password', {
      currentPassword,
      newPassword,
      confirmPassword,
    }),
  systemUsers: (
    page: number,
    search: string,
    signal?: AbortSignal,
    role = 'all',
    access = 'all',
  ) => {
    const query = new URLSearchParams({ page: String(page), search })
    if (role !== 'all') query.set('role', role)
    if (access !== 'all') query.set('access', access)
    return request<Page<UserProfile>>(`/api/v1/system/users?${query}`, { signal })
  },
  userProfile: (id: string, signal?: AbortSignal) =>
    request<UserProfile>(`/api/v1/system/users/${encodeURIComponent(id)}`, {
      signal,
    }),
  editUser: (id: string, body: EditUserProfile) =>
    request<UserProfile>(`/api/v1/system/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body,
    }),
  forcePasswordChange: (id: string, version: number) =>
    request<UserProfile>(`/api/v1/system/users/${encodeURIComponent(id)}/require-password-change`, {
      body: { version },
    }),
  systemAccess: (id: string, enabled: boolean, version: number) =>
    request<UserProfile>(`/api/v1/system/users/${encodeURIComponent(id)}/system-access`, {
      method: 'PUT',
      body: { enabled, version },
    }),
  systemAudit: (page: number, signal?: AbortSignal) =>
    request<Page<SystemAudit>>(`/api/v1/system/audit-events?page=${page}`, {
      signal,
    }),
  logout: async () => {
    await request<void>('/api/v1/auth/logout', { method: 'POST' })
    resetCsrfToken()
  },
  tenants: (signal?: AbortSignal) => request<Tenant[]>('/api/v1/tenants', { signal }),
  vehicleSites: (tenantId: string, signal?: AbortSignal) => request<{ id: string; name: string; code: string }[]>('/api/v1/vehicles/site-options', { tenantId, signal }),
  createTenant: (name: string) => request<Tenant>('/api/v1/tenants', { body: { name } }),
  permissions: (signal?: AbortSignal) => request<Permission[]>('/api/v1/permissions', { signal }),
  members: (tenantId: string, page: number, search: string, signal?: AbortSignal) =>
    request<Page<Member>>(
      `/api/v1/members?${new URLSearchParams({ page: String(page), pageSize: '25', search })}`,
      { tenantId, signal },
    ),
  member: (tenantId: string, userId: string, signal?: AbortSignal) =>
    request<Member>(`/api/v1/members/${encodeURIComponent(userId)}`, { tenantId, signal }),
  memberAccess: (tenantId: string, userId: string, signal?: AbortSignal) =>
    request<MemberAccess>(`/api/v1/members/${encodeURIComponent(userId)}/permissions`, {
      tenantId,
      signal,
    }),
  changePermissions: (tenantId: string, userId: string, permissions: string[], version: number) =>
    request<MemberAccess>(`/api/v1/members/${encodeURIComponent(userId)}/permissions`, {
      tenantId,
      method: 'PUT',
      body: { permissions, version },
    }),
  changeMemberStatus: (tenantId: string, userId: string, isActive: boolean, version: number) =>
    request<MemberAccess>(`/api/v1/members/${encodeURIComponent(userId)}/status`, {
      tenantId,
      method: 'PATCH',
      body: { isActive, version },
    }),
  invitations: (tenantId: string, page: number, signal?: AbortSignal) =>
    request<Page<Invitation>>(`/api/v1/invitations?page=${page}&pageSize=25`, {
      tenantId,
      signal,
    }),
  invite: (tenantId: string, email: string, permissions: string[]) =>
    request<CreatedInvitation>('/api/v1/invitations', {
      tenantId,
      body: { email, permissions },
    }),
  revokeInvitation: (tenantId: string, invitationId: string) =>
    request<void>(`/api/v1/invitations/${encodeURIComponent(invitationId)}`, {
      tenantId,
      method: 'DELETE',
    }),
  acceptInvitation: (body: InvitationAcceptance) =>
    request<MemberAccess>('/api/v1/invitations/accept', { body }),
  vehicles: (tenantId: string, signal?: AbortSignal) =>
    request<Vehicle[]>('/api/v1/vehicles', { tenantId, signal }),
  createVehicle: (tenantId: string, body: NewVehicle) =>
    request<Vehicle>('/api/v1/vehicles', { tenantId, body }),
  vehicleCreationOptions: (tenantId: string, signal?: AbortSignal) =>
    request<VehicleCreationOptions>('/api/v1/vehicles/create-options', { tenantId, signal }),
  health: (signal?: AbortSignal) => request<{ status: string }>('/health/ready', { signal }),
}
