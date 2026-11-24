import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

const explicitModule = process.env.HERMES_PLAYWRIGHT_MODULE
const { chromium } = await import(explicitModule ? pathToFileURL(resolve(explicitModule)) : 'playwright')
const urls = (process.env.HERMES_BROWSER_URLS ?? 'http://127.0.0.1:5199').split(',').map(value => new URL(value))
for (const url of urls) assert.ok(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port !== '5173')
const adminFile = process.env.HERMES_BROWSER_ADMIN
assert.ok(adminFile, 'Provide the scratch instance administrator credential file.')
const { adminPassword } = JSON.parse(await readFile(adminFile, 'utf8'))
assert.ok(adminPassword)
const accountsFile = process.env.HERMES_BROWSER_ACCOUNTS
const accounts = accountsFile ? JSON.parse(await readFile(accountsFile, 'utf8')) : null
if (accounts) assert.equal(accounts.company, 'Demo Flotta')
const measure = process.argv.includes('--measure')
const measureGarage = process.argv.includes('--garage')
const garageRegistration = process.env.HERMES_BROWSER_GARAGE_REGISTRATION ?? 'DEMO-002'
assert.match(garageRegistration, /^DEMO-\d{3}$/)
const samples = Number(process.env.HERMES_BROWSER_SAMPLES ?? '1')
assert.ok(Number.isInteger(samples) && samples >= 1 && samples <= 10)
const garageCycles = Number(process.env.HERMES_BROWSER_GARAGE_CYCLES ?? '1')
assert.ok(Number.isInteger(garageCycles) && garageCycles >= 1 && garageCycles <= 50)

const profiles = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'slow-mobile', width: 390, height: 844, mobile: true, slow: true },
  { name: 'software', width: 1280, height: 800, slow: true, software: true },
  { name: 'no-webgl', width: 390, height: 844, mobile: true, unavailable: true },
]

