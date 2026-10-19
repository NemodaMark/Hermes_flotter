import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

const baseUrl = process.env.HERMES_BASE_URL ?? 'http://localhost:8080'
const cookies = new Map()
const email = `smoke-${randomUUID()}@example.test`
const password = randomBytes(32).toString('base64url')
let csrfToken

async function request(path, { method = 'GET', body, tenantId, status = 200 } = {}) {
  const headers = { Accept: 'application/json', Cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (method !== 'GET') headers['X-CSRF-TOKEN'] = csrfToken
  if (tenantId) headers['X-Tenant-Id'] = tenantId
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(';', 1)[0]
    const separator = pair.indexOf('=')
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    if (value) cookies.set(name, value)
    else cookies.delete(name)
  }
  assert.equal(response.status, status, `${method} ${path} returned ${response.status}, expected ${status}`)
  return response.status === 204 ? undefined : response.json()
}

async function refreshCsrf() { csrfToken = (await request('/api/v1/auth/csrf')).requestToken }

await request('/api/v1/auth/session', { status: 401 })
await refreshCsrf()
const user = await request('/api/v1/auth/register', { method: 'POST', body: { displayName: 'CI ellenőrzés', email, password }, status: 201 })
assert.equal((await request('/api/v1/auth/session')).id, user.id)
await refreshCsrf()
const first = await request('/api/v1/tenants', { method: 'POST', body: { name: 'CI első cég' }, status: 201 })
const second = await request('/api/v1/tenants', { method: 'POST', body: { name: 'CI második cég' }, status: 201 })
assert.equal(first.role, 'Owner')
assert.equal((await request('/api/v1/tenants')).length, 2)
await request('/api/v1/vehicles', { method: 'POST', tenantId: first.id, body: { registration: 'SMOKE-123', make: 'Ford', model: 'Focus' }, status: 201 })
assert.equal((await request('/api/v1/vehicles', { tenantId: first.id })).length, 1)
assert.equal((await request('/api/v1/vehicles', { tenantId: second.id })).length, 0)
await request('/api/v1/auth/logout', { method: 'POST', status: 204 })
await request('/api/v1/auth/session', { status: 401 })
await refreshCsrf()
await request('/api/v1/auth/login', { method: 'POST', body: { email, password } })
assert.equal((await request('/api/v1/tenants')).length, 2)
console.log('Registration, session, company creation, tenant isolation, logout and login passed.')
