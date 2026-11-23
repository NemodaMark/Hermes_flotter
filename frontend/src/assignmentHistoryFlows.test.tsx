import { chooseOption } from './selectTestUtils'
import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { VehicleAssignmentHistory } from './VehicleAssignmentHistory'
import { VehiclePage } from './VehiclePage'
import { mediaApi } from './peopleApi'
import type { AssignmentHistory } from './peopleApi'
import { fleetApi } from './fleetApi'
import type { VehicleRecord } from './fleetApi'

const previous: AssignmentHistory = { id: 'old', userId: 'bela', displayName: 'Kiss Béla', assignedAt: '2026-10-01T08:00:00Z', releasedAt: '2026-10-10T10:15:00Z', assignedBy: 'anna', assignedByDisplayName: 'Nagy Anna', releasedBy: 'geza', releasedByDisplayName: 'Kovács Géza' }
const current: AssignmentHistory = { id: 'current', userId: 'eva', displayName: 'Tóth Éva', assignedAt: previous.releasedAt!, releasedAt: null, assignedBy: 'geza', assignedByDisplayName: 'Kovács Géza', releasedBy: null, releasedByDisplayName: null }
const page = (items: AssignmentHistory[], total = items.length, number = 1) => ({ items, total, page: number, pageSize: 25 })
function mount(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{node}</QueryClientProvider>)
}
beforeEach(() => { vi.restoreAllMocks() })

it('shows previous and current periods with distinct assignment and release actors', async () => {
  vi.spyOn(mediaApi, 'assigneeHistory').mockResolvedValue(page([current, previous]))
  mount(<VehicleAssignmentHistory tenantId="company" id="car" />)
  const table = await screen.findByRole('table')
  const oldRow = within(table).getByText('Kiss Béla').closest('tr')!
  expect(within(oldRow).getByText('@bela')).toBeInTheDocument()
  expect(within(oldRow).getByText('Nagy Anna')).toBeInTheDocument()
  expect(within(oldRow).getByText('Kovács Géza')).toBeInTheDocument()
  expect(Array.from(oldRow.querySelectorAll('time')).map(el => el.dateTime)).toEqual([previous.assignedAt, previous.releasedAt])
  const currentRow = within(table).getByText('Tóth Éva').closest('tr')!
  expect(within(currentRow).getByText('Jelenleg is')).toBeInTheDocument()
  expect(within(currentRow).getByText('—')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /törlés|szerkesztés/i })).not.toBeInTheDocument()
})

it('loads the next page using the current company and vehicle and supports paging back', async () => {
  const history = vi.spyOn(mediaApi, 'assigneeHistory').mockImplementation(async (_, __, number) => page(number === 1 ? [current] : [previous], 26, number))
  mount(<VehicleAssignmentHistory tenantId="company" id="car" />)
  await screen.findByText('Tóth Éva')
  expect(screen.getByRole('button', { name: 'Előző oldal' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Következő oldal' }))
  await screen.findByText('Kiss Béla')
  expect(history).toHaveBeenLastCalledWith('company', 'car', 2, expect.any(AbortSignal))
  expect(screen.getByRole('button', { name: 'Következő oldal' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Előző oldal' }))
  await screen.findByText('Tóth Éva')
})

it('preserves the server access error and retries before showing an empty history', async () => {
  const history = vi.spyOn(mediaApi, 'assigneeHistory').mockRejectedValueOnce(new Error('A jármű nem érhető el.')).mockResolvedValueOnce(page([]))
  mount(<VehicleAssignmentHistory tenantId="company" id="car" />)
  expect(await screen.findByRole('alert')).toHaveTextContent('A jármű nem érhető el.')
  expect(screen.queryByText(/még nem történt/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Újrapróbálom' }))
  expect(await screen.findByText('Ehhez a járműhöz még nem történt felhasználói hozzárendelés.')).toBeInTheDocument()
  expect(history).toHaveBeenCalledTimes(2)
})

it('refreshes the history after assigning a different user on the actual vehicle page', async () => {
  let changed = false
  const car = { id: 'car', registration: 'ABC-123', make: 'Ford', model: 'Transit', status: 'Active', version: 1, permissions: ['vehicles.read', 'vehicles.users.assign'] }
  const record: VehicleRecord = { vehicle: car,
    data: { registrationCountry: 'HU', vin: null, fleetNumber: null, category: 'Van', bodyType: 'Van', year: null, firstRegistration: null, color: null, fuelType: 'Diesel', powerKw: null, engineCapacityCc: null, transmission: 'Manual', seats: null, grossWeightKg: null, payloadKg: null, cargoVolumeM3: null, batteryKwh: null, ownership: 'Owned', fleetEntryDate: null, fleetExitDate: null, inspectionDueDate: null, insuranceDueDate: null, nextServiceDate: null, nextServiceKm: null, preferredServicePartnerId: null, notes: null },
    preferredServicePartnerName: null, statusReason: null, updatedAt: null, updatedBy: null }
  vi.spyOn(fleetApi, 'vehicle').mockImplementation(async () => ({ ...record, vehicle: { ...car, version: changed ? 2 : 1 } }))
  vi.spyOn(mediaApi, 'photos').mockResolvedValue({ items: [], vehicleVersion: 1 })
  vi.spyOn(mediaApi, 'assignee').mockImplementation(async () => ({ current: { userId: changed ? 'eva' : 'bela', displayName: changed ? 'Tóth Éva' : 'Kiss Béla', assignedAt: previous.assignedAt } }))
  vi.spyOn(mediaApi, 'assigneeOptions').mockResolvedValue(['bela', 'eva'].map(id => ({ id, displayName: id === 'eva' ? 'Tóth Éva' : 'Kiss Béla', email: `${id}@example.test`, phoneNumber: null, avatarRevision: null })))
  const history = vi.spyOn(mediaApi, 'assigneeHistory').mockImplementation(async () => page(changed ? [current, previous] : [{ ...previous, releasedAt: null, releasedBy: null }]))
  const assign = vi.spyOn(mediaApi, 'assign').mockImplementation(async () => { changed = true; return {} })
  mount(<VehiclePage user={{ id: 'manager', displayName: 'Kezelő', email: 'manager@example.test' }} tenant={{ id: 'company', name: 'Flotta', permissions: car.permissions }} id="car" initialTab="assignees" onBack={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Előzmények' }))
  await within(await screen.findByRole('table')).findByText('Kiss Béla')
  await userEvent.click(screen.getByRole('button', { name: 'Használat' }))
  await waitFor(() => expect(mediaApi.assigneeOptions).toHaveBeenCalled())
  await chooseOption(screen.getByRole('combobox', { name: 'Jármű használója' }), 'eva')
  await userEvent.click(screen.getByRole('button', { name: 'Hozzárendelés mentése' }))
  await waitFor(() => expect(assign).toHaveBeenCalledWith('company', 'car', 'eva', 1))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hozzárendelés mentése' })).toBeDisabled())
  await userEvent.click(screen.getByRole('button', { name: 'Előzmények' }))
  await within(await screen.findByRole('table')).findByText('Tóth Éva')
  expect(history).toHaveBeenCalledTimes(2)
  expect(screen.getByText('Kiss Béla')).toBeInTheDocument()
})
