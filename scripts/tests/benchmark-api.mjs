import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout as sleep } from 'node:timers/promises'
import { companyName, people } from '../demo-data.mjs'

const baseUrl = new URL(process.env.HERMES_BENCHMARK_URL ?? 'http://127.0.0.1:5088')
assert.ok(baseUrl.protocol === 'http:' && baseUrl.hostname === '127.0.0.1'
  && baseUrl.pathname === '/' && !baseUrl.search && !baseUrl.hash && !baseUrl.username && !baseUrl.password,
'Use an isolated local HERMES instance on a separate port.')
const credentialsPath = process.env.HERMES_BENCHMARK_ACCOUNTS
assert.ok(credentialsPath, 'Set HERMES_BENCHMARK_ACCOUNTS to the isolated demo login file.')
const steady = process.argv.includes('--steady')
const large = process.argv.includes('--large')
const seconds = Number(process.env.HERMES_BENCHMARK_SECONDS ?? 10)
assert.ok(Number.isInteger(seconds) && seconds >= 2 && seconds <= (steady ? 1800 : 60), 'Use 2–60 seconds per phase or up to 1800 with --steady.')
const credentials = JSON.parse(await readFile(credentialsPath, 'utf8'))
assert.equal(credentials.company, companyName)

async function request(path, options = {}) {
  return fetch(new URL(path, baseUrl), { redirect: 'error', signal: AbortSignal.timeout(15000), ...options })
}

async function json(response, label) {
  assert.equal(response.status, 200, `${label}: HTTP ${response.status}`)
  return response.json()
}

// Each actor has its own cookie jar. Refresh response cookies between requests
// because Identity can renew the session even during authenticated GET requests.
async function signIn(credential, targetCompany = companyName) {
  const jar = new Map()
  const fetchAs = async (path, { method = 'GET', body, csrf, tenant } = {}) => {
    const headers = { Cookie: [...jar.values()].join('; '), Accept: 'application/json' }
    if (tenant) headers['X-Tenant-Id'] = tenant
    if (csrf) headers['X-CSRF-TOKEN'] = csrf
    if (body) headers['Content-Type'] = 'application/json'
    const response = await request(path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0]
      jar.set(pair.slice(0, pair.indexOf('=')), pair)
    }
    return response
  }
  const { requestToken } = await json(await fetchAs('/api/v1/auth/csrf'), 'CSRF')
  const session = await json(await fetchAs('/api/v1/auth/login', {
    method: 'POST', csrf: requestToken, body: { userName: credential.userName, password: credential.password },
  }), 'Login')
  assert.equal(session.id, credential.userName)
  const companies = await json(await fetchAs('/api/v1/tenants'), 'Companies')
  const tenant = companies.find(company => company.name === targetCompany)
  assert.ok(tenant, 'Demo fleet is missing or inaccessible.')
  const get = path => fetchAs(`/api/v1${path}`, { tenant: tenant.id })
  const fleet = await json(await get('/vehicles/search?page=1&pageSize=50'), 'Demo vehicles')
  if (targetCompany === companyName) {
    assert.ok(fleet.items.length && fleet.items.every(car => /^DEMO-\d{3}$/.test(car.registration)), 'Only synthetic demo vehicles are supported.')
    return { get, cars: fleet.items, company: targetCompany }
  }
  const cars = [...fleet.items]
  for (let page = 2; page <= 6; page++) {
    const next = await json(await get(`/vehicles/search?page=${page}&pageSize=50`), 'QA vehicles')
    cars.push(...next.items)
  }
  assert.equal(new Set(cars.map(car => car.id)).size, 300)
  assert.ok(cars.every(car => /^QA-\d{3}$/.test(car.registration)), 'The isolated QA fixture is required.')
  return { get, cars, company: targetCompany }
}

function workload(actor, manager) {
  const calendarMonth = new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', timeZone: 'Europe/Budapest' }).format(new Date()) + '-01'
  const vehicle = (car, suffix) => `/vehicles/${car.id}/${suffix}`
  const drivers = [
    ['dashboard', () => '/dashboard'],
    ['list', () => '/vehicles/search?page=1&pageSize=25'],
    ['search', car => `/vehicles/search?page=1&pageSize=25&search=${encodeURIComponent(car.registration)}`],
    ['vehicleDetails', car => vehicle(car, 'details')],
    ['odometerHistory', car => vehicle(car, 'odometer')],
    ['fuel', car => vehicle(car, `fuel?month=${calendarMonth}`)],
    ['bookings', car => vehicle(car, `bookings?month=${calendarMonth}`)],
    ['mileage', () => `/mileage/months/${calendarMonth}`],
  ]
  const operations = manager ? [
    ['overview', () => '/dashboard/overview?months=6'],
    ['mileageChart', () => '/dashboard/mileage?months=6'],
    ['documents', car => vehicle(car, 'documents')],
    ['photos', car => vehicle(car, 'photos')],
    ['leases', car => vehicle(car, 'leases')],
    ['services', car => vehicle(car, 'services')],
    ['handovers', car => vehicle(car, 'handovers')],
    ['assignmentHistory', car => vehicle(car, 'assignee-history')],
    ['fuelSettlement', () => `/fuel-settlements/months/${calendarMonth}`],
    ['company', () => '/company'],
    ['sites', () => '/company/sites'],
    ['partners', () => '/partners'],
    ['members', () => '/members'],
    ['audit', () => '/company/audit-events'],
    ...drivers,
  ] : drivers
  return { ...actor, operations }
}

