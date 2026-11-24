import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as apiModule from './api'
import { mileageApi, mileageMonth, localMileageDate } from './mileageApi'
import type { MileageReport } from './mileageApi'
import { VehicleRecordingActions } from './VehicleActions'
import { VehicleFuelForm } from './VehicleOperations'
import { MileagePanel } from './MileagePanel'
import { chooseOption } from './selectTestUtils'
const user = { id: 'anna', displayName: 'Anna', email: 'anna@example.test' }
const tenant = { id: 'demo', name: 'Demo', permissions: ['mileage.record', 'vehicles.odometer.create', 'vehicles.fuel.manage'] }
const vehicle = { id: 'car', registration: 'DEMO-001', make: 'Ford', model: 'Focus', status: 'Active', version: 3, odometerKm: 1000, permissions: tenant.permissions }
const month = mileageMonth(localMileageDate())
const report: MileageReport = { userId: user.id, month, mode: 'Entries', totalKm: 0, privateKm: 0, monthlyLimitKm: 1000, version: 0, submittedAt: null, updatedBy: null, updatedAt: null, dueMonth: null, entries: [] }
function mount(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.spyOn(mileageApi, 'read').mockResolvedValue(report)
})
afterEach(() => vi.restoreAllMocks())
it('records personal usage with the odometer and stops the car presentation while the form is open', async () => {
  const save = vi.spyOn(apiModule.api, 'recordOdometer').mockResolvedValue({ ...vehicle, odometerKm: 1150 })
  const change = vi.fn()
  mount(<VehicleRecordingActions user={user} tenant={tenant} vehicle={vehicle} onModeChange={change} />)
  await userEvent.click(screen.getByRole('button', { name: 'Kilométerállás: DEMO-001' }))
  await screen.findByLabelText('Elszámolandó megtett út (km)')
  fireEvent.change(screen.getByLabelText('Kilométerállás (km)'), { target: { value: '1150' } })
  fireEvent.change(screen.getByLabelText('Elszámolandó megtett út (km)'), { target: { value: '150' } })
  fireEvent.change(screen.getByLabelText('Ebből magánhasználat (km)'), { target: { value: '40' } })
  await userEvent.click(screen.getByRole('button', { name: /^Mentés$/ }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('demo', vehicle, 1150, { month, totalKm: 150, privateKm: 40 }))
  expect(change).toHaveBeenCalledWith('odometer')
  expect(await screen.findByRole('status')).toHaveTextContent('Kilométerállás elmentve.')
})
it('keeps monthly reporters out of per-refuelling accounting and makes the monthly editor reachable', async () => {
  vi.mocked(mileageApi.read).mockResolvedValue({ ...report, mode: 'Monthly' })
  mount(<VehicleRecordingActions user={user} tenant={tenant} vehicle={vehicle} />)
  await userEvent.click(screen.getByRole('button', { name: 'Kilométerállás: DEMO-001' }))
  expect(await screen.findByText(/Havi összesítőt választottál/)).toBeInTheDocument()
  expect(screen.queryByLabelText('Elszámolandó megtett út (km)')).not.toBeInTheDocument()
  await userEvent.click(screen.getAllByRole('button', { name: /^Havi elszámolás$/ })[0])
  expect(await screen.findByLabelText('Teljes havi kilométer')).toBeInTheDocument()
})
it('submits a monthly total independently of historical entries and requires an explicit month close', async () => {
  vi.mocked(mileageApi.read).mockResolvedValue({ ...report, mode: 'Monthly', totalKm: 600, privateKm: 100, version: 4 })
  const save = vi.spyOn(mileageApi, 'save').mockResolvedValue({ ...report, mode: 'Monthly', totalKm: 800, privateKm: 120, version: 5, submittedAt: new Date().toISOString() })
  mount(<MileagePanel tenant={tenant} user={user} />)
  fireEvent.change(await screen.findByLabelText('Teljes havi kilométer'), { target: { value: '800' } })
  fireEvent.change(screen.getByLabelText('Ebből magánhasználat (km)'), { target: { value: '120' } })
  await userEvent.click(screen.getByRole('button', { name: 'Hónap lezárása' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('demo', expect.objectContaining({ version: 4 }), { totalKm: 800, privateKm: 120, submit: true, confirmNoUsage: false, reason: '' }))
})
it('shows the server-calculated distance and sends only the entered private kilometers with it', async () => {
  const request = vi.spyOn(apiModule, 'request').mockResolvedValue({ id: 'fuel', fueledOn: localMileageDate() })
  vi.spyOn(mileageApi, 'fuelPreview').mockImplementation(async (_tenant, _car, _date, kilometers) => ({ totalKm: Number(kilometers) - 1000 }))
  mount(<VehicleFuelForm tenant={tenant} car={vehicle} userId={user.id} onSaved={vi.fn()} />)
  for (const label of ['Bizonylatszám', 'Összeg', 'Pénznem']) expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('Kilométerállás'), { target: { value: '1200' } })
  fireEvent.change(screen.getByLabelText('Liter'), { target: { value: '35.5' } })
  expect(await screen.findByText('200 km')).toHaveProperty('tagName', 'OUTPUT')
  fireEvent.change(screen.getByLabelText('Ebből magánhasználat (km)'), { target: { value: '50' } })
  await userEvent.click(screen.getByLabelText('Teletankoltam'))
  await userEvent.click(screen.getByRole('button', { name: 'Tankolás mentése' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith('/api/v1/vehicles/car/fuel', { tenantId: tenant.id, body: {
    fueledOn: localMileageDate(), liters: 35.5, kilometers: 1200, isFullTank: true, automaticMileage: { totalKm: 200, privateKm: 50 },
  } }))
})
it('allows a user to switch modes without introducing separate accounting routes', async () => {
  const mode = vi.spyOn(mileageApi, 'mode').mockResolvedValue({ ...report, mode: 'Monthly', version: 2 })
  mount(<MileagePanel tenant={tenant} user={user} />)
  await screen.findByLabelText('Rögzítés módja')
  await chooseOption(screen.getByLabelText('Rögzítés módja'), 'Monthly')
  await waitFor(() => expect(mode).toHaveBeenCalledWith('demo', report, 'Monthly'))
})

