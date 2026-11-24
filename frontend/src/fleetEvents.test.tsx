import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as api from './api'
import FleetEvents from './FleetEvents'
import { chooseOption } from './selectTestUtils'

const tenant = { id: 'fleet', name: 'Minta', permissions: ['vehicles.read', 'vehicles.events.read', 'vehicles.events.manage'] }
const endpoint = '/api/v1/vehicles/events'
const today = '2090-01-31'
const event = { id: 'schedule', title: 'Kötelező havi elszámolás', vehicleId: null, registration: null,
  startsOn: today, repeat: 'Month', every: 1, endsOn: null, notes: null, version: 1, stoppedOn: null, canManage: true, occurrences: [today] }

function mount(permissions = tenant.permissions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={client}><FleetEvents tenant={{ ...tenant, permissions }} onClose={vi.fn()} /></QueryClientProvider>)
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => vi.restoreAllMocks())

it('saves one recurring fleet event and shows the projected date when the saved month opens', async () => {
  let saved = false
  const request = vi.spyOn(api, 'request').mockImplementation(async (url, options) => {
    if (url.startsWith(`${endpoint}/targets`)) return { canScheduleForFleet: true, vehicles: [{ id: 'car', registration: 'AELC-933' }], hasMore: false }
    if (options?.method === 'POST') { saved = true; return event }
    return { items: saved ? [event] : [], total: saved ? 1 : 0, page: 1, pageSize: 25 }
  })
  mount()
  await userEvent.click(screen.getByRole('button', { name: 'Új esemény' }))
  await screen.findByRole('combobox', { name: 'Érintett jármű' })
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Érintett jármű' })).toBeEnabled())
  await chooseOption(screen.getByRole('combobox', { name: 'Érintett jármű' }), 'all')
  fireEvent.change(screen.getByLabelText('Esemény neve'), { target: { value: event.title } })
  fireEvent.change(screen.getByLabelText('Első időpont'), { target: { value: today } })
  await chooseOption(screen.getByRole('combobox', { name: 'Ismétlődés' }), 'Month')
  await userEvent.click(screen.getByRole('button', { name: 'Esemény mentése' }))
  await waitFor(() => expect(request).toHaveBeenCalledWith(endpoint, {
    tenantId: tenant.id, method: 'POST', body: { vehicleId: null, title: event.title, startsOn: today, repeat: 'Month', every: 1, endsOn: null, notes: null, version: 0 },
  }))
  await screen.findByRole('heading', { name: event.title })
  expect(screen.getByLabelText('Események hónapja')).toHaveValue('2090-01')
  expect(screen.getByText('Minden jármű · Havonta')).toBeInTheDocument()
})

it('shows occurrences while hiding editing actions for read-only viewers', async () => {
  vi.spyOn(api, 'request').mockResolvedValue({ items: [{ ...event, canManage: false }], total: 1, page: 1, pageSize: 25 })
  mount(['vehicles.read', 'vehicles.events.read'])
  await screen.findByRole('heading', { name: event.title })
  expect(screen.queryByRole('button', { name: 'Új esemény' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Szerkesztés' })).not.toBeInTheDocument()
})
