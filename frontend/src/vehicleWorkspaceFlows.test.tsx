import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { VehiclePage } from './VehiclePage'
import { VehicleTaskPanel } from './VehicleTaskPanel'
import { fleetApi } from './fleetApi'
import type { VehicleRecord } from './fleetApi'
import { mediaApi } from './peopleApi'
import { chooseOption } from './selectTestUtils'

const user = { id: 'anna', displayName: 'Anna', email: 'anna@example.test' }
const tenant = { id: 'own-company', name: 'Flotta', permissions: ['vehicles.read', 'vehicles.update', 'vehicles.leasing.read', 'vehicles.documents.manage', 'audit.read'] }
const record: VehicleRecord = {
  vehicle: { id: 'car', registration: 'DEMO-007', make: 'Ford', model: 'Transit', status: 'Active', version: 4, permissions: ['vehicles.read', 'vehicles.update'] },
  data: { registrationCountry: 'HU', vin: 'DEMO0000000000007', fleetNumber: 'Fleet-7', category: 'Van', bodyType: 'Van', year: 2024, firstRegistration: null, color: 'Kék', fuelType: 'Diesel',
    powerKw: 100, engineCapacityCc: null, transmission: 'Manual', seats: null, grossWeightKg: null, payloadKg: null, cargoVolumeM3: null, batteryKwh: null, ownership: 'Owned',
    fleetEntryDate: null, fleetExitDate: null, inspectionDueDate: null, insuranceDueDate: null, nextServiceDate: null, nextServiceKm: null, preferredServicePartnerId: null, notes: 'Eredeti megjegyzés' },
  preferredServicePartnerName: null, statusReason: null, updatedAt: null, updatedBy: null,
}
function mount(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
  return client
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]))))
  vi.spyOn(fleetApi, 'vehicle').mockResolvedValue(record)
  vi.spyOn(mediaApi, 'assignee').mockResolvedValue({ current: { userId: 'ferenc', displayName: 'Kiss Ferenc', assignedAt: '2026-10-22T12:00:00Z' } })
  vi.spyOn(fleetApi, 'partnerOptions').mockResolvedValue([])
})

