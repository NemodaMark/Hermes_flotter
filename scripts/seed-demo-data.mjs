import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { companyName, demoNote, address, sites, partners, groups, people, vehicles, day } from './demo-data.mjs'

// Deliberately separate from application startup and from production migrations.
const baseUrl = new URL(process.env.HERMES_BASE_URL ?? 'http://127.0.0.1:5080')
const frontendUrl = new URL(process.env.HERMES_FRONTEND_URL ?? 'http://127.0.0.1:5173/')
assert.ok(['http:', 'https:'].includes(frontendUrl.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(frontendUrl.hostname)
  && !frontendUrl.username && !frontendUrl.password && frontendUrl.pathname === '/' && !frontendUrl.search && !frontendUrl.hash,
  'A demófelület címe csak helyi HTTP(S)-cím lehet.')
assert.ok(['http:', 'https:'].includes(baseUrl.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(baseUrl.hostname)
  && !baseUrl.username && !baseUrl.password && baseUrl.pathname === '/' && !baseUrl.search && !baseUrl.hash,
  'A demóbetöltő csak helyi API-val használható.')
const directory = new URL('../.local/demo-data/', import.meta.url)
const statePath = new URL('state.json', directory)
const credentialsPath = new URL('bejelentkezesek.json', directory)
const verifyOnly = process.argv.includes('--verify-only')
const bookingsOnly = process.argv.includes('--bookings-only')
const withBookings = process.argv.includes('--with-bookings')
assert.ok(process.argv.slice(2).length <= 1 && process.argv.slice(2).every(arg => ['--verify-only', '--bookings-only', '--with-bookings'].includes(arg)), 'Ismeretlen vagy ismételt kapcsoló.')
const adminPassword = process.env.HERMES_SEED_ADMIN_PASSWORD
assert.ok(adminPassword, 'Add meg a HERMES_SEED_ADMIN_PASSWORD környezeti változót.')

function client() {
  const cookies = new Map()
  let token
  async function request(path, { method = 'GET', body, tenantId, status = 200 } = {}) {
    const headers = { Accept: 'application/json', Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ') }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = token
    if (tenantId) headers['X-Tenant-Id'] = tenantId
    let response
    for (let attempt = 0; ; attempt++) {
      response = await fetch(new URL(path, baseUrl), {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error', signal: AbortSignal.timeout(30000),
      })
      // The real account rate limiter remains enabled. A rejected request has not reached its handler.
      if (response.status !== 429 || attempt >= 6) break
      const seconds = Number(response.headers.get('retry-after'))
      const delay = Number.isFinite(seconds) && seconds > 0 ? Math.min(30000, seconds * 1000) : 15000
      await response.arrayBuffer()
      console.log(`A helyi API kéréskorlátja miatt várakozás: ${Math.ceil(delay / 1000)} másodperc.`)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0]
      const index = pair.indexOf('=')
      if (pair.slice(index + 1)) cookies.set(pair.slice(0, index), pair.slice(index + 1))
      else cookies.delete(pair.slice(0, index))
    }
    // Do not print response bodies: they can contain personal data or invitation tokens.
    assert.equal(response.status, status, `${method} ${path}: HTTP ${response.status}, várt: ${status}`)
    return response.status === 204 ? null : response.json()
  }
  async function csrf() { token = (await request('/api/v1/auth/csrf')).requestToken }
  async function login(userName, password) {
    await csrf()
    const user = await request('/api/v1/auth/login', { method: 'POST', body: { userName, password } })
    await csrf()
    return user
  }
  async function logout() { await request('/api/v1/auth/logout', { method: 'POST', status: 204 }) }
  return { request, csrf, login, logout }
}
const admin = client()
const build = await admin.request('/health/version')
assert.equal(build.environment, 'Development', 'A demóbetöltés kizárólag Development környezetben engedélyezett.')
await admin.request('/health/ready')
const actor = await admin.login(process.env.HERMES_SEED_ADMIN_USER ?? 'admin', adminPassword)
assert.ok(actor.systemPermissions.includes('system.manage') && !actor.passwordChangeRequired, 'Rendszerkezelői fiók szükséges.')

async function loadState() {
  try { return JSON.parse(await readFile(statePath, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
async function privateJson(path, value) {
  const temporary = new URL(`${path.href}.tmp`)
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  await rename(temporary, path)
}
async function pages(path, tenantId) {
  const result = []
  for (let page = 1; ; page++) {
    const data = await admin.request(`${path}${path.includes('?') ? '&' : '?'}page=${page}`, { tenantId })
    result.push(...data.items)
    if (result.length >= data.total) return result
    assert.ok(data.items.length, 'A lapozás nem halad.')
  }
}
const sorted = rows => [...rows].sort((a, b) => String(a.id ?? a.userId).localeCompare(String(b.id ?? b.userId)))
async function companySnapshot(tenantId) {
  const company = await admin.request('/api/v1/company', { tenantId })
  const contacts = await admin.request('/api/v1/company/contacts?includeArchived=true', { tenantId })
  const locations = await admin.request('/api/v1/company/sites?includeArchived=true', { tenantId })
  const companyPartners = await pages('/api/v1/partners?includeArchived=true', tenantId)
  const members = await pages('/api/v1/members?pageSize=100', tenantId)
  const cars = await admin.request('/api/v1/vehicles', { tenantId })
  const details = []
  for (const car of cars) details.push(await admin.request(`/api/v1/vehicles/${car.id}/details`, { tenantId }))
  return { company, contacts: sorted(contacts), sites: sorted(locations), partners: sorted(companyPartners), members: sorted(members), vehicles: details.sort((a, b) => a.vehicle.id.localeCompare(b.vehicle.id)) }
}
async function baseline() {
  const result = { companies: {}, users: {} }
  for (const company of await admin.request('/api/v1/tenants')) result.companies[company.id] = await companySnapshot(company.id)
  for (const user of await pages('/api/v1/system/users')) result.users[user.id] = await admin.request(`/api/v1/system/users/${user.id}`)
  return result
}

await mkdir(directory, { recursive: true, mode: 0o700 })
let state = await loadState()
if (!state) {
  assert.ok(!verifyOnly, 'Még nincs korábbi demóbetöltés.')
  const companies = await admin.request('/api/v1/tenants')
  assert.ok(!companies.some(company => company.name === companyName), 'Már van Demo Flotta cég, de nincs hozzá helyi állapotfájl. Nem módosítom.')
  const existingUsers = await pages('/api/v1/system/users')
  assert.ok(!existingUsers.some(user => people.some(person => person.userName === user.id || person.email === user.email)), 'Egy demófelhasználónév vagy e-mail már foglalt. A meglévő fiókot nem használom fel.')
  state = { schema: 1, baseUrl: baseUrl.href, actor: actor.id, date: new Date().toISOString().slice(0, 10), baseline: await baseline(), done: {}, users: {} }
  await privateJson(statePath, state)
}
assert.equal(state.schema, 1)
assert.equal(state.baseUrl, baseUrl.href, 'Az állapotfájl másik API-hoz tartozik.')
assert.equal(state.actor, actor.id, 'Az eredeti betöltőfiókot használd.')
async function step(key, action) {
  if (state.done[key] !== undefined) return state.done[key]
  const value = await action()
  state.done[key] = value ?? true
  await privateJson(statePath, state)
  return state.done[key]
}
async function seed() {
  const company = await step('company', async () => {
    assert.ok(!(await admin.request('/api/v1/tenants')).some(item => item.name === companyName), 'Már van ilyen nevű cég; nem készítek másolatot.')
    return admin.request('/api/v1/tenants', { method: 'POST', body: { name: companyName }, status: 201 })
  })
  const tenantId = company.id
  const request = (path, options = {}) => admin.request(path, { ...options, tenantId })
  const currentCompany = await request('/api/v1/company')
  assert.equal(currentCompany.data.name, companyName)
  await step('company-details', () => request('/api/v1/company', { method: 'PUT', body: {
    ...currentCompany.data, legalName: 'Demo Flotta – fiktív bemutatócég', address: address('Budapest', '1117'),
    email: 'iroda@demo-flotta.example.test', timeZone: 'Europe/Budapest', currency: 'HUF', distanceUnit: 'km',
  } }))
  const locations = []
  for (const [index, site] of sites.entries()) {
    const contact = await step(`contact-${index}`, () => request('/api/v1/company/contacts', { method: 'POST', body: {
      name: site.contact, position: 'Demó telephelyi kapcsolattartó', email: `telephely-${index + 1}@demo-flotta.example.test`, phone: null,
    } }))
    locations.push(await step(`site-${index}`, () => request('/api/v1/company/sites', { method: 'POST', body: {
      name: site.name, code: site.code, address: address(site.city, site.postalCode), contactId: contact.id, email: `telephely-${index + 1}@demo-flotta.example.test`, phone: null,
    } })))
  }
  const companyPartners = []
  for (const [index, partner] of partners.entries()) companyPartners.push(await step(`partner-${index}`, () => request('/api/v1/partners', { method: 'POST', body: {
    name: partner.name, isLessor: partner.isLessor, isService: partner.isService, address: address(partner.city, partner.postalCode, index + 1),
    email: `partner-${index + 1}@demo-flotta.example.test`, phone: null, website: null, notes: demoNote,
    contacts: [{ name: `Demó kapcsolattartó ${index + 1}`, position: partner.isLessor ? 'Ügyintéző' : 'Szervizvezető', email: `kapcsolat-${index + 1}@demo-flotta.example.test`, phone: null }],
  } })))
  const companyGroups = {}
  for (const group of groups) companyGroups[group.key] = await step(`group-${group.key}`, async () => {
    assert.ok(!(await admin.request('/api/v1/permission-groups')).some(existing => existing.name === group.name), 'Már van ilyen demócsoport; nem készítek másolatot.')
    return admin.request('/api/v1/permission-groups', { method: 'POST', status: 201, body: {
      name: group.name, permissions: group.permissions, companyIds: [tenantId],
      dashboardMode: group.key === 'fleet' ? 'Overview' : 'Vehicle', dashboardPriority: 10,
      siteScopes: [{ companyId: tenantId, allSites: group.site === undefined, siteIds: group.site === undefined ? [] : [locations[group.site].id] }],
    } })
  })
  console.log('Cég, 3 telephely, 5 partner és 8 jogcsoport elkészült.')
  for (const person of people) {
    if (!state.users[person.userName]) {
      state.users[person.userName] = { password: randomBytes(18).toString('base64url') }
      await privateJson(statePath, state)
    }
    const credential = state.users[person.userName]
    await step(`user-${person.userName}`, async () => {
      const account = client()
      // Recover a registration whose HTTP response or local checkpoint was interrupted.
      const existing = (await pages(`/api/v1/system/users?search=${encodeURIComponent(person.userName)}`)).find(item => item.id === person.userName)
      if (existing) {
        assert.equal(existing.email, person.email)
        await account.login(person.userName, credential.password)
      } else {
        await admin.request('/api/v1/auth/register', { method: 'POST', status: 201, body: {
          userName: person.userName, displayName: person.displayName, email: person.email, password: credential.password,
        } })
        await account.login(person.userName, credential.password)
      }
      await account.logout()
      return { id: person.userName }
    })
    await step(`membership-${person.userName}`, async () => {
      const access = await admin.request(`/api/v1/permission-groups/users/${person.userName}`)
      assert.ok(access.groupIds.every(id => id === companyGroups[person.group].id) && !access.adminCompanyIds.length && !access.hasOtherGroups,
        'A demófiók váratlan csoporttagsággal rendelkezik; nem írom felül.')
      if (access.groupIds.includes(companyGroups[person.group].id)) return true
      return admin.request(`/api/v1/permission-groups/users/${person.userName}`, { method: 'PUT', body: {
        groupIds: [companyGroups[person.group].id], adminCompanyIds: [], version: access.version,
      } })
    })
  }
  await privateJson(credentialsPath, {
    company: companyName, url: frontendUrl.href,
    users: people.map(person => ({ userName: person.userName, displayName: person.displayName, password: state.users[person.userName].password,
      group: groups.find(group => group.key === person.group).name, suspended: !!person.suspended })),
  })
  console.log('10 demófiók elkészült. Egyik sem kapott admin- vagy rendszerszintű jogot.')
  const sampleCars = vehicles(state.date)
  for (const [index, input] of sampleCars.entries()) {
    const servicePartner = companyPartners[2 + (input.site ?? 0)]
    const car = await step(`vehicle-${index}`, async () => {
      const existing = (await request('/api/v1/vehicles')).find(item => item.registration === input.registration)
      if (existing) {
        const detail = await request(`/api/v1/vehicles/${existing.id}/details`)
        assert.equal(detail.data.vin, input.data.vin)
        assert.equal(detail.data.notes, demoNote)
        return existing
      }
      return request('/api/v1/vehicles', { method: 'POST', status: 201, body: {
        ...input, siteId: input.site === null ? null : locations[input.site].id,
        data: { ...input.data, preferredServicePartnerId: servicePartner.id },
      } })
    })
    const path = `/api/v1/vehicles/${car.id}`
    if (input.data.ownership !== 'Owned') await step(`lease-${index}`, async () => {
      const number = `DEMO-LIZ-${String(index + 1).padStart(3, '0')}`
      const previous = (await pages(`${path}/leases`, tenantId)).find(item => item.data.contractNumber === number)
      return previous ?? request(`${path}/leases`, { method: 'POST', body: {
        partnerId: companyPartners[input.data.ownership === 'Rented' ? 1 : 0].id, contractNumber: number,
        startDate: day(state.date, -365), endDate: day(state.date, 730), paymentAmount: 120000 + index * 7500,
        currency: 'HUF', billingFrequency: 'Monthly', annualKmLimit: 30000, totalKmLimit: 90000, status: 'Active', documentUrl: null, notes: demoNote,
      } })
    })
    for (let occurrence = 0; occurrence < 2; occurrence++) await step(`service-${index}-${occurrence}`, async () => {
      const order = `DEMO-SZ-${String(index + 1).padStart(3, '0')}-${occurrence + 1}`
      const previous = (await pages(`${path}/services`, tenantId)).find(item => item.data.workOrderNumber === order)
      return previous ?? request(`${path}/services`, { method: 'POST', body: {
        partnerId: servicePartner.id, performedOn: day(state.date, occurrence === 0 ? -210 : -30),
        kilometers: input.odometerKm - (occurrence === 0 ? 15000 : 1500),
        description: occurrence === 0 ? 'Időszakos karbantartás, folyadékok és szűrők ellenőrzése' : index % 2 ? 'Fékellenőrzés és abroncscsere' : 'Éves átvizsgálás és diagnosztika',
        workOrderNumber: order, cost: 45000 + index * 2500 + occurrence * 18000, currency: 'HUF',
        nextServiceDate: day(state.date, 150), nextServiceKm: input.odometerKm + 15000, documentUrl: null, notes: demoNote,
      } })
    })
    await step(`odometer-${index}`, async () => {
      const current = await request(path)
      if (current.odometerKm >= input.odometerKm + 350) return true
      return request(`${path}/odometer`, { method: 'POST', body: { kilometers: input.odometerKm + 350, version: current.version } })
    })
    if (input.site !== null && input.status === 'Active') {
      // These are real, audited seed-time assignments, never backdated history.
      const assignee = [people[5], people[6], people[index % 2 ? 7 : 4]][input.site]
      for (const [stage, userId] of (index < 6 ? [['handover', people[1].userName], ['current', assignee.userName]] : [['current', assignee.userName]])) {
        await step(`assignee-${index}-${stage}`, async () => {
          const current = await request(path)
          return request(`${path}/assignee`, { method: 'PUT', body: { userId, version: current.version } })
        })
      }
    }
    if ((index + 1) % 10 === 0) console.log(`${index + 1}/30 jármű és kapcsolódó előzményei elkészültek.`)
  }
  await step('suspended-member', async () => {
    const person = people.find(item => item.suspended)
    const member = await request(`/api/v1/members/${person.userName}`)
    return !member.isActive || request(`/api/v1/members/${person.userName}/status`, { method: 'PATCH', body: { isActive: false, version: member.version } })
  })
  state.completedAt = new Date().toISOString()
  await privateJson(statePath, state)
}

async function verify() {
  const tenantId = state.done.company.id
  const cars = await admin.request('/api/v1/vehicles', { tenantId })
  const locations = await admin.request('/api/v1/company/sites', { tenantId })
  const members = await pages('/api/v1/members?pageSize=100', tenantId)
  assert.equal(cars.length, 30)
  assert.equal(locations.length, 3)
  assert.equal(cars.filter(car => car.siteId === null).length, 2)
  assert.equal((await pages('/api/v1/partners', tenantId)).length, 5)
  assert.equal(members.filter(member => people.some(person => person.userName === member.userId)).length, 10)
  let leaseCount = 0, serviceCount = 0, assignmentCount = 0
  for (const car of cars) {
    leaseCount += (await pages(`/api/v1/vehicles/${car.id}/leases`, tenantId)).length
    serviceCount += (await pages(`/api/v1/vehicles/${car.id}/services`, tenantId)).length
    assignmentCount += (await pages(`/api/v1/vehicles/${car.id}/assignee-history`, tenantId)).length
  }
  assert.equal(leaseCount, 18)
  assert.equal(serviceCount, 60)
  for (const person of people) {
    const profile = await admin.request(`/api/v1/system/users/${person.userName}`)
    assert.deepEqual(profile.systemPermissions, [])
    assert.equal(members.find(member => member.userId === person.userName).isActive, !person.suspended)
  }
  for (const [id, original] of Object.entries(state.baseline.companies)) assert.ok(isDeepStrictEqual(await companySnapshot(id), original), `Meglévő cég változott: ${id}`)
  for (const [id, original] of Object.entries(state.baseline.users)) {
    const current = await admin.request(`/api/v1/system/users/${id}`)
    assert.ok(isDeepStrictEqual(current, { ...original, version: original.version + (id === actor.id ? 1 : 0) }), `Meglévő profil változott: ${id}`)
  }
  const demoGroups = (await admin.request('/api/v1/permission-groups')).filter(group => groups.some(item => item.name === group.name))
  assert.equal(demoGroups.length, 8)
  assert.ok(demoGroups.every(group => !group.isAdmin && !group.allPermissions && group.companies.length === 1 && group.companies[0].id === tenantId))
  for (const person of [people[0], people[5], people[6], people[4], people[9]]) {
    const account = client()
    await account.login(person.userName, state.users[person.userName].password)
    try {
      const otherCompanyId = Object.keys(state.baseline.companies)[0]
      if (otherCompanyId) await account.request('/api/v1/vehicles', { tenantId: otherCompanyId, status: 403 })
      await account.request('/api/v1/system/users', { status: 403 })
      if (person.suspended) {
        await account.request('/api/v1/vehicles', { tenantId, status: 403 })
        continue
      }
      const scope = groups.find(group => group.key === person.group).site
      const siteId = scope === undefined ? null : state.done[`site-${scope}`].id
      const visible = await account.request('/api/v1/vehicles', { tenantId })
      assert.deepEqual(visible.map(car => car.id).sort(), cars.filter(car => !siteId || car.siteId === siteId).map(car => car.id).sort())
      const dashboard = await account.request('/api/v1/dashboard', { tenantId })
      const canOverview = state.done[`group-${person.group}`].permissions.includes('vehicles.overview.read')
      assert.equal(dashboard.canReadOverview, canOverview)
      assert.equal(dashboard.mode, canOverview ? 'Overview' : 'Vehicle')
      assert.deepEqual(dashboard.vehicles.map(car => car.vehicle.id).sort(), visible.map(car => car.id).sort())
      await account.request('/api/v1/dashboard/overview', { tenantId, status: canOverview ? 200 : 403 })
      if (siteId) {
        const hidden = cars.find(car => car.siteId !== null && car.siteId !== siteId)
        const unassigned = cars.find(car => car.siteId === null)
        await account.request(`/api/v1/vehicles/${hidden.id}`, { tenantId, status: 404 })
        await account.request(`/api/v1/vehicles/${unassigned.id}`, { tenantId, status: 404 })
        await account.request('/api/v1/partners', { tenantId, status: 403 })
      }
    } finally { await account.logout() }
  }
  console.log(`Ellenőrizve: 3 telephely, 10 demófiók, 30 jármű, 5 partner, 18 szerződés, 60 szerviz, ${assignmentCount} használati bejegyzés. A meglévő cégadatok, profilok és rendszerjogok megmaradtak.`)
  console.log('Ellenőrizve: teljes céges és mindhárom telephelyre korlátozott hozzáférés, idegen cég és telephely nélküli jármű kizárása, felfüggesztett tagság tiltása.')
  console.log(`Demó bejelentkezések: ${fileURLToPath(credentialsPath)}`)
}
async function seedBookings() {
  const tenantId = state.done.company.id
  const request = (path, options = {}) => admin.request(path, { ...options, tenantId })
  assert.equal((await request('/api/v1/company')).data.name, companyName)
  const accounts = [people[0], people[1]].map(person => ({ ...person, account: client() }))
  const plan = [
    { index: 1, slots: [[0, 1, 3], [1, 7, 10]] },
    { index: 2, slots: [[1, 0, 2], [0, 5, 11]] },
    { index: 3, slots: [[0, 2, 2], [1, 10, 13]] },
    { index: 5, slots: [[1, 4, 6], [0, 16, 22]] },
  ]
  const settings = await admin.request('/api/v1/permission-groups')
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Budapest', dateStyle: 'short' }).format(new Date())
  const base = state.bookingDate ?? today
  const samples = vehicles(state.date)
  const calendar = (account, id, date) => account.request(`/api/v1/vehicles/${id}/bookings?month=${date.slice(0, 7)}-01`, { tenantId })
  const calendars = async (account, id, start, end) => Promise.all(
    [...new Set([start.slice(0, 7), end.slice(0, 7)])].map(month => calendar(account, id, month)),
  )

  try {
    for (const person of accounts) await person.account.login(person.userName, state.users[person.userName].password)
    for (const [i, person] of accounts.entries()) {
      const group = settings.find(g => g.id === state.done[`group-${person.group}`].id)
      assert.ok(group && !group.isAdmin && !group.allPermissions && group.companies.length === 1 && group.companies[0].id === tenantId)
      const company = group.companies[0]
      const permissions = [...new Set([...group.permissions, 'vehicles.bookings.read', 'vehicles.bookings.create',
        ...(i === 0 ? ['vehicles.bookings.manage'] : [])])]
      if (permissions.length !== group.permissions.length) await admin.request(`/api/v1/permission-groups/${group.id}`, {
        method: 'PUT', body: { name: group.name, permissions, version: group.version, companyIds: [tenantId],
          siteScopes: [{ companyId: tenantId, allSites: company.allSites, siteIds: company.sites.map(site => site.id) }] },
      })
    }
    const schedule = []
    for (const { index, slots } of plan) {
      const { id, registration } = state.done[`vehicle-${index}`]
      const path = `/api/v1/vehicles/${id}`
      const detail = await request(`${path}/details`)
      const sample = samples[index]
      assert.equal(detail.vehicle.registration, sample.registration)
      assert.equal(detail.vehicle.status, 'Active')
      assert.equal(detail.data.vin, sample.data.vin)
      for (const [person, first, last] of slots) {
        const startsOn = day(base, first), endsOn = day(base, last)
        const existing = await calendars(admin, id, startsOn, endsOn)
        assert.ok(existing.every(month => month.today === today), 'A demó cég dátuma eltér a helyi naptárétól.')
        const conflicts = existing.flatMap(month => month.items).filter(row => row.startsOn <= endsOn && row.endsOn >= startsOn)
        const actor = accounts[person]
        const match = conflicts.find(row => row.userId === actor.userName && row.startsOn === startsOn && row.endsOn === endsOn)
        assert.ok(match || (conflicts.length === 0 && startsOn >= today), `A mintaidőszak nem foglalható: ${registration}, ${startsOn}.`)
        schedule.push({ id, path, registration, startsOn, endsOn, actor, match, enabled: existing[0].enabled })
      }
    }
    state.bookingDate = base
    await privateJson(statePath, state)
    const verified = []
    for (const { id, path, registration, startsOn, endsOn, actor, match, enabled } of schedule) {
      if (!enabled && !verified.some(row => row.id === id)) await request(`${path}/booking-settings`, { method: 'PUT', body: { enabled: true } })
      const booking = match ?? await actor.account.request(`${path}/bookings`, { method: 'POST', tenantId, body: { startsOn, endsOn } })
      for (const data of await calendars(actor.account, id, startsOn, endsOn)) {
        assert.ok(data.enabled)
        assert.ok(data.items.some(row => row.id === booking.id && row.name === actor.displayName && row.startsOn === startsOn && row.endsOn === endsOn))
      }
      verified.push({ id, registration, name: booking.name, startsOn, endsOn })
    }
    console.table(verified)
  } finally {
    await Promise.allSettled(accounts.map(({ account }) => account.logout()))
  }
}
try {
  if (!verifyOnly && !bookingsOnly && !state.completedAt) await seed()
  assert.ok(state.completedAt, 'A betöltés még nem fejeződött be; futtasd --verify-only nélkül.')
  if (bookingsOnly || withBookings) await seedBookings()
  if (!bookingsOnly) await verify()
} finally {
  await admin.logout()
}
