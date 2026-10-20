export type Session = {
  id: string
  displayName: string
  email: string
  passwordChangeRequired?: boolean
  systemPermissions?: string[]
}
export type UserProfile = {
  id: string
  displayName: string
  email: string
  phoneNumber: string | null
  version: number
  passwordChangeRequired: boolean
  passwordChangeRequestedAt: string | null
  passwordChangedAt: string | null
  systemPermissions: string[]
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
export type Tenant = { id: string; name: string; permissions: string[] }
export type AssignedGroup = { id: string; name: string; isAdmin: boolean }
export type PermissionGroup = AssignedGroup & {
  version: number
  permissions: string[]
  memberCount: number
}
export type Vehicle = {
  id: string
  registration: string
  make: string
  model: string
  status: string
  version?: number
  odometerKm?: number | null
}
export type NewVehicle = { registration: string; make: string; model: string }
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

async function request<T>(
  path: string,
  options: {
    tenantId?: string
    body?: unknown
    method?: string
    signal?: AbortSignal
  } = {},
): Promise<T> {
  const method = options.method ?? (options.body !== undefined ? 'POST' : 'GET')
  const headers = new Headers({ Accept: 'application/json' })
  if (options.tenantId) headers.set('X-Tenant-Id', options.tenantId)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method))
    headers.set('X-CSRF-TOKEN', await getCsrfToken())
  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
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
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
}

async function authenticate(path: string, body: unknown) {
  const user = await request<Session>(path, { body })
  resetCsrfToken()
  return user
}

export const api = {
  groups: (tenantId: string, signal?: AbortSignal) =>
    request<PermissionGroup[]>('/api/v1/permission-groups', { tenantId, signal }),
  createGroup: (tenantId: string, name: string, permissions: string[]) =>
    request<PermissionGroup>('/api/v1/permission-groups', {
      tenantId,
      body: { name, permissions },
    }),
  updateGroup: (
    tenantId: string,
    id: string,
    name: string,
    permissions: string[],
    version: number,
  ) =>
    request<PermissionGroup>(`/api/v1/permission-groups/${id}`, {
      tenantId,
      method: 'PUT',
      body: { name, permissions, version },
    }),
  deleteGroup: (tenantId: string, id: string, version: number) =>
    request<void>(`/api/v1/permission-groups/${id}?version=${version}`, {
      tenantId,
      method: 'DELETE',
    }),
  assignGroups: (tenantId: string, userId: string, groupIds: string[], version: number) =>
    request<MemberAccess>(`/api/v1/members/${encodeURIComponent(userId)}/groups`, {
      tenantId,
      method: 'PUT',
      body: { groupIds, version },
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
  register: (input: RegisterInput) => authenticate('/api/v1/auth/register', input),
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
  systemUsers: (page: number, search: string, signal?: AbortSignal) =>
    request<Page<UserProfile>>(
      `/api/v1/system/users?${new URLSearchParams({ page: String(page), search })}`,
      { signal },
    ),
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
  createTenant: (name: string) => request<Tenant>('/api/v1/tenants', { body: { name } }),
  permissions: (signal?: AbortSignal) => request<Permission[]>('/api/v1/permissions', { signal }),
  members: (tenantId: string, page: number, search: string, signal?: AbortSignal) =>
    request<Page<Member>>(
      `/api/v1/members?${new URLSearchParams({ page: String(page), pageSize: '25', search })}`,
      { tenantId, signal },
    ),
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
  health: (signal?: AbortSignal) => request<{ status: string }>('/health/ready', { signal }),
}
