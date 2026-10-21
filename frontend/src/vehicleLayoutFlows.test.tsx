import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { VehicleDataForm, VehiclePage } from './VehiclePage'
import { fleetApi } from './fleetApi'
import type { VehicleRecord } from './fleetApi'
import { mediaApi } from './peopleApi'

const record: VehicleRecord = {
  vehicle: { id: 'car', registration: 'ABC-123', make: 'Ford', model: 'Transit', status: 'Active', version: 4, odometerKm: 40000, permissions: ['vehicles.read', 'vehicles.update', 'vehicles.users.assign'] },
  data: { registrationCountry: 'HU', vin: null, fleetNumber: null, category: 'Van', bodyType: 'Van', year: 2020, firstRegistration: null, color: null, fuelType: 'Diesel', powerKw: 100, engineCapacityCc: null, transmission: 'Manual', seats: null, grossWeightKg: null, payloadKg: null, cargoVolumeM3: null, batteryKwh: null, ownership: 'Owned', fleetEntryDate: null, fleetExitDate: null, inspectionDueDate: null, insuranceDueDate: null, nextServiceDate: null, nextServiceKm: null, preferredServicePartnerId: null, notes: null },
  preferredServicePartnerName: null, statusReason: null, updatedAt: null, updatedBy: null,
}
const tenant = { id: 'company', name: 'Flotta', permissions: record.vehicle.permissions! }
const user = { id: 'anna', displayName: 'Anna', email: 'anna@example.test' }
function mount(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{node}</QueryClientProvider>)
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')))
  vi.spyOn(fleetApi, 'partnerOptions').mockResolvedValue([])
  vi.spyOn(fleetApi, 'vehicle').mockResolvedValue(record)
  vi.spyOn(mediaApi, 'assignee').mockResolvedValue({ current: null })
})

it('shows one field group, supports arrow navigation and keeps edits across groups', async () => {
  const save = vi.spyOn(fleetApi, 'saveVehicle').mockResolvedValue(record)
  mount(<VehicleDataForm tenantId={tenant.id} record={record} editable onSaved={async () => {}} />)
  expect(screen.getByLabelText('Rendszám', { exact: true })).toBeVisible()
  expect(screen.getByLabelText('Teljesítmény (kW)')).not.toBeVisible()
  await userEvent.type(screen.getByLabelText('Szín'), 'Kék')
  screen.getByRole('tab', { name: 'Alapadatok' }).focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Műszaki adatok' })).toHaveFocus()
  expect(screen.getByRole('tab', { name: 'Műszaki adatok' })).toHaveAttribute('aria-selected', 'true')
  fireEvent.change(screen.getByLabelText('Teljesítmény (kW)'), { target: { value: '125' } })
  await userEvent.click(screen.getByRole('tab', { name: 'Alapadatok' }))
  expect(screen.getByLabelText('Szín')).toHaveValue('Kék')
  await userEvent.click(screen.getByRole('button', { name: 'Járműadatok mentése' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('company', 'car', expect.objectContaining({ version: 4, data: expect.objectContaining({ color: 'Kék', powerKw: 125, fuelType: 'Diesel' }) })))
})

it('reveals and focuses an invalid hidden field without submitting the draft', async () => {
  const save = vi.spyOn(fleetApi, 'saveVehicle')
  mount(<VehicleDataForm tenantId={tenant.id} record={record} editable onSaved={async () => {}} />)
  fireEvent.change(screen.getByLabelText('Gyártási év'), { target: { value: '9999' } })
  await userEvent.click(screen.getByRole('tab', { name: 'Műszaki adatok' }))
  await userEvent.click(screen.getByRole('button', { name: 'Járműadatok mentése' }))
  expect(screen.getByRole('tab', { name: 'Alapadatok' })).toHaveAttribute('aria-selected', 'true')
  await waitFor(() => expect(screen.getByLabelText('Gyártási év')).toHaveFocus())
  expect(save).not.toHaveBeenCalled()
  // Validation must not trap the user in the revealed group.
  screen.getByRole('tab', { name: 'Alapadatok' }).focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(screen.getByRole('tab', { name: 'Műszaki adatok' })).toHaveAttribute('aria-selected', 'true')
})

it('discards edits in every group and disables an unchanged save', async () => {
  const save = vi.spyOn(fleetApi, 'saveVehicle').mockRejectedValue(new Error('A mentés nem sikerült.'))
  mount(<VehicleDataForm tenantId={tenant.id} record={record} editable onSaved={async () => {}} />)
  expect(screen.getByRole('button', { name: 'Járműadatok mentése' })).toBeDisabled()
  await userEvent.type(screen.getByLabelText('Szín'), 'Piros')
  await userEvent.selectOptions(screen.getByLabelText('Mezőcsoport'), 'technical')
  fireEvent.change(screen.getByLabelText('Teljesítmény (kW)'), { target: { value: '150' } })
  await userEvent.click(screen.getByRole('button', { name: 'Járműadatok mentése' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('A mentés nem sikerült.')
  await userEvent.click(screen.getByRole('button', { name: 'Módosítások elvetése' }))
  expect(screen.getByLabelText('Teljesítmény (kW)')).toHaveValue(100)
  expect(screen.getByLabelText('Szín')).toHaveValue('')
  expect(screen.queryByText('Nem mentett módosítások')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Járműadatok mentése' })).toBeDisabled()
  expect(save).toHaveBeenCalledOnce()
})

it('focuses the first required field when several hidden required values are missing', async () => {
  const save = vi.spyOn(fleetApi, 'saveVehicle')
  mount(<VehicleDataForm tenantId={tenant.id} record={{ ...record, vehicle: { ...record.vehicle, registration: '', make: '', model: '' } }} editable onSaved={async () => {}} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Műszaki adatok' }))
  fireEvent.change(screen.getByLabelText('Teljesítmény (kW)'), { target: { value: '101' } })
  await userEvent.click(screen.getByRole('button', { name: 'Járműadatok mentése' }))
  await waitFor(() => expect(screen.getByLabelText('Rendszám', { exact: true })).toHaveFocus())
  expect(save).not.toHaveBeenCalled()
})

it('loads photos and assignment options only in their own views and preserves the data draft', async () => {
  const photos = vi.spyOn(mediaApi, 'photos').mockResolvedValue({ items: [], vehicleVersion: 4 })
  const options = vi.spyOn(mediaApi, 'assigneeOptions').mockResolvedValue([])
  mount(<VehiclePage user={user} tenant={tenant} id="car" onBack={vi.fn()} />)
  await screen.findByRole('heading', { name: 'ABC-123' })
  await userEvent.type(screen.getByLabelText('Szín'), 'Fehér')
  expect(photos).not.toHaveBeenCalled()
  expect(options).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Képek' }))
  await screen.findByText('Még nincs feltöltött járműkép.')
  expect(photos).toHaveBeenCalledWith('company', 'car', expect.any(AbortSignal))
  await userEvent.click(screen.getByRole('button', { name: 'Telephely és használó' }))
  await waitFor(() => expect(options).toHaveBeenCalledWith('company', 'car', expect.any(AbortSignal)))
  await userEvent.click(screen.getByRole('button', { name: 'Adatlap' }))
  expect(screen.getByLabelText('Szín')).toHaveValue('Fehér')
  expect(screen.getByText('Nem mentett módosítások')).toBeVisible()
})
