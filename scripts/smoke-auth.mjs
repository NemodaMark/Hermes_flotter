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
const groups = await request('/api/v1/permission-groups', { tenantId: first.id })
const admin = groups.find(group => group.isAdmin)
assert.equal(admin.name, 'admin')
assert.ok(admin.permissions.includes('vehicles.update'))
await request(`/api/v1/permission-groups/${admin.id}?version=${admin.version}`, { method: 'DELETE', tenantId: first.id, status: 409 })
const kmGroup = await request('/api/v1/permission-groups', { method: 'POST', tenantId: first.id, status: 201,
  body: { name: 'Km rögzítők', companyIds: [first.id], permissions: ['vehicles.read', 'vehicles.odometer.create'] } })
const current = await request(`/api/v1/permission-groups/users/${recipient.id}`)
const assigned = await request(`/api/v1/permission-groups/users/${recipient.id}`, { method: 'PUT', tenantId: first.id,
  body: { groupIds: [kmGroup.id], version: current.version } })
assert.deepEqual(assigned.groupIds, [kmGroup.id])
const [vehicle] = await member.request('/api/v1/vehicles', { tenantId: first.id })
await member.request(`/api/v1/vehicles/${vehicle.id}`, { method: 'PUT', tenantId: first.id, status: 403,
  body: { registration: 'DENIED', make: 'Ford', model: 'Fiesta', version: vehicle.version } })
const recorded = await member.request(`/api/v1/vehicles/${vehicle.id}/odometer`, { method: 'POST', tenantId: first.id,
  body: { kilometers: 12500, version: vehicle.version } })
assert.equal(recorded.odometerKm, 12500)
await request(`/api/v1/permission-groups/${kmGroup.id}?version=${kmGroup.version}`, { method: 'DELETE', tenantId: first.id, status: 204 })
await member.request('/api/v1/vehicles', { tenantId: first.id, status: 403 })
const multi = await request('/api/v1/permission-groups', { method: 'POST', status: 201,
  body: { name: 'Többcéges km-rögzítők', permissions: ['vehicles.read', 'vehicles.odometer.create'], companyIds: [first.id, second.id] } })
const multiUser = await request(`/api/v1/permission-groups/users/${recipient.id}`)
await request(`/api/v1/permission-groups/users/${recipient.id}`, { method: 'PUT', body: { groupIds: [multi.id], version: multiUser.version } })
let multiCompanies = await member.request('/api/v1/tenants')
assert.equal(multiCompanies.length, 2)
assert.ok(multiCompanies.every(company => company.permissions.includes('vehicles.odometer.create')))
await request(`/api/v1/permission-groups/${multi.id}`, { method: 'PUT', body: { name: multi.name, permissions: ['vehicles.read'], companyIds: [second.id], version: multi.version } })
multiCompanies = await member.request('/api/v1/tenants')
assert.deepEqual(multiCompanies.find(company => company.id === first.id).permissions, [])
assert.deepEqual(multiCompanies.find(company => company.id === second.id).permissions, ['vehicles.read'])
await request(`/api/v1/permission-groups/${multi.id}?version=2`, { method: 'DELETE', status: 204 })
multiCompanies = await member.request('/api/v1/tenants')
assert.equal(multiCompanies.length, 1)
assert.equal(multiCompanies[0].id, first.id)
const audit = await request('/api/v1/audit-events', { tenantId: first.id })
assert.ok(audit.items.some(item => item.action === 'member.permissions_changed' && item.actorSubject === user.id && item.targetSubject === recipient.id))
assert.ok(!JSON.stringify(audit).includes(invitation.acceptance.token))
assert.ok(audit.items.some(item => item.action === 'group.members_changed' && item.details.includes(recipient.id)))
assert.ok(audit.items.some(item => item.action === 'vehicle.odometer_recorded' && item.actorSubject === recipient.id))
assert.ok(audit.items.some(item => item.action === 'group.updated'))
console.log('Accounts, company isolation, invitations, unified permission groups with one or many companies, scoped revocation, protected admin, odometer isolation and audit passed.')