it('uses five flat sections and readable data without disabled form fields or duplicate assignee summaries', async () => {
  mount(<VehiclePage user={user} tenant={tenant} id="car" onBack={vi.fn()} />)
  await screen.findByRole('heading', { name: 'DEMO-007' })
  expect(within(screen.getByRole('navigation', { name: 'Járműadatlap részei' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Áttekintés', 'Tankolás és km', 'Használat', 'Szerviz és iratok', 'Előzmények'])
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(screen.getByText('DEMO0000000000007')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Használat' }))
  expect(screen.getAllByText('Kiss Ferenc')).toHaveLength(1)
})

it('opens only one garage task and never exposes financial content through broader company permissions', async () => {
  vi.mocked(fleetApi.vehicle).mockResolvedValue({ ...record, vehicle: { ...record.vehicle, permissions: ['vehicles.read'] } })
  const leases = vi.spyOn(fleetApi, 'leases')
  mount(<VehicleTaskPanel user={user} tenant={tenant} id="car" section="leases" />)
  await screen.findByText('Nincs jogosultságod ehhez a művelethez.')
  expect(leases).not.toHaveBeenCalled()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Szerkesztés' })).not.toBeInTheDocument()
})

it('keeps the garage data task read-only even for a vehicle editor', async () => {
  mount(<VehicleTaskPanel user={user} tenant={tenant} id="car" section="data" />)
  await screen.findByText('DEMO0000000000007')
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Tankolás|Km rögzítése|Szerkesztés/ })).not.toBeInTheDocument()
})

it('hides cached task content when a background authorization check fails', async () => {
  const client = mount(<VehicleTaskPanel user={user} tenant={tenant} id="car" section="data" />)
  await screen.findByText('DEMO0000000000007')
  vi.mocked(fleetApi.vehicle).mockRejectedValue(new Error('Nincs hozzáférésed ehhez a járműhöz.'))
  await act(async () => { await client.invalidateQueries({ queryKey: ['fleet-management', tenant.id, 'car', 'vehicle'] }) })
  await screen.findByRole('alert')
  expect(screen.queryByText('DEMO0000000000007')).not.toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('Nincs hozzáférésed')
})

it('preserves the original edit version and draft after a background refresh and a failed save', async () => {
  const save = vi.spyOn(fleetApi, 'saveVehicle').mockRejectedValue(new Error('Időközben módosult a jármű.'))
  const client = mount(<VehiclePage user={user} tenant={tenant} id="car" onBack={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Szerkesztés' }))
  fireEvent.change(screen.getByLabelText('Flottaazonosító'), { target: { value: 'Nem veszik el' } })
  vi.mocked(fleetApi.vehicle).mockResolvedValue({ ...record, vehicle: { ...record.vehicle, version: 5 } })
  await act(async () => { await client.invalidateQueries({ queryKey: ['fleet-management', tenant.id, 'car', 'vehicle'] }) })
  expect(screen.getByLabelText('Flottaazonosító')).toHaveValue('Nem veszik el')
  await userEvent.click(screen.getByRole('button', { name: 'Járműadatok mentése' }))
  await screen.findByRole('alert')
  expect(save).toHaveBeenCalledWith(tenant.id, 'car', expect.objectContaining({ version: 4, data: expect.objectContaining({ fleetNumber: 'Nem veszik el' }) }))
  expect(screen.getByLabelText('Flottaazonosító')).toHaveValue('Nem veszik el')
  expect(screen.getByRole('alert')).toHaveTextContent('Időközben módosult')
})

it('keeps a disabled booking calendar compact and never offers management through read permission', async () => {
  vi.mocked(fleetApi.vehicle).mockResolvedValue({ ...record, vehicle: { ...record.vehicle, permissions: ['vehicles.read', 'vehicles.bookings.read'] } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ enabled: false, today: '2026-11-23', items: [] }))))
  mount(<VehicleTaskPanel user={user} tenant={tenant} id="car" section="bookings" />)
  await screen.findByText('A jármű foglalása ki van kapcsolva.')
  expect(screen.queryByLabelText('Napok')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Következő hónap' })).not.toBeInTheDocument()
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
})

it('preserves access to earlier bookings while booking is disabled without showing an empty calendar', async () => {
  vi.mocked(fleetApi.vehicle).mockResolvedValue({ ...record, vehicle: { ...record.vehicle, permissions: ['vehicles.read', 'vehicles.bookings.read'] } })
  const fetch = vi.fn(async () => new Response(JSON.stringify({ enabled: false, today: '2026-11-23', items: [] })))
  vi.stubGlobal('fetch', fetch)
  mount(<VehicleTaskPanel user={user} tenant={tenant} id="car" section="bookings" />)
  await screen.findByText('A jármű foglalása ki van kapcsolva.')
  await userEvent.click(screen.getByText('Korábbi foglalások hónapja'))
  await userEvent.click(await screen.findByRole('button', { name: 'Előző hónap' }))
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
  expect(screen.queryByLabelText('Napok')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Foglalás', hidden: true })).not.toBeInTheDocument()
})

it('keeps history sources isolated and never requests audit data without its vehicle permission', async () => {
  vi.spyOn(fleetApi, 'odometer').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
  const regs = vi.spyOn(fleetApi, 'registrations').mockResolvedValue({ items: [{ id: 'old', registration: 'OLD-123', countryCode: 'HU', recordedAt: '2026-10-22T12:00:00Z', recordedBy: 'admin' }], total: 1, page: 1, pageSize: 25 })
  const audit = vi.spyOn(fleetApi, 'audit')
  mount(<VehiclePage user={user} tenant={tenant} id="car" onBack={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Előzmények' }))
  await chooseOption(screen.getByRole('combobox', { name: 'Előzmény típusa' }), 'registrations')
  await screen.findByText('OLD-123 · HU')
  expect(regs).toHaveBeenCalledWith('own-company', 'car', 1, expect.any(AbortSignal))
  expect(audit).not.toHaveBeenCalled()
  expect(screen.queryByText('Módosítási napló')).not.toBeInTheDocument()
  await waitFor(() => expect(screen.getByText(/Rögzítette: admin/)).toBeVisible())
})
