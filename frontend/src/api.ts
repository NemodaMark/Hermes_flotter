export type Session = { id: string; displayName: string; email: string }
export type Tenant = { id: string; name: string; role: 'Owner' | 'FleetManager' | 'Viewer' }
export type Vehicle = {
  id: string
  registration: string
  make: string
  model: string
  status: string
}
export type NewVehicle = { registration: string; make: string; model: string }
export type RegisterInput = { displayName: string; email: string; password: string }
export const vehicleKey = (userId: string, tenantId?: string) =>
  ['vehicles', userId, tenantId] as const

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
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
  options: { tenantId?: string; body?: unknown; method?: string; signal?: AbortSignal } = {},
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
            ? 'Ehhez a művelethez nincs jogosultságod.'
            : validationMessage || problem?.title || 'A kérés nem sikerült. Próbáld újra.'
    throw new ApiError(response.status, message)
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>)
}

async function authenticate(path: string, body: unknown) {
  const user = await request<Session>(path, { body })
  resetCsrfToken()
  return user
}

export const api = {
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
  login: (email: string, password: string) =>
    authenticate('/api/v1/auth/login', { email, password }),
  logout: async () => {
    await request<void>('/api/v1/auth/logout', { method: 'POST' })
    resetCsrfToken()
  },
  tenants: (signal?: AbortSignal) => request<Tenant[]>('/api/v1/tenants', { signal }),
  createTenant: (name: string) => request<Tenant>('/api/v1/tenants', { body: { name } }),
  vehicles: (tenantId: string, signal?: AbortSignal) =>
    request<Vehicle[]>('/api/v1/vehicles', { tenantId, signal }),
  createVehicle: (tenantId: string, body: NewVehicle) =>
    request<Vehicle>('/api/v1/vehicles', { tenantId, body }),
  health: (signal?: AbortSignal) => request<{ status: string }>('/health/ready', { signal }),
}
