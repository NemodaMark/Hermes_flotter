import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from './api'
import { mediaApi, peopleApi } from './peopleApi'
import { VehicleCreatePage } from './VehicleCreatePage'
import { PeopleList } from './PeopleList'

const user = { id: 'anna', displayName: 'Anna', email: 'anna@example.test', systemPermissions: [] }
const tenant = { id: 'company', name: 'Flotta', permissions: ['vehicles.create'] }
const car = { id: 'car', registration: 'NEW-123', make: 'Új gyártó', model: 'Új modell', status: 'Active', version: 1 }
function mount(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}
beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]')))
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
  vi.spyOn(api, 'vehicleCreationOptions').mockResolvedValue({ canCreateUnassigned: true, sites: [], servicePartners: [] })
})
async function fill() {
  fireEvent.change(await screen.findByLabelText('Rendszám'), { target: { value: car.registration } })
  fireEvent.change(screen.getByLabelText('Gyártó'), { target: { value: car.make } })
  fireEvent.change(screen.getByLabelText('Modell'), { target: { value: car.model } })
  await userEvent.selectOptions(screen.getByLabelText('Karosszéria'), 'Estate')
}

it('creates with the complete editable fields and no mandatory photograph', async () => {
  const created = vi.spyOn(api, 'createVehicle').mockResolvedValue(car)
  const upload = vi.spyOn(mediaApi, 'upload')
  const done = vi.fn()
  mount(<VehicleCreatePage user={user} tenant={tenant} onBack={vi.fn()} onCreated={done} />)
  await fill()
  expect(screen.getByLabelText('Alvázszám (VIN)')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('tab', { name: 'Határidők és szerviz' }))
  expect(screen.getByLabelText('Következő szerviz dátuma')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Jármű létrehozása' }))
  await waitFor(() => expect(done).toHaveBeenCalledOnce())
  expect(created).toHaveBeenCalledWith(tenant.id, expect.objectContaining({ make: car.make, model: car.model, data: expect.objectContaining({ bodyType: 'Estate' }) }))
  expect(upload).not.toHaveBeenCalled()
})

it('limits selection to five photos and retries only remaining uploads without duplicating the car', async () => {
  const created = vi.spyOn(api, 'createVehicle').mockResolvedValue(car)
  const first = { items: [], vehicleVersion: 2 }
  const upload = vi.spyOn(mediaApi, 'upload').mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('Megszakadt feltöltés')).mockResolvedValueOnce({ items: [], vehicleVersion: 3 })
  const done = vi.fn()
  mount(<VehicleCreatePage user={user} tenant={tenant} onBack={vi.fn()} onCreated={done} />)
  await fill()
  const files = Array.from({ length: 6 }, (_, i) => new File(['pixels'], `${i}.png`, { type: 'image/png' }))
  const input = screen.getByLabelText('Járműképek kiválasztása')
  await userEvent.upload(input, files)
  expect(await screen.findByRole('alert')).toHaveTextContent('Legfeljebb öt képet')
  await userEvent.upload(input, files.slice(0, 2))
  await userEvent.click(screen.getByRole('button', { name: 'Jármű létrehozása' }))
  expect(await screen.findByText('Megszakadt feltöltés')).toBeInTheDocument()
  expect(created).toHaveBeenCalledOnce()
  expect(done).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: 'Képfeltöltés újrapróbálása' }))
  await waitFor(() => expect(done).toHaveBeenCalledWith(expect.objectContaining({ version: 3 })))
  expect(created).toHaveBeenCalledOnce()
  expect(upload.mock.calls.map(call => [call[2].name, call[3]])).toEqual([['0.png', 1], ['1.png', 2], ['1.png', 2]])
})

it('shows the colleague directory without management rights or a global-user toggle', async () => {
  const colleagues = vi.spyOn(peopleApi, 'colleagues').mockResolvedValue({ items: [{ id: 'bela', displayName: 'Béla', email: 'bela@example.test', phoneNumber: null, avatarRevision: null }], total: 1, page: 1, pageSize: 25 })
  const profile = vi.fn()
  mount(<PeopleList user={user} tenant={{ ...tenant, permissions: [] }} onProfile={profile} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Profil megnyitása: bela@example.test' }))
  expect(profile).toHaveBeenCalledWith('bela')
  expect(colleagues).toHaveBeenCalledWith(tenant.id, 1, '', expect.any(AbortSignal))
  expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Jogosultságok:/ })).not.toBeInTheDocument()
})
