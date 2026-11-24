import { chooseOption } from './selectTestUtils'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { PartnerForm, PartnersPage } from './PartnersPage'
import { VehicleDataForm, VehiclePage } from './VehiclePage'
import { LeaseDialog, ServiceDialog, VehicleContracts } from './VehicleContracts'
import { documentApi } from './documentApi'
import { fleetApi, moneyText } from './fleetApi'
import type { Lease, VehicleRecord } from './fleetApi'
import { api } from './api'

const record: VehicleRecord = {
  vehicle: { id: 'car', registration: 'ABC-123', make: 'Ford', model: 'Transit', status: 'Active', version: 9, odometerKm: 50000, siteId: 'bp', siteName: 'Budapest', permissions: ['vehicles.read'] },
  data: { registrationCountry: 'HU', vin: null, fleetNumber: null, category: 'Van', year: null, firstRegistration: null, color: null, fuelType: 'Diesel',
    powerKw: null, engineCapacityCc: null, transmission: 'Manual', seats: null, grossWeightKg: null, payloadKg: null, cargoVolumeM3: null, batteryKwh: null,
    ownership: 'Owned', fleetEntryDate: null, fleetExitDate: null, inspectionDueDate: null, insuranceDueDate: null, nextServiceDate: null, nextServiceKm: null, preferredServicePartnerId: null, notes: null },
  preferredServicePartnerName: null, statusReason: null, updatedAt: null, updatedBy: null,
}
const user = { id: 'operator', displayName: 'Kezelő', email: 'operator@example.test' }
function mount(node: ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{node}</QueryClientProvider>)
}
beforeEach(() => {
  vi.restoreAllMocks()
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
it('keeps the saved cents visible in leasing and service amounts', () => {
  expect(moneyText(250000.50, 'HUF')).toContain(',50')
  expect(moneyText(47000.25, 'EUR')).toContain(',25')
})
it('uses the actual vehicle permissions for financial tabs, editing and archival', async () => {
  vi.spyOn(fleetApi, 'vehicle').mockResolvedValue(record)
  const options = vi.spyOn(fleetApi, 'partnerOptions')
  mount(<VehiclePage user={user} tenant={{ id: 'company', name: 'Cég', permissions: ['vehicles.read', 'vehicles.update', 'vehicles.odometer.create', 'vehicles.archive', 'vehicles.leasing.read', 'vehicles.service.manage', 'vehicles.documents.read', 'vehicles.documents.manage'] }} id="car" onBack={vi.fn()} />)
  expect(await screen.findByRole('heading', { name: 'ABC-123' })).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Szerkesztés' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Lízing' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Szerviz' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Dokumentumok' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Archiválás' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Járműadatok mentése' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Kilométerállás: ABC-123' })).not.toBeInTheDocument()
  expect(options).not.toHaveBeenCalled()
})
it('records the current odometer from the vehicle profile with its actual permission and version', async () => {
  const car = { ...record.vehicle, permissions: ['vehicles.read', 'vehicles.odometer.create'] }
  vi.spyOn(fleetApi, 'vehicle').mockResolvedValue({ ...record, vehicle: car })
  const save = vi.spyOn(api, 'recordOdometer').mockResolvedValue({ ...car, odometerKm: 51000, version: 10 })
  mount(<VehiclePage user={user} tenant={{ id: 'company', name: 'Cég', permissions: ['vehicles.read', 'vehicles.odometer.create'] }} id="car" onBack={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Kilométerállás: ABC-123' }))
  fireEvent.change(screen.getByLabelText('Kilométerállás (km)'), { target: { value: '51000' } })
  await userEvent.click(screen.getByRole('button', { name: 'Mentés' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('company', car, 51000, null))
})
it('searches partners while typing, resets the page atomically and uses a switch for archived records', async () => {
  const list = vi.spyOn(fleetApi, 'partners').mockResolvedValue({ items: [], total: 60, page: 1, pageSize: 25 })
  mount(<PartnersPage tenant={{ id: 'company', name: 'Cég', permissions: ['partners.read'] }} />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Következő oldal' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Következő oldal' }))
  await waitFor(() => expect(list).toHaveBeenLastCalledWith('company', 2, '', 'all', false, expect.any(AbortSignal)))
  const search = screen.getByRole('textbox', { name: 'Partner keresése' })
  fireEvent.change(search, { target: { value: 'D' } })
  fireEvent.change(search, { target: { value: 'Du' } })
  fireEvent.change(search, { target: { value: 'Duna' } })
  expect(screen.queryByRole('button', { name: 'Keresés' })).not.toBeInTheDocument()
  await waitFor(() => expect(list).toHaveBeenLastCalledWith('company', 1, 'Duna', 'all', false, expect.any(AbortSignal)))
  expect(list.mock.calls.some(([, page, query]) => query && page !== 1)).toBe(false)
  expect(list.mock.calls.some(([, , query]) => query === 'D' || query === 'Du')).toBe(false)
  await userEvent.click(screen.getByRole('switch', { name: 'Archiváltak is' }))
  await waitFor(() => expect(list).toHaveBeenLastCalledWith('company', 1, 'Duna', 'all', true, expect.any(AbortSignal)))
})
it('shows the vehicle document tab with the actual document permission without granting upload', async () => {
  vi.spyOn(fleetApi, 'vehicle').mockResolvedValue({ ...record, vehicle: { ...record.vehicle, permissions: ['vehicles.read', 'vehicles.documents.read'] } })
  const list = vi.spyOn(documentApi, 'list').mockResolvedValue({ items: [], parentVersion: 9, vehicleVersion: 9, totalBytes: 0 })
  mount(<VehiclePage user={user} tenant={{ id: 'company', name: 'Cég', permissions: ['vehicles.read', 'vehicles.documents.read', 'vehicles.documents.manage'] }} id="car" onBack={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Szerviz és iratok' }))
  await userEvent.click(screen.getByText('Járműokmányok', { exact: true }))
  await screen.findByText('Még nincs megjeleníthető dokumentum.')
  expect(list).toHaveBeenCalledWith('company', 'car', 'vehicle', 'car', expect.any(AbortSignal))
  expect(screen.queryByLabelText('Fájl kiválasztása')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Feltöltés' })).not.toBeInTheDocument()
})
it('saves the detailed vehicle data with the existing immutable vehicle key and version', async () => {
  vi.spyOn(fleetApi, 'partnerOptions').mockResolvedValue([{ id: 'garage', name: 'Műhely' }])
  const save = vi.spyOn(fleetApi, 'saveVehicle').mockResolvedValue(record)
  const onSaved = vi.fn(async () => {})
  mount(<VehicleDataForm tenantId="company" record={record} editable onSaved={onSaved} />)
  fireEvent.change(screen.getByLabelText('Rendszám', { exact: true }), { target: { value: 'NEW-456' } })
  await userEvent.click(screen.getByRole('tab', { name: 'Műszaki adatok' }))
  fireEvent.change(screen.getByLabelText('Teljesítmény (kW)'), { target: { value: '110.5' } })
  await userEvent.click(screen.getByRole('tab', { name: 'Üzemeltetés' }))
  await chooseOption(screen.getByLabelText('Tulajdonlás'), 'Leased')
  await userEvent.click(screen.getByRole('tab', { name: 'Határidők és szerviz' }))
  await chooseOption(await screen.findByLabelText('Alapértelmezett szervizpartner'), 'garage')
  await userEvent.click(screen.getByRole('button', { name: 'Járműadatok mentése' }))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(save).toHaveBeenCalledWith('company', 'car', expect.objectContaining({ registration: 'NEW-456', version: 9, data: expect.objectContaining({ ownership: 'Leased', powerKw: 110.5, preferredServicePartnerId: 'garage' }) }))
})
it('sets and locks inactive status when choosing sold ownership', async () => {
  vi.spyOn(fleetApi, 'partnerOptions').mockResolvedValue([])
  const save = vi.spyOn(fleetApi, 'saveVehicle').mockResolvedValue(record)
  mount(<VehicleDataForm tenantId="company" record={record} editable onSaved={async () => {}} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Üzemeltetés' }))
  await userEvent.click(screen.getByRole('combobox', { name: 'Tulajdonlás' }))
  await userEvent.click(screen.getByRole('option', { name: 'Eladva' }))
  const state = screen.getByRole('combobox', { name: 'Állapot' })
  expect(state).toHaveValue('Inaktív')
  expect(state).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Járműadatok mentése' }))
  expect(save).toHaveBeenCalledWith('company', 'car', expect.objectContaining({
    status: 'Inactive', version: 9, data: expect.objectContaining({ ownership: 'Sold' }),
  }))
})
it('creates a partner with multiple categories and a named contact', async () => {
  const save = vi.spyOn(fleetApi, 'savePartner').mockResolvedValue({} as never)
  mount(<PartnerForm tenantId="company" editable onSaved={async () => {}} />)
  await userEvent.type(screen.getByLabelText('Partner neve'), 'Duna Finanszírozás és Szerviz')
  await userEvent.click(screen.getByLabelText('Lízingbeadó / finanszírozó'))
  await userEvent.click(screen.getByRole('tab', { name: 'Cím' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Település' }), 'Budapest')
  await userEvent.click(screen.getByRole('tab', { name: 'Kapcsolattartók' }))
  await userEvent.click(screen.getByRole('button', { name: 'Kapcsolattartó hozzáadása' }))
  await userEvent.type(screen.getByLabelText('Név', { exact: true }), 'Kiss Éva')
  await userEvent.click(screen.getByRole('tab', { name: 'Alapadatok' }))
  expect(screen.getByRole('textbox', { name: 'Partner neve' })).toHaveValue('Duna Finanszírozás és Szerviz')
  await userEvent.click(screen.getByRole('tab', { name: 'Cím' }))
  expect(screen.getByRole('textbox', { name: 'Település' })).toHaveValue('Budapest')
  await userEvent.click(screen.getByRole('button', { name: 'Partner mentése' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('company', null, expect.objectContaining({ isLessor: true, isService: true, address: expect.objectContaining({ city: 'Budapest' }), contacts: [expect.objectContaining({ name: 'Kiss Éva' })] })))
})
it('reveals an invalid partner field in another section before allowing submission', async () => {
  const save = vi.spyOn(fleetApi, 'savePartner')
  vi.spyOn(HTMLInputElement.prototype, 'reportValidity').mockReturnValue(false)
  mount(<PartnerForm tenantId="company" editable onSaved={async () => {}} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Cím' }))
  await userEvent.click(screen.getByRole('button', { name: 'Partner mentése' }))
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Partner neve' })).toHaveFocus())
  expect(screen.getByRole('tab', { name: 'Alapadatok' })).toHaveAttribute('aria-selected', 'true')
  expect(save).not.toHaveBeenCalled()
})
it('allows partner creation without reading the partner directory', () => {
  const list = vi.spyOn(fleetApi, 'partners')
  mount(<PartnersPage tenant={{ id: 'company', name: 'Cég', permissions: ['partners.create'] }} />)
  expect(screen.getByRole('button', { name: 'Új partner' })).toBeInTheDocument()
  expect(screen.getByText('Nincs jogosultságod a partnerlista megtekintéséhez.')).toBeInTheDocument()
  expect(list).not.toHaveBeenCalled()
})
it('keeps a stale lease draft open and shows the server conflict instead of closing it', async () => {
  const item: Lease = { id: 'lease', partnerName: 'Lízingcég', createdAt: null, createdBy: null, updatedAt: null, updatedBy: null,
    data: { partnerId: 'lessor', contractNumber: 'LEASE-01', startDate: '2026-01-01', endDate: '2028-12-31', paymentAmount: 250000, currency: 'HUF', billingFrequency: 'Monthly', annualKmLimit: null, totalKmLimit: null, status: 'Active', documentUrl: null, notes: null, version: 7 } }
  vi.spyOn(fleetApi, 'partnerOptions').mockResolvedValue([{ id: 'lessor', name: 'Lízingcég' }])
  const save = vi.spyOn(fleetApi, 'saveLease').mockRejectedValue(new Error('A szerződés időközben megváltozott.'))
  const close = vi.fn()
  mount(<LeaseDialog tenantId="company" car={record.vehicle} item={item} onClose={close} onSaved={async () => {}} />)
  fireEvent.change(screen.getByLabelText('Lízingdíj'), { target: { value: '250500.25' } })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mentés' })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: 'Mentés' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('A szerződés időközben megváltozott.')
  expect(close).not.toHaveBeenCalled()
  expect(screen.getByLabelText('Lízingdíj')).toHaveValue(250500.25)
  expect(save).toHaveBeenCalledWith('company', 'car', 'lease', expect.objectContaining({ paymentAmount: 250500.25, version: 7 }))
})
it('records a historical service reading independently from the current odometer', async () => {
  vi.spyOn(fleetApi, 'partnerOptions').mockResolvedValue([{ id: 'garage', name: 'Műhely' }])
  const save = vi.spyOn(fleetApi, 'saveService').mockResolvedValue({} as never)
  mount(<ServiceDialog tenantId="company" car={record.vehicle} onClose={vi.fn()} onSaved={async () => {}} />)
  await waitFor(() => expect(fleetApi.partnerOptions).toHaveBeenCalled())
  await chooseOption(screen.getByLabelText('Szervizpartner'), 'garage')
  fireEvent.change(screen.getByLabelText('Szerviz dátuma'), { target: { value: '2025-06-01' } })
  fireEvent.change(screen.getByLabelText('Kilométerállás a szerviznél'), { target: { value: '10000' } })
  await userEvent.type(screen.getByLabelText('Elvégzett munka'), 'Olajcsere')
  await userEvent.click(screen.getByRole('button', { name: 'Mentés' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('company', 'car', null, expect.objectContaining({ partnerId: 'garage', performedOn: '2025-06-01', kilometers: 10000, description: 'Olajcsere' })))
})
it('opens file upload for the actual saved service record immediately after creation', async () => {
  vi.spyOn(fleetApi, 'partnerOptions').mockResolvedValue([{ id: 'garage', name: 'Műhely' }])
  vi.spyOn(fleetApi, 'services').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
  vi.spyOn(fleetApi, 'saveService').mockResolvedValue({ id: 'saved-service', partnerName: 'Műhely', data: { workOrderNumber: 'JOB-1', version: 1 } } as never)
  const documents = vi.spyOn(documentApi, 'list').mockResolvedValue({ items: [], parentVersion: 1, vehicleVersion: 10, totalBytes: 0 })
  mount(<VehicleContracts tenant={{ id: 'company', name: 'Cég', permissions: [] }} car={{ ...record.vehicle, permissions: ['vehicles.service.read', 'vehicles.service.manage'] }} kind="services" onChanged={async () => {}} />)
  await userEvent.click(screen.getByRole('button', { name: 'Új szervizbejegyzés' }))
  await waitFor(() => expect(fleetApi.partnerOptions).toHaveBeenCalled())
  await chooseOption(screen.getByLabelText('Szervizpartner'), 'garage')
  fireEvent.change(screen.getByLabelText('Szerviz dátuma'), { target: { value: '2026-10-01' } })
  await userEvent.type(screen.getByLabelText('Elvégzett munka'), 'Olajcsere')
  await userEvent.click(screen.getByRole('button', { name: 'Mentés' }))
  expect(await screen.findByRole('heading', { name: 'Szervizdokumentumok' })).toBeInTheDocument()
  expect(screen.getByLabelText('Fájl kiválasztása')).toBeInTheDocument()
  await waitFor(() => expect(documents).toHaveBeenCalledWith('company', 'car', 'services', 'saved-service', expect.any(AbortSignal)))
})
