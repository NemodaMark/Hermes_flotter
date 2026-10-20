import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

if (process.env.HERMES_SMOKE_ISOLATED !== 'true') throw new Error('Only run on an isolated, disposable staging database.')
const [phase, statePath] = process.argv.slice(2)
const base = process.env.HERMES_BASE_URL
assert.ok(base?.startsWith('https://'), 'The round trip must exercise real HTTPS')

function client(savedCookies = {}) {
  const cookies = new Map(Object.entries(savedCookies))
  let csrf
  async function request(path, { method = 'GET', body, tenantId, status = 200, bytes = false } = {}) {
    const headers = { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
    const multipart = body instanceof FormData
    if (body && !multipart) headers['Content-Type'] = 'application/json'
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = csrf
    if (tenantId) headers['X-Tenant-Id'] = tenantId
    const response = await fetch(base + path, { method, headers, body: multipart ? body : body && JSON.stringify(body) })
    assert.equal(response.status, status, `${method} ${path}: expected ${status}, got ${response.status}`)
    for (const cookie of response.headers.getSetCookie()) {
      assert.match(cookie, /; secure/i, 'Production cookies must use Secure')
      const [pair] = cookie.split(';')
      const index = pair.indexOf('=')
      cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    if (bytes) {
      assert.match(response.headers.get('cache-control'), /no-store/)
      return Buffer.from(await response.arrayBuffer())
    }
    return response.headers.get('content-type')?.includes('json') ? response.json() : undefined
  }
  return { request, refresh: async () => { csrf = (await request('/api/v1/auth/csrf')).requestToken }, save: () => Object.fromEntries(cookies) }
}

function pdf() {
  // A valid one-page PDF near the 10 MiB file limit, with a large PDF comment.
  let text = '%PDF-1.4\n%' + 'x'.repeat(10 * 1024 * 1024 - 2048) + '\n'
  const offsets = [0]
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>']
  objects.forEach((value, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${value}\nendobj\n` })
  const xref = Buffer.byteLength(text)
  text += 'xref\n0 4\n0000000000 65535 f \n' + offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')
  text += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(text)
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

if (phase === 'seed') {
  const owner = client(), other = client()
  const password = randomBytes(32).toString('hex')
  for (const [actor, userName] of [[owner, 'restore.owner'], [other, 'restore.other']]) {
    await actor.refresh()
    await actor.request('/api/v1/auth/register', { method: 'POST', status: 201, body: { userName, displayName: userName, email: `${userName}@example.test`, password } })
    await actor.refresh()
  }
  const company = await owner.request('/api/v1/tenants', { method: 'POST', status: 201, body: { name: 'Restore test company' } })
  const foreign = await other.request('/api/v1/tenants', { method: 'POST', status: 201, body: { name: 'Other isolated company' } })
  const car = await owner.request('/api/v1/vehicles', { method: 'POST', status: 201, tenantId: company.id, body: { registration: 'RESTORE-01', make: 'Ford', model: 'Transit' } })
  const data = pdf()
  const form = new FormData()
  form.set('file', new Blob([data], { type: 'application/pdf' }), 'forgalmi.pdf')
  form.set('version', String(car.version)); form.set('category', 'Registration')
  const upload = await owner.request(`/api/v1/vehicles/${car.id}/documents`, { method: 'POST', body: form, tenantId: company.id })
  const path = `/api/v1/vehicles/${car.id}/documents/${upload.document.id}/content`
  assert.equal(hash(await owner.request(path, { bytes: true, tenantId: company.id })), hash(data))
  await other.request(path, { tenantId: foreign.id, status: 404 })
  writeFileSync(statePath, JSON.stringify({ owner: owner.save(), other: other.save(), company: company.id, foreign: foreign.id, path, sha256: hash(data), password }), { mode: 0o600 })
  console.log('HTTPS registration, secure cookies, tenant isolation and a near-10-MiB PDF upload passed.')
} else if (phase === 'verify') {
  const state = JSON.parse(readFileSync(statePath, 'utf8'))
  const owner = client(state.owner), other = client(state.other)
  // Existing sessions prove that Data Protection keys survived, before any new login.
  assert.equal((await owner.request('/api/v1/auth/session')).id, 'restore.owner')
  assert.equal(hash(await owner.request(state.path, { bytes: true, tenantId: state.company })), state.sha256)
  await other.request(state.path, { tenantId: state.foreign, status: 404 })
  const fresh = client()
  await fresh.refresh()
  await fresh.request('/api/v1/auth/login', { method: 'POST', body: { userName: 'restore.owner', password: state.password } })
  assert.equal((await fresh.request('/api/v1/auth/session')).id, 'restore.owner')
  console.log('Recovery passed: existing session, fresh login, exact PDF bytes and cross-company access denial.')
} else throw new Error('Use seed or verify plus a protected state file path.')
