import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, resetCsrfToken } from './api'
import { documentApi } from './documentApi'

afterEach(resetCsrfToken)
const user = { id: 'user-a', displayName: 'Teszt Elek', email: 'elek@example.test' }

describe('authenticated API requests', () => {
  it('encodes vehicle search and pagination and forwards the tenant and cancellation signal', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [], total: 0, availableTotal: 3, page: 1, pageSize: 25 })))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    await api.searchVehicles('company-a', { page: 2, pageSize: 50, search: 'Árvíz & 100%_', status: 'Maintenance', siteId: 'none' }, controller.signal)
    const [path, options] = fetch.mock.calls[0]
    const query = new URL(String(path), 'http://localhost').searchParams
    expect(query.get('search')).toBe('Árvíz & 100%_')
    expect(query.get('page')).toBe('2')
    expect(query.get('pageSize')).toBe('50')
    expect(query.get('status')).toBe('Maintenance')
    expect(query.get('siteId')).toBe('none')
    expect(new Headers(options.headers).get('X-Tenant-Id')).toBe('company-a')
    expect(options.signal).toBe(controller.signal)
  })
  it('keeps multipart boundaries browser-owned and sends company, cookie and CSRF protection', async () => {
    const fetch = vi.fn(async (path: string) => path.endsWith('/csrf') ? new Response('{"requestToken":"csrf"}') : new Response('{}'))
    vi.stubGlobal('fetch', fetch)
    const file = new File(['%PDF-1.7'], 'szerzodes.pdf')
    await documentApi.upload('company', 'car', 'leases', 'lease', file, 7)
    const [path, options] = (fetch.mock.calls as unknown as [string, RequestInit][])[1]
    expect(path).toBe('/api/v1/vehicles/car/leases/lease/documents')
    const headers = new Headers(options.headers)
    expect(headers.get('X-Tenant-Id')).toBe('company')
    expect(headers.get('X-CSRF-TOKEN')).toBe('csrf')
    expect(headers.has('Content-Type')).toBe(false)
    expect(options.credentials).toBe('same-origin')
    expect(options.body).toBeInstanceOf(FormData)
    expect((options.body as FormData).get('version')).toBe('7')
    expect((options.body as FormData).get('file')).toBe(file)
    expect((options.body as FormData).has('category')).toBe(false)
    await documentApi.upload('company', 'car', 'vehicle', 'car', file, 9, 'Registration')
    const [directPath, directOptions] = (fetch.mock.calls as unknown as [string, RequestInit][])[2]
    expect(directPath).toBe('/api/v1/vehicles/car/documents')
    expect((directOptions.body as FormData).get('category')).toBe('Registration')
    expect((directOptions.body as FormData).get('version')).toBe('9')
  })
  it('receives binary content through the authenticated client and preserves forbidden errors', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf' } }))
      .mockResolvedValueOnce(new Response('{"title":"Nincs jogosultság."}', { status: 403 }))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    const blob = await documentApi.content('company', 'car', 'services', 'service', 'doc', controller.signal)
    expect(blob.type).toBe('application/pdf')
    expect(await blob.text()).toBe('%PDF-1.7')
    expect(new Headers(fetch.mock.calls[0][1].headers).get('X-Tenant-Id')).toBe('company')
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal)
    await expect(documentApi.content('company', 'car', 'services', 'service', 'doc')).rejects.toMatchObject({ status: 403, message: 'Nincs jogosultság.' })
  })
  it('uses the username login field independently of the email field', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith('/csrf')) return new Response('{"requestToken":"test-token"}')
        bodies.push(JSON.parse(String(options.body)))
        return new Response(JSON.stringify(user))
      }),
    )
    await api.login('Nemoda.Mark', 'test-password-123')
    await api.login('mark@example.test', 'test-password-123')
    expect(bodies).toEqual([
      { userName: 'Nemoda.Mark', password: 'test-password-123' },
      { email: 'mark@example.test', password: 'test-password-123' },
    ])
  })
  it('sends the tenant and browser credentials without development identity headers', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await api.vehicles('tenant-a')
    const [, options] = fetch.mock.calls[0]
    expect(options.headers.get('X-Tenant-Id')).toBe('tenant-a')
    expect(options.headers.has('X-Development-User')).toBe(false)
    expect(options.credentials).toBe('same-origin')
  })

  it('refreshes CSRF after a login changes the authenticated identity', async () => {
    let issuedTokens = 0
    const posts: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith('/csrf'))
          return new Response(JSON.stringify({ requestToken: `token-${++issuedTokens}` }))
        posts.push(options)
        return new Response(
          JSON.stringify(
            path.endsWith('/login') ? user : { id: 'tenant-a', name: 'Új cég', permissions: [] },
          ),
        )
      }),
    )
    await api.login(user.email, 'test-password-123')
    await api.createTenant('Új cég')
    expect(new Headers(posts[0].headers).get('X-CSRF-TOKEN')).toBe('token-1')
    expect(new Headers(posts[1].headers).get('X-CSRF-TOKEN')).toBe('token-2')
  })

  it('handles a successful empty logout response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path.endsWith('/csrf')
          ? new Response('{"requestToken":"token"}')
          : new Response(null, { status: 204 }),
      ),
    )
    await expect(api.logout()).resolves.toBeUndefined()
  })

  it('discards the previous identitys CSRF token when a session expires', async () => {
    let tokens = 0
    const loginHeaders: Headers[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options: RequestInit) => {
        if (path.endsWith('/csrf'))
          return new Response(JSON.stringify({ requestToken: `token-${++tokens}` }))
        if (path.endsWith('/session')) return new Response('{}', { status: 401 })
        if (path.endsWith('/login')) {
          loginHeaders.push(new Headers(options.headers))
          return new Response(JSON.stringify(user))
        }
        return new Response('{}')
      }),
    )
    await api.createTenant('Előző munkamenet')
    await api.session()
    await api.login(user.email, 'test-password-123')
    expect(loginHeaders[0].get('X-CSRF-TOKEN')).toBe('token-2')
  })

  it('treats an unauthenticated session as logged out', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(api.session()).resolves.toBeNull()
  })

  it('rejects forbidden tenant access', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })))
    await expect(api.vehicles('tenant-b')).rejects.toMatchObject({ status: 403 })
  })

  it('preserves cancellation when the company changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')))
    await expect(api.vehicles('tenant-a')).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports duplicate registration conflicts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) =>
        path.endsWith('/csrf')
          ? new Response('{"requestToken":"token"}')
          : new Response('{"title":"Ez a rendszám már szerepel."}', { status: 409 }),
      ),
    )
    await expect(
      api.createVehicle('tenant-a', { registration: 'ABC-123', make: 'Ford', model: 'Focus' }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})
