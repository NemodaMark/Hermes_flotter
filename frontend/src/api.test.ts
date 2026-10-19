import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError } from './api'

afterEach(() => vi.unstubAllEnvs())

describe('API session isolation', () => {
  it('sends the selected tenant and development identity', async () => {
    vi.stubEnv('VITE_ENABLE_DEVELOPMENT_AUTH', 'true')
    const fetch = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await api.vehicles('anna', 'tenant-a')
    const [, options] = fetch.mock.calls[0]
    expect(options.headers.get('X-Tenant-Id')).toBe('tenant-a')
    expect(options.headers.get('X-Development-User')).toBe('anna')
  })
  it('does not send a development identity when the feature is disabled', async () => {
    vi.stubEnv('VITE_ENABLE_DEVELOPMENT_AUTH', 'false')
    const fetch = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    await api.tenants('anna')
    expect(fetch.mock.calls[0][1].headers.has('X-Development-User')).toBe(false)
  })
  it('rejects forbidden responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 403 })))
    await expect(api.vehicles('bela', 'tenant-b')).rejects.toMatchObject({ status: 403 })
  })
  it('preserves cancellation when the company changes', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('Aborted', 'AbortError')))
    await expect(api.vehicles('anna', 'tenant-a')).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('reports duplicate registration conflicts', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ title: 'Ez a rendszám már szerepel.' }), { status: 409 }),
        ),
    )
    await expect(
      api.createVehicle('anna', 'tenant-a', {
        registration: 'ABC-123',
        make: 'Ford',
        model: 'Focus',
      }),
    ).rejects.toBeInstanceOf(ApiError)
  })
})
