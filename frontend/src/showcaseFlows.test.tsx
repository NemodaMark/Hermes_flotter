import { afterEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PeopleList } from './PeopleList'
import { SiteShowcase } from './SiteShowcase'
import { api } from './api'
import type { Site } from './organizationApi'
import { blankAddress } from './organizationApi'
import { parkingLighting } from './parkingEnvironment'
import { vehicleInteractionLayout } from './vehicleInteractionLayout'

afterEach(() => vi.restoreAllMocks())
it('switches to portraits without loading another directory or exposing extra user permissions', async () => {
  const members = vi.spyOn(api, 'members').mockResolvedValue({ total: 1, page: 1, pageSize: 25, items: [{ userId: 'anna', displayName: 'Anna', email: 'anna@example.test', isActive: true, version: 1, permissions: [], joinedAt: null, disabledAt: null }] })
  const onProfile = vi.fn()
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <PeopleList user={{ id: 'anna', email: 'anna@example.test', displayName: 'Anna' }} tenant={{ id: 'own-company', name: 'Duna', permissions: ['members.read'] }} onProfile={onProfile} />
  </QueryClientProvider>)
  await screen.findByRole('row', { name: 'Felhasználó: Anna' })
  await userEvent.click(screen.getByRole('button', { name: 'Portrék' }))
  await userEvent.click(screen.getByRole('button', { name: 'Profil megnyitása: anna@example.test' }))
  expect(onProfile).toHaveBeenCalledWith('anna')
  await waitFor(() => expect(members).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('Összes felhasználó')).not.toBeInTheDocument()
})
const site: Site = { id: 'bp', data: { name: 'Budapest', code: 'BP-01', address: blankAddress(), email: null, phone: null, contactId: null, version: 1 }, isArchived: false, archivedAt: null, statusReason: null, contactName: null, vehicleCount: 3, createdAt: null, createdBy: null, updatedAt: null, updatedBy: null, permissions: [] }
it('keeps operation-specific site permissions in the visual site view', () => {
  render(<SiteShowcase sites={[site]} active permissions={['sites.update', 'sites.archive']} onEdit={vi.fn()} onStatus={vi.fn()} />)
  expect(screen.getByText('3 jármű')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Telephely szerkesztése/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Telephely állapota/ })).not.toBeInTheDocument()
})
it('uses subdued daytime and night presets and changes hotspot placement for high-sided vehicles', () => {
  expect(parkingLighting(12).lamps).toBe(false)
  expect(parkingLighting(22).lamps).toBe(true)
  expect(parkingLighting(6).name).toBe('Hajnal')
  expect(parkingLighting(18).name).toBe('Alkonyat')
  const car = vehicleInteractionLayout({ length: 4.7, width: 1.9, roof: 1.5, frontAxle: 1.4, rearAxle: -1.4 })
  const van = vehicleInteractionLayout({ length: 5.9, width: 2.1, roof: 2.7, frontAxle: 1.7, rearAxle: -1.7 })
  expect(car.data.outward.y).toBe(1)
  expect(van.data.outward.z).toBe(1)
  expect(van.fuel.seed.x).toBeGreaterThan(0)
  expect(car.fuel.seed.x).toBeLessThan(0)
  expect(van.history.seed.y).toBeGreaterThan(1)
})