const version = await json(await request('/health/version'), 'Version')
assert.equal(version.environment, 'Development', 'Only an isolated development instance is supported.')
assert.equal((await request('/health/ready')).status, 200)
const profiles = people.filter(person => ['fleet', 'dispatch', 'km-0', 'km-1', 'km-2'].includes(person.group) && !person.suspended)
const actors = []
for (const profile of profiles) {
  const credential = credentials.users.find(user => user.userName === profile.userName)
  assert.ok(credential, 'Missing demo test account.')
  actors.push(workload(await signIn(credential), profile.group === 'fleet'))
}
const extraActor = large
  ? workload(await signIn(credentials.users.find(user => user.userName === profiles[0].userName), 'HERMES QA 300'), true)
  : null

// Warm route compilation and validate permissions before trying to measure load.
for (const actor of extraActor ? [...actors, extraActor] : actors) {
  for (const [name, path] of actor.operations) {
    await json(await actor.get(path(actor.cars[0])), name)
  }
}

function stats(samples) {
  const sorted = samples.map(sample => sample.ms).sort((a, b) => a - b)
  const at = rank => sorted.length ? Math.round(sorted[Math.ceil(sorted.length * rank) - 1] * 10) / 10 : null
  const statuses = {}
  for (const sample of samples) statuses[sample.status] = (statuses[sample.status] ?? 0) + 1
  return { requests: samples.length, p50Ms: at(.5), p95Ms: at(.95), p99Ms: at(.99), statuses }
}

async function run(concurrency, thinkMs) {
  const started = performance.now()
  const deadline = started + seconds * 1000
  const samples = []
  const progress = steady && seconds >= 120 ? setInterval(() => {
    console.log(JSON.stringify({ progress: true, seconds: Math.round((performance.now() - started) / 1000), ...stats(samples) }))
  }, 60000) : null
  try {
    await Promise.all(Array.from({ length: concurrency }, async (_, lane) => {
      // Use the seeded manager, dispatcher and site-restricted drivers in rotation.
      // In the large scenario, every other lane uses the second company.
      const actor = extraActor && lane % 2 === 0 ? extraActor : actors[lane % 5 === 0 ? 0 : 1 + lane % (actors.length - 1)]
      for (let step = lane; performance.now() < deadline; step++) {
        const [name, path] = actor.operations[step % actor.operations.length]
        const car = actor.cars[step % actor.cars.length]
        const before = performance.now()
        let status
        try {
          const response = await actor.get(path(car))
          await response.arrayBuffer()
          status = response.status
        } catch (error) {
          status = error.name === 'TimeoutError' ? 'timeout' : 'transportError'
        }
        samples.push({ name, company: actor.company, ms: performance.now() - before, status })
        if (thinkMs) await sleep(thinkMs)
      }
    }))
  } finally { clearInterval(progress) }
  const elapsedSeconds = (performance.now() - started) / 1000
  const byOperation = Object.fromEntries([...new Set(samples.map(sample => sample.name))].sort()
    .map(name => [name, stats(samples.filter(sample => sample.name === name))]))
  const byCompany = Object.fromEntries([...new Set(samples.map(sample => sample.company))].sort()
    .map(company => [company, stats(samples.filter(sample => sample.company === company))]))
  return { concurrency, thinkMs, requestsPerSecond: Math.round(samples.length / elapsedSeconds * 10) / 10,
    ...stats(samples), byOperation, byCompany }
}

console.log(JSON.stringify({ environment: version.environment, measuredSecondsPerPhase: seconds, distinctAccounts: actors.length, large }))
let failed = false
const phases = steady ? [[15, 450]] : [[1, 0], [15, 450], [15, 0], [30, 0], [60, 0]]
for (const [concurrency, thinkMs] of phases) {
  const result = await run(concurrency, thinkMs)
  console.log(JSON.stringify(result))
  if (Object.keys(result.statuses).some(status => status !== '200')) failed = true
  await sleep(1000)
}
if (failed) process.exitCode = 1
