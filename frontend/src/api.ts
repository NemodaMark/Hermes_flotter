export type Tenant = { id: string; name: string; role: 'Owner' | 'FleetManager' | 'Viewer' }
export type Vehicle = {
  id: string
  registration: string
  make: string
  model: string
  status: string
}
export type NewVehicle = { registration: string; make: string; model: string }
export const developmentAuthenticationEnabled =
  import.meta.env.VITE_ENABLE_DEVELOPMENT_AUTH === 'true'
export const vehicleKey = (user: string, tenantId?: string) => ['vehicles', user, tenantId] as const

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(
  path: string,
  options: { user?: string; tenantId?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (import.meta.env.VITE_ENABLE_DEVELOPMENT_AUTH === 'true' && options.user)
    headers.set('X-Development-User', options.user)
  if (options.tenantId) headers.set('X-Tenant-Id', options.tenantId)
  if (options.body) headers.set('Content-Type', 'application/json')
  let response: Response
  try {
    response = await fetch(path, {
      method: options.body ? 'POST' : 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
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
    const message =
      response.status === 401
        ? 'A folytatáshoz bejelentkezés szükséges.'
        : response.status === 403
          ? 'Ehhez a művelethez nincs jogosultságod.'
          : validationMessage || problem?.title || 'A kérés nem sikerült. Próbáld újra.'
    throw new ApiError(response.status, message)
  }
  return response.json() as Promise<T>
}

export const api = {
  tenants: (user: string, signal?: AbortSignal) =>
    request<Tenant[]>('/api/v1/tenants', { user, signal }),
  vehicles: (user: string, tenantId: string, signal?: AbortSignal) =>
    request<Vehicle[]>('/api/v1/vehicles', { user, tenantId, signal }),
  createVehicle: (user: string, tenantId: string, body: NewVehicle) =>
    request<Vehicle>('/api/v1/vehicles', { user, tenantId, body }),
  health: (signal?: AbortSignal) => request<{ status: string }>('/health/ready', { signal }),
}
