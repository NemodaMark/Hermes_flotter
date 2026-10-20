import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'

const baseUrl = process.env.HERMES_BASE_URL ?? 'http://localhost:8080'
function createClient() {
  const cookies = new Map()
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
    const text = await response.text()
    return text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : undefined
  }
  async function refreshCsrf() { csrfToken = (await request('/api/v1/auth/csrf')).requestToken }
  async function register() {
    const email = `smoke-${randomUUID()}@example.test`
    const password = randomBytes(32).toString('base64url')
    await refreshCsrf()
    const userName = email.split('@')[0]
    const user = await request('/api/v1/auth/register', { method: 'POST', body: { displayName: 'CI ellenőrzés', userName, email, password }, status: 201 })
    assert.equal(user.id, userName)
    await refreshCsrf()
    return { ...user, password }
  }
  return { request, refreshCsrf, register }
}

const owner = createClient()
const member = createClient()
const { request } = owner
await request('/api/v1/auth/session', { status: 401 })
const user = await owner.register()
assert.equal((await request('/api/v1/auth/session')).id, user.id)
const first = await request('/api/v1/tenants', { method: 'POST', body: { name: 'CI első cég' }, status: 201 })
const second = await request('/api/v1/tenants', { method: 'POST', body: { name: 'CI második cég' }, status: 201 })
assert.ok(first.permissions.includes('permissions.manage'))
assert.equal(first.role, undefined)
assert.equal((await request('/api/v1/tenants')).length, 2)
await request('/api/v1/vehicles', { method: 'POST', tenantId: first.id, body: { registration: 'SMOKE-123', make: 'Ford', model: 'Focus' }, status: 201 })
assert.equal((await request('/api/v1/vehicles', { tenantId: first.id })).length, 1)
assert.equal((await request('/api/v1/vehicles', { tenantId: second.id })).length, 0)
await request('/api/v1/auth/logout', { method: 'POST', status: 204 })
await request('/api/v1/auth/session', { status: 401 })
await owner.refreshCsrf()
await request('/api/v1/auth/login', { method: 'POST', body: { userName: user.id.toUpperCase(), password: user.password } })
await owner.refreshCsrf()
assert.equal((await request('/api/v1/tenants')).length, 2)
const recipient = await member.register()
const invitation = await request('/api/v1/invitations', { method: 'POST', tenantId: first.id, body: { email: recipient.email, permissions: ['vehicles.read'] }, status: 201 })
await member.request('/api/v1/invitations/accept', { method: 'POST', body: invitation.acceptance })
assert.equal((await member.request('/api/v1/vehicles', { tenantId: first.id })).length, 1)
await member.request('/api/v1/vehicles', { tenantId: second.id, status: 403 })
await member.request('/api/v1/vehicles', { method: 'POST', tenantId: first.id, body: { registration: 'DENIED', make: 'Ford', model: 'Focus' }, status: 403 })
const access = await request(`/api/v1/members/${recipient.id}/permissions`, { tenantId: first.id })
await request(`/api/v1/members/${recipient.id}/permissions`, { method: 'PUT', tenantId: first.id, body: { permissions: [], version: access.version } })
await member.request('/api/v1/vehicles', { tenantId: first.id, status: 403 })
const audit = await request('/api/v1/audit-events', { tenantId: first.id })
assert.ok(audit.items.some(item => item.action === 'member.permissions_changed' && item.actorSubject === user.id && item.targetSubject === recipient.id))
assert.ok(!JSON.stringify(audit).includes(invitation.acceptance.token))
console.log('Accounts, company isolation, invitations, direct grants, immediate revocation and audit passed.')