async function logIn(page, url, user, password) {
  const health = await page.request.get(new URL('/health/version', url).href)
  assert.equal((await health.json()).environment, 'Development')
  await page.goto(url.href, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Felhasználónév vagy e-mail-cím').fill(user)
  await page.getByLabel('Jelszó', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Belépés', exact: true }).click()
  await page.locator('[data-view="dashboard"]').waitFor()
}

async function checkOverview(page, profile) {
  const edit = page.getByRole('button', { name: 'Elrendezés szerkesztése' })
  await page.locator('summary[aria-label="Fiókmenü"]').click()
  if (profile.mobile) {
    assert.equal(await edit.count(), 0)
    await page.keyboard.press('Escape')
    return
  }
  await edit.click()
  const grid = page.getByRole('region', { name: 'Áttekintő moduljai' })
  const remove = grid.getByRole('button', { name: / eltávolítása$/ })
  while (await remove.count()) await remove.first().click()
  await page.getByRole('button', { name: 'Modul hozzáadása' }).click()
  await page.getByRole('region', { name: 'Elérhető modulok' }).getByRole('button', { name: 'Jegyzet' }).click()
  const settings = page.getByRole('dialog', { name: 'Jegyzet · Beállítások' })
  await settings.getByRole('textbox', { name: 'Cím' }).fill('Böngészőteszt')
  await settings.getByRole('textbox', { name: 'Jegyzet' }).fill('A mentett jegyzet tartalma.')
  await settings.getByRole('spinbutton', { name: 'Szélesség (oszlop)' }).fill('8')
  await settings.getByRole('spinbutton', { name: 'Magasság (px)' }).fill('240')
  await settings.getByRole('button', { name: 'Alkalmazás' }).click()
  const note = page.getByRole('article', { name: 'Böngészőteszt' })
  const readPlacement = () => note.evaluate(element => ['--tile-column', '--tile-top', '--tile-columns', '--tile-height']
    .map(property => element.style.getPropertyValue(property)))
  const source = await readPlacement()
  const { column, row } = await grid.evaluate(element => {
    const style = getComputedStyle(element)
    return {
      column: (element.clientWidth + parseFloat(style.columnGap)) / Number(style.getPropertyValue('--dashboard-columns')),
      row: parseFloat(style.getPropertyValue('--dashboard-row-step')),
    }
  })
  async function drag(handle, dx, dy) {
    await handle.scrollIntoViewIfNeeded()
    const bounds = await handle.boundingBox()
    assert.ok(bounds)
    const x = bounds.x + bounds.width / 2
    const y = bounds.y + bounds.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + dx, y + dy, { steps: 5 })
    await page.mouse.up()
  }
  await drag(note.getByRole('button', { name: /^Böngészőteszt mozgatása/ }), column, row * 2)
  const moved = await readPlacement()
  assert.equal(Number(moved[0]), Number(source[0]) + 1)
  assert.equal(parseFloat(moved[1]), parseFloat(source[1]) + row * 2)
  await drag(note.getByRole('button', { name: 'Böngészőteszt átméretezése' }), column, row * 2)
  const resized = await readPlacement()
  assert.equal(Number(resized[2]), 9)
  assert.ok(parseFloat(resized[3]) > 240)
  await page.getByRole('button', { name: 'Elrendezés mentése' }).click()
  await page.reload()
  await note.getByText('A mentett jegyzet tartalma.').waitFor()
  assert.deepEqual(await readPlacement(), resized)
  await page.locator('summary[aria-label="Fiókmenü"]').click()
  await edit.click()
  await page.getByRole('button', { name: 'Alapelrendezés visszaállítása' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Visszaállítás', exact: true }).click()
  await page.getByRole('heading', { name: 'Havi futásteljesítmény' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Elrendezés mentése' }).count(), 0)
  assert.equal(await note.count(), 0)
}

async function checkDemoWorkspace(page, url) {
  const response = await page.request.get(new URL('/api/v1/tenants', url).href)
  const tenants = await response.json()
  const demo = tenants.find(company => company.name === 'Demo Flotta')
  assert.ok(demo, 'The seeded demo workspace is required.')
  return demo.id
}

async function openFleet(page) {
  await page.evaluate(() => { location.hash = '/vehicles' })
  await page.getByRole('textbox', { name: 'Jármű keresése' }).waitFor()
}

function examplePdf() {
  const content = '0 0 0 rg 24 24 50 50 re f\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const start = pdf.length
  pdf += `xref\n0 5\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
  return Buffer.from(pdf + `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`)
}

async function checkBookingAndPreview(page, url) {
  const demo = await checkDemoWorkspace(page, url)
  const auth = { headers: { 'X-Tenant-Id': demo } }
  const selected = await page.request.get(new URL('/api/v1/vehicles/search?search=DEMO-002', url).href, auth)
  const result = await selected.json()
  assert.deepEqual(result.items.map(item => item.registration), ['DEMO-002'])
  const bookingPath = `/api/v1/vehicles/${result.items[0].id}/bookings`
  await openFleet(page)
  const vehicle = page.getByRole('button', { name: 'Jármű adatlapja: DEMO-002' })
  await vehicle.click()
  const car = page.getByRole('region', { name: 'Járműadatlap' })
  await car.getByRole('heading', { name: 'DEMO-002' }).waitFor()
  const sections = car.getByRole('navigation', { name: 'Járműadatlap részei' })
  async function section(name) {
    const toggle = car.locator('.vehicle-section-toggle')
    if (await toggle.isVisible()) await toggle.click()
    await sections.getByRole('button', { name, exact: true }).click()
  }
  await section('Használat')
  await car.locator('summary').getByText('Foglalás', { exact: true }).click()
  const booking = page.getByRole('region', { name: 'Járműfoglalás' })
  await booking.getByRole('heading', { name: 'Foglalási naptár' }).waitFor()
  const month = new Date()
  month.setUTCDate(1)
  month.setUTCMonth(month.getUTCMonth() + 1)
  const monthString = month.toISOString().slice(0, 10)
  const data = await page.request.get(new URL(`${bookingPath}?month=${monthString}`, url).href, auth)
  const calendar = await data.json()
  assert.ok(calendar.enabled, 'Seed the booking examples before running the browser smoke test.')
  const day = Array.from({ length: 28 }, (_, index) => `${monthString.slice(0, 8)}${String(index + 1).padStart(2, '0')}`)
    .find(candidate => !calendar.items.some(item => item.startsOn <= candidate && item.endsOn >= candidate))
  assert.ok(day, 'No free day in the synthetic booking calendar.')
  await booking.getByLabel('Kezdőnap').fill(day)
  const created = page.waitForResponse(response => new URL(response.url()).pathname === bookingPath && response.request().method() === 'POST')
  await booking.getByRole('button', { name: 'Foglalás', exact: true }).click()
  assert.ok((await created).ok())
  const formattedDay = new Date(day).toLocaleDateString('hu-HU', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' })
  const own = booking.getByRole('listitem').filter({ hasText: 'Rendszergazda' }).filter({ hasText: formattedDay })
  await own.getByRole('button', { name: 'Lemondás' }).click()
  const cancelled = page.waitForResponse(response => new URL(response.url()).pathname.startsWith(bookingPath + '/') && response.request().method() === 'DELETE')
  await booking.getByRole('button', { name: 'Foglalás lemondása' }).click()
  assert.ok((await cancelled).ok())
  await own.waitFor({ state: 'detached' })

  await section('Szerviz és iratok')
  await car.locator('summary').getByText('Járműokmányok', { exact: true }).click()
  const documents = car.getByRole('region', { name: 'Járműokmányok' })
  const fileName = 'hermes-qa-preview.pdf'
  const preview = documents.getByRole('button', { name: `Megtekintés: ${fileName}` })
  await documents.locator('.document-list').waitFor()
  if (!(await preview.count())) {
    await documents.locator('input[type="file"]').setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: examplePdf() })
    await documents.getByRole('button', { name: 'Feltöltés', exact: true }).click()
  }
  await preview.click()
  await page.getByRole('dialog', { name: 'Dokumentum előnézete' }).getByRole('img', { name: `${fileName} – 1. oldal` }).waitFor()
  await page.keyboard.press('Escape')
}

async function checkGarage(page, url, profile) {
  await page.addInitScript(() => {
    const frames = []
    window.garageFrames = frames
    if (!window.WebGL2RenderingContext) return
    const raf = window.requestAnimationFrame
    let time = 0
    window.requestAnimationFrame = callback => raf.call(window, timestamp => { time = timestamp; callback(timestamp) })
    for (const key of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const draw = WebGL2RenderingContext.prototype[key]
      WebGL2RenderingContext.prototype[key] = function (...args) {
        if (this.canvas.getAttribute('aria-label') === 'Forgatható 3D járműmodell' && time && frames.at(-1) !== time) frames.push(time)
        return draw.apply(this, args)
      }
    }
  })
  await logIn(page, url, 'admin', adminPassword)
  await page.locator('.dashboard-overview').waitFor()
  await openFleet(page)
  await page.getByRole('button', { name: `Jármű adatlapja: ${garageRegistration}` }).click()
  await page.getByRole('heading', { name: garageRegistration }).waitFor()
  const started = performance.now()
  await page.getByRole('button', { name: '3D garázs', exact: true }).click()
  if (profile.unavailable) {
    await page.getByText('A 3D nézet ezen az eszközön nem érhető el.').waitFor()
    console.log(JSON.stringify({ origin: url.origin, profile: profile.name, unavailable: true }))
    return
  }
  await page.locator('.studio-camera-container').waitFor()
  const readyMs = Math.round(performance.now() - started)
  const camera = page.getByRole('button', { name: 'Kameravezérlés megnyitása' })
  if (await camera.isVisible()) await camera.click()
  await page.getByRole('button', { name: 'Bemutató mód' }).click()
  await page.waitForTimeout(2000)
  await page.evaluate(() => { window.garageFrames.length = 0 })
  await page.waitForTimeout(6000)
  const frames = await page.evaluate(() => window.garageFrames)
  assert.ok(frames.length > 1, 'No animation frames were captured.')
  const times = frames.slice(1).map((frame, index) => frame - frames[index]).sort((a, b) => a - b)
  const bytes = await page.evaluate(() => performance.getEntriesByType('resource')
    .filter(item => /\.(glb|hdr)$/.test(new URL(item.name).pathname))
    .reduce((sum, item) => sum + item.transferSize, 0))
  console.log(JSON.stringify({ origin: url.origin, profile: profile.name, readyMs, bytes,
    fps: Math.round((frames.length - 1) * 10000 / (frames.at(-1) - frames[0])) / 10,
    p95FrameMs: Math.round(times[Math.ceil(times.length * .95) - 1] * 10) / 10 }))
}

async function checkRestrictedAccount(browser, url, options) {
  if (!accounts) return
  const page = await browser.newPage(options)
  try {
    const user = accounts.users.find(account => account.userName === 'demo.kiss.ferenc')
    assert.ok(user)
    await logIn(page, url, user.userName, user.password)
    const demo = await checkDemoWorkspace(page, url)
    await openFleet(page)
    await page.getByRole('button', { name: 'Jármű adatlapja: DEMO-001' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Jármű adatlapja: DEMO-002' }).count(), 0)
    const search = await page.request.get(new URL('/api/v1/vehicles/search?search=DEMO-002', url).href, { headers: { 'X-Tenant-Id': demo } })
    assert.equal(search.status(), 200)
    assert.deepEqual((await search.json()).items, [])
    const foreign = await page.request.get(new URL('/api/v1/vehicles/search', url).href, { headers: { 'X-Tenant-Id': randomUUID() } })
    assert.equal(foreign.status(), 403)
  } finally { await page.close() }
}

async function checkQuickView(page, url, profile) {
  const assetPaths = []
  page.on('request', req => {
    const path = new URL(req.url()).pathname
    if (/\.(glb|hdr)$/.test(path) || /VehicleStudio-.*\.js$/.test(path)) assetPaths.push(path)
  })
  const menu = page.getByRole('navigation', { name: 'Jármű gyorsmenü' })
  const switchView = page.getByRole('button', { name: 'Autós nézet' })
  await page.locator('summary[aria-label="Fiókmenü"]').click()
  const started = performance.now()
  await switchView.click()
  await menu.waitFor()
  const actionsMs = Math.round(performance.now() - started)
  const quick = page.getByRole('button', { name: '3D garázs', exact: true })
  const optIn = await quick.isVisible()
  await menu.getByRole('button', { name: 'Tankolás' }).click()
  await page.getByRole('dialog', { name: 'Tankolás rögzítése' }).waitFor()
  await page.keyboard.press('Escape')
  await menu.getByRole('button', { name: /^Kilométerállás:/ }).click()
  await page.getByRole('dialog', { name: 'Kilométerállás rögzítése' }).waitFor()
  await page.keyboard.press('Escape')
  await menu.getByRole('button', { name: 'Járműadatok' }).click()
  await page.getByRole('button', { name: 'Teljes járműadatlap' }).waitFor()
  await page.keyboard.press('Escape')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  const beforeOptIn = [...assetPaths]
  if (optIn) assert.deepEqual(beforeOptIn, [], 'The quick view requested 3D assets.')
  const warnings = []
  page.on('console', message => { if (/too many active WebGL contexts/i.test(message.text())) warnings.push(message.text()) })
  const cycles = optIn ? garageCycles : 1
  for (let cycle = 0; cycle < cycles; cycle++) {
    if (optIn) await quick.click()
    if (profile.unavailable) {
      await page.getByText('A 3D nézet ezen az eszközön nem érhető el.').waitFor()
    } else {
      await page.locator('.studio-camera-container').waitFor()
      await page.getByRole('img', { name: 'Forgatható 3D járműmodell' }).waitFor()
    }
    if (optIn) {
      await page.getByRole('button', { name: 'Gyorsnézet' }).click()
      await quick.waitFor()
      assert.equal(await page.locator('.vehicle-studio canvas').count(), 0)
    }
  }
  assert.deepEqual(warnings, [])
  console.log(JSON.stringify({ origin: url.origin, profile: profile.name, actionsMs, optIn, beforeOptIn, cycles }))
}

async function smoke(url, profile) {
  const { name, mobile, slow, software, unavailable, width, height } = profile
  const args = ['--enable-unsafe-swiftshader']
  if (software) args.push('--use-angle=swiftshader', '--use-gl=angle')
  if (unavailable) args.push('--disable-webgl')
  const browser = await chromium.launch({ executablePath: process.env.HERMES_BROWSER_BINARY, args })
  try {
    const options = { viewport: { width, height }, hasTouch: !!mobile, isMobile: !!mobile, colorScheme: 'dark', reducedMotion: 'reduce' }
    const page = await browser.newPage(options)
    page.setDefaultTimeout(30000)
    const faults = []
    page.on('pageerror', error => faults.push(error.message))
    page.on('response', response => { if (response.status() >= 500) faults.push(`${new URL(response.url()).pathname} HTTP ${response.status()}`) })
    if (slow) {
      const client = await page.context().newCDPSession(page)
      await client.send('Emulation.setCPUThrottlingRate', { rate: 4 })
      await client.send('Network.enable')
      await client.send('Network.emulateNetworkConditions', {
        offline: false, latency: 80, downloadThroughput: 1_250_000, uploadThroughput: 625_000, connectionType: 'cellular4g',
      })
      await page.addInitScript(() => Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 2 }))
    }
    if (measureGarage) {
      await checkGarage(page, url, profile)
      assert.deepEqual(faults, [], name)
      return
    }
    await logIn(page, url, 'admin', adminPassword)
    await page.locator('.dashboard-overview').waitFor()
    if (!measure) await checkOverview(page, profile)
    await checkQuickView(page, url, profile)
    if (!measure && (name === 'desktop' || name === 'no-webgl')) {
      await checkBookingAndPreview(page, url)
      await checkRestrictedAccount(browser, url, options)
    }
    assert.deepEqual(faults, [], name)
  } finally {
    await browser.close()
  }
}

const only = process.env.HERMES_BROWSER_PROFILE
for (const profile of profiles.filter(candidate => !only || candidate.name === only)) {
  for (let repeat = 0; repeat < samples; repeat++) {
    for (const url of repeat % 2 ? [...urls].reverse() : urls) await smoke(url, profile)
  }
}
