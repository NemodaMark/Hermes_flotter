import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, resetCsrfToken } from './api'

afterEach(resetCsrfToken)
const user = { id: 'user-a', displayName: 'Teszt Elek', email: 'elek@example.test' }

describe('authenticated API requests', () => {
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
            path.endsWith('/login') ? user : { id: 'tenant-a', name: 'Új cég', role: 'Owner' },
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
