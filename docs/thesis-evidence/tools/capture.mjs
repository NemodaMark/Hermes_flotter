import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const base = new URL(process.env.HERMES_EVIDENCE_URL ?? 'http://127.0.0.1:5187/')
assert.equal(base.origin, 'http://127.0.0.1:5187', 'Use the dedicated loopback evidence instance.')
assert.equal(base.href, base.origin + '/')
const { adminPassword } = JSON.parse(await readFile(process.env.HERMES_BROWSER_ADMIN, 'utf8'))
const { chromium } = await import(process.env.HERMES_PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.HERMES_PLAYWRIGHT_MODULE)).href : 'playwright')
const output = resolve(process.env.HERMES_EVIDENCE_OUTPUT ?? 'docs/thesis-evidence/screenshots')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.HERMES_BROWSER_BINARY })
console.log('Browser ' + browser.version())
const desktop = { viewport: { width: 1440, height: 960 }, locale: 'hu-HU', timezoneId: 'Europe/Budapest', colorScheme: 'light', reducedMotion: 'reduce' }
const page = await browser.newPage(desktop)
page.setDefaultTimeout(12000)

async function login(tab) {
  const health = await tab.request.get(new URL('/health/version', base).href)
  assert.equal((await health.json()).environment, 'Development')
  await tab.goto(base.href, { waitUntil: 'domcontentloaded' })
  await tab.getByLabel('Felhasználónév vagy e-mail-cím').fill('admin')
  await tab.getByLabel('Jelszó', { exact: true }).fill(adminPassword)
  await tab.getByRole('button', { name: 'Belépés', exact: true }).click()
  await tab.getByText('Demo Flotta', { exact: true }).first().waitFor()
}
async function snap(tab, name) {
  await tab.evaluate(() => document.fonts.ready.then(() => true))
  await tab.screenshot({ path: resolve(output, name + '.png'), animations: 'disabled', caret: 'hide' })
  console.log(name + ' | ' + new URL(tab.url()).hash)
}
const carName = 'DEMO-001'
const resumeAfterFuel = process.argv.includes('--resume-after-fuel')
async function waitForAssignee(tab) {
  await car(tab).getByRole('region', { name: 'Jelenlegi használó' }).getByText(/Nincs kijelölve/).waitFor()
}
const car = tab => tab.getByRole('region', { name: 'Járműadatlap' })
async function openCar(tab) {
  await tab.goto(new URL('#/vehicles', base).href, { waitUntil: 'domcontentloaded' })
  await tab.getByRole('button', { name: 'Jármű adatlapja: ' + carName }).click()
  await car(tab).getByRole('heading', { name: carName }).waitFor()
  await waitForAssignee(tab)
}
async function section(tab, name) {
  const toggle = car(tab).locator('.vehicle-section-toggle')
  if (await toggle.isVisible()) await toggle.click()
  await car(tab).getByRole('navigation', { name: 'Járműadatlap részei' })
    .getByRole('button', { name, exact: true }).click()
}
const group = (tab, name) => car(tab).locator('summary').getByText(name, { exact: true })
function examplePdf() {
  const stream = 'BT /F1 26 Tf 66 704 Td (HERMES - MINTA OKMANY) Tj 0 -40 Td /F1 14 Tf (DEMO-001 - Dokumentumkezelesi pelda) Tj 0 -24 Td (Fiktiv tesztadat - nincs joghatasa.) Tj ET\n'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + 'endstream',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf)
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n'
    return String(offset).padStart(10, '0') + ' 00000 n \n'
  })
  const xref = Buffer.byteLength(pdf)
  return Buffer.from(pdf + 'xref\n0 6\n0000000000 65535 f \n' + offsets.join('') +
    'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n')
}
function datePlus(days) {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: desktop.timezoneId }).format(new Date())
  const date = new Date(today + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
try {
  await login(page)
  if (resumeAfterFuel) {
    await openCar(page)
  } else {
    await page.getByRole('heading', { name: 'Havi futásteljesítmény' }).waitFor()
    await snap(page, '01-flotta-attekinto')
    await page.goto(new URL('#/vehicles', base).href, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Jármű adatlapja: ' + carName }).waitFor()
    await snap(page, '02-jarmulista')
    await page.getByRole('button', { name: 'Jármű adatlapja: ' + carName }).click()
    await car(page).getByRole('heading', { name: 'Járműadatok' }).waitFor()
    await snap(page, '03-jarmuadatlap')
    await car(page).getByRole('button', { name: 'Tankolás rögzítése: ' + carName }).click()
    const fuel = page.getByRole('dialog', { name: 'Tankolás rögzítése' })
    const save = fuel.getByRole('button', { name: 'Tankolás mentése' })
    const include = fuel.getByRole('checkbox', { name: /^Km és magánhasználat elszámolása/ })
    await include.check()
    const dayField = fuel.getByLabel('Tankolás napja')
    await dayField.fill(datePlus(1))
    await fuel.getByRole('alert').filter({ hasText: 'A tankolás dátuma nem lehet jövőbeli.' }).waitFor()
    assert.equal(await save.isDisabled(), true)
    await snap(page, '04-tankolas-validacio')
    await dayField.fill(datePlus(0))
    const kilometers = fuel.getByLabel('Kilométerállás')
    const initialKm = Number(await kilometers.inputValue())
    assert.ok(initialKm >= 18350, 'The fictional seed odometer is required.')
    await kilometers.fill(String(initialKm + 320))
    await fuel.getByLabel('Liter', { exact: true }).fill('38.5')
    await fuel.getByRole('checkbox', { name: 'Teletankoltam' }).check()
    await fuel.locator('output').filter({ hasText: '320 km' }).waitFor()
    await fuel.getByLabel('Ebből magánhasználat (km)').fill('40')
    await snap(page, '05-tankolas-adatbevitel')
    const fuelSaved = page.waitForResponse(response => /\/fuel$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST')
    await save.click()
    assert.ok((await fuelSaved).ok())
    await fuel.waitFor({ state: 'hidden' })
    await section(page, 'Tankolás és km')
    const newFuel = car(page).getByText(/38,5 l/).last()
    await newFuel.waitFor()
    await snap(page, '06-tankolas-eredmeny')
  }
  await section(page, 'Szerviz és iratok')
  await group(page, 'Szerviz és időpontok').click()
  await car(page).getByRole('heading', { name: /Demo Központi Szerviz/ }).first().waitFor()
  await snap(page, '07-szervizelozmenyek')
  await group(page, 'Szerviz és időpontok').click()
  await group(page, 'Járműokmányok').click()
  const docs = car(page).getByRole('region', { name: 'Járműokmányok' })
  const name = 'hermes-minta-forgalmi.pdf'
  const preview = docs.getByRole('button', { name: 'Megtekintés: ' + name })
  await docs.locator('.document-list').waitFor()
  if (!(await preview.count())) {
    await docs.locator('input[type=file]').setInputFiles({ name, mimeType: 'application/pdf', buffer: examplePdf() })
    await docs.getByRole('button', { name: 'Feltöltés', exact: true }).click()
  }
  await preview.click()
  await page.getByRole('dialog', { name: 'Dokumentum előnézete' }).getByRole('img', { name: name + ' – 1. oldal' }).waitFor()
  await snap(page, '08-dokumentumelonezet')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Események', exact: true }).click()
  const eventName = 'Kötelező havi elszámolás · minta'
  const events = page.getByRole('dialog', { name: 'Flottaesemények' })
  await events.locator('.fleet-events-list').or(events.getByText('Ebben a hónapban nincs ütemezett esemény.')).waitFor()
  const savedEvent = events.getByRole('heading', { name: eventName, exact: true })
  if (!(await savedEvent.count())) {
    await events.getByRole('button', { name: 'Új esemény' }).click()
    const event = page.getByRole('dialog', { name: 'Új esemény' })
    await event.getByRole('combobox', { name: 'Érintett jármű' }).click()
    await event.getByRole('option', { name: 'Minden jármű' }).click()
    await event.getByLabel('Esemény neve').fill(eventName)
    await event.getByRole('combobox', { name: 'Ismétlődés' }).click()
    await event.getByRole('option', { name: 'Havonta', exact: true }).click()
    await event.getByRole('button', { name: 'Esemény mentése' }).click()
  }
  await savedEvent.waitFor()
  assert.equal(await savedEvent.count(), 1)
  await snap(page, '09-ismetlodoflottaesemeny')
  await page.goto(new URL('#/permission-groups', base).href, { waitUntil: 'domcontentloaded' })
  await page.getByText('Demo – Budapesti szerviz', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Jogosultságcsoport szerkesztése: Demo – Budapesti szerviz' }).click()
  await page.getByText('Demo Flotta', { exact: true }).last().waitFor()
  await snap(page, '10-jogosultsagcsoport')
  await page.goto(new URL('#/profile/admin', base).href, { waitUntil: 'domcontentloaded' })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const currentMileage = page.getByRole('region', { name: 'Aktuális havi km-állás' })
  for (const value of ['320', '280 km', '40 km']) {
    await currentMileage.getByText(value, { exact: true }).waitFor()
  }
  await snap(page, '11-szemelyes-km-profil')
  const mobile = await browser.newPage({ ...desktop, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  mobile.setDefaultTimeout(12000)
  await login(mobile)
  await openCar(mobile)
  await car(mobile).getByRole('heading', { name: 'Járműadatok' }).waitFor()
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await snap(mobile, '12-mobil-jarmuadatlap')
} finally {
  await browser.close()
}
