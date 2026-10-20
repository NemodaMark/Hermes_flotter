import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CompaniesPage } from './CompaniesPage'
import { resetCsrfToken } from './api'
import { blankAddress } from './organizationApi'
import type { CompanyDetails, CompanyRow, Contact, Site, SiteVehicle } from './organizationApi'

const permissions = [
  'companies.read',
  'companies.update',
  'companies.status',
  'sites.read',
  'sites.create',
  'sites.update',
  'sites.archive',
  'sites.vehicles.assign',
  'vehicles.read',
  'audit.read',
]
const user = { id: 'operator', displayName: 'Kezelő', email: 'operator@example.test' }
const metadata = {
  createdAt: '2026-10-20T10:00:00Z',
  createdBy: 'operator',
  updatedAt: null,
  updatedBy: null,
}
const archive = { isArchived: false, statusReason: null, archivedAt: null }
const profile: CompanyDetails = {
  ...metadata,
  id: 'duna',
  status: 'Active',
  statusReason: null,
  statusChangedAt: null,
  data: {
    name: 'Duna',
    legalName: 'Duna Kft.',
    taxNumber: '12345678-2-42',
    registrationNumber: '',
    euVatNumber: 'HU12345678',
    address: blankAddress(),
    email: '',
    phone: '',
    website: '',
    timeZone: 'Europe/Budapest',
    currency: 'HUF',
    distanceUnit: 'km',
    version: 1,
  },
}
const initialSite: Site = {
  ...metadata,
  ...archive,
  id: 'bp',
  data: {
    name: 'Budapest',
    code: 'BP-01',
    address: blankAddress(),
    email: null,
    phone: null,
    contactId: null,
    version: 4,
  },
  contactName: null,
  vehicleCount: 0,
}
const initialContact: Contact = {
  ...metadata,
  ...archive,
  id: 'contact',
  data: {
    name: 'Kiss Eszter',
    position: 'Ügyintéző',
    email: 'eszter@example.test',
    phone: null,
    version: 3,
  },
}
const initialVehicle: SiteVehicle = {
  id: 'car',
  registration: 'DUN-001',
  make: 'Ford',
  model: 'Focus',
  siteId: null,
  siteName: null,
  version: 8,
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
beforeEach(() => {
  resetCsrfToken()
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
function mount(allowed = permissions) {
  const state = {
    profile: structuredClone(profile),
    sites: [structuredClone(initialSite)],
    contacts: [structuredClone(initialContact)],
    vehicles: [structuredClone(initialVehicle)],
    stale: false,
  }
  const calls: {
    path: string
    method: string
    body: any
    tenant: string | null
    csrf: string | null
  }[] = []
  const onNewCompany = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit) => {
      const url = new URL(path, 'https://hermes.test')
      const method = options.method ?? 'GET'
      const body = options.body ? JSON.parse(String(options.body)) : null
      const headers = new Headers(options.headers)
      calls.push({
        path,
        method,
        body,
        tenant: headers.get('X-Tenant-Id'),
        csrf: headers.get('X-CSRF-TOKEN'),
      })
      if (url.pathname.endsWith('/csrf')) return json({ requestToken: 'org-csrf' })
      if (url.pathname === '/api/v1/companies') {
        const items: CompanyRow[] = [
          {
            id: 'duna',
            name: state.profile.data.name,
            status: state.profile.status,
            permissions: allowed,
          },
          { id: 'pannon', name: 'Pannon', status: 'Active', permissions: allowed },
        ]
        return json({
          items: items.filter(
            (x) =>
              (url.searchParams.get('status') === 'all' ||
                x.status === url.searchParams.get('status')) &&
              x.name.toLowerCase().includes((url.searchParams.get('search') ?? '').toLowerCase()),
          ),
          total: 2,
          page: 1,
          pageSize: 25,
        })
      }
      if (url.pathname === '/api/v1/company') {
        if (method === 'PUT') {
          if (state.stale)
            return json(
              { code: 'stale_organization', title: 'Az adat időközben megváltozott.' },
              409,
            )
          state.profile = {
            ...state.profile,
            data: { ...body, version: body.version + 1 },
            updatedBy: user.id,
            updatedAt: '2026-10-20T11:00:00Z',
          }
        }
        return json(
          headers.get('X-Tenant-Id') === 'pannon'
            ? { ...state.profile, id: 'pannon', data: { ...state.profile.data, name: 'Pannon' } }
            : state.profile,
        )
      }
      if (url.pathname === '/api/v1/company/state' || url.pathname === '/api/v1/company/status') {
        if (method === 'PATCH')
          state.profile = {
            ...state.profile,
            status: body.status,
            statusReason: body.reason,
            data: { ...state.profile.data, version: state.profile.data.version + 1 },
          }
        return json({
          version: state.profile.data.version,
          status: state.profile.status,
          reason: state.profile.statusReason,
          changedAt: null,
        })
      }
      if (url.pathname === '/api/v1/company/contacts') {
        if (method === 'POST') {
          const contact = {
            ...metadata,
            ...archive,
            id: 'new-contact',
            data: { ...body, version: 1 },
          }
          state.contacts.push(contact)
          return json(contact)
        }
        return json(state.contacts)
      }
      if (url.pathname === '/api/v1/company/sites') {
        if (method === 'POST') {
          const site = {
            ...metadata,
            ...archive,
            id: 'new-site',
            data: { ...body, version: 1 },
            contactName: null,
            vehicleCount: 0,
          }
          state.sites.push(site)
          return json(site)
        }
        return json(state.sites)
      }
      if (url.pathname === '/api/v1/company/sites/bp/status')
        return json(
          { code: 'site_has_vehicles', title: 'Előbb rendeld át a telephely járműveit.' },
          409,
        )
      if (url.pathname === '/api/v1/company/vehicles') return json(state.vehicles)
      if (url.pathname === '/api/v1/company/vehicles/car/site') {
        state.vehicles = [
          {
            ...state.vehicles[0],
            siteId: body.siteId,
            siteName: 'Budapest',
            version: body.version + 1,
          },
        ]
        return json(state.vehicles[0])
      }
      if (url.pathname === '/api/v1/company/audit-events')
        return json({
          items: [
            {
              id: 'audit',
              action: 'company.updated',
              actorSubject: user.id,
              originalActorSubject: '01a1580f-94ed-7de0-9719-2d6624422110',
              createdAt: metadata.createdAt,
              details: '{"before":{"Name":"Régi cég"},"after":{"Name":"Duna"}}',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        })
      throw new Error(`Unexpected request: ${method} ${path}`)
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <CompaniesPage user={user} initialCompanyId="duna" onNewCompany={onNewCompany} />
    </QueryClientProvider>,
  )
  return { state, calls, client, onNewCompany }
}
async function openCompany(name = 'Duna') {
  await userEvent.click(await screen.findByRole('button', { name: `Cég megnyitása: ${name}` }))
}

it('filters the company directory and keeps inactive company management reachable', async () => {
  const { calls, onNewCompany } = mount()
  await screen.findByRole('button', { name: 'Cég megnyitása: Duna' })
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Cégek szűrése állapot szerint' }),
    'all',
  )
  await userEvent.type(screen.getByRole('textbox', { name: 'Cég keresése' }), 'Duna')
  await userEvent.click(screen.getByRole('button', { name: 'Keresés' }))
  await waitFor(() =>
    expect(
      calls.some(
        (c) => c.path.includes('search=Duna') && c.path.includes('status=all') && c.tenant === null,
      ),
    ).toBe(true),
  )
  await userEvent.click(screen.getByRole('button', { name: 'Új cég' }))
  expect(onNewCompany).toHaveBeenCalledOnce()
})
it('saves company fields with the selected company, revision and CSRF token', async () => {
  const { calls } = mount()
  await openCompany()
  const name = await screen.findByRole('textbox', { name: 'Hivatalos cégnév' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Duna Fuvarozó Kft.')
  expect(screen.queryByRole('textbox', { name: 'Adószám' })).not.toBeInTheDocument()
  expect(screen.queryByRole('textbox', { name: 'Közösségi adószám' })).not.toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Időzóna' }), 'Europe/Vienna')
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Pénznem' }), 'EUR')
  await userEvent.click(screen.getByRole('button', { name: 'Cégadatok mentése' }))
  await waitFor(() =>
    expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
      legalName: 'Duna Fuvarozó Kft.',
      taxNumber: '12345678-2-42',
      euVatNumber: 'HU12345678',
      timeZone: 'Europe/Vienna',
      currency: 'EUR',
      version: 1,
    }),
  )
  expect(calls.find((c) => c.method === 'PUT')).toMatchObject({ tenant: 'duna', csrf: 'org-csrf' })
  expect(await screen.findByRole('status')).toHaveTextContent('mentve és naplózva')
})
it('preserves saved settings outside the dropdown catalog when another company field changes', async () => {
  const { state, calls } = mount()
  state.profile.data.timeZone = 'Central Europe Standard Time'
  state.profile.data.currency = 'XTS'
  await openCompany()
  expect(await screen.findByRole('combobox', { name: 'Időzóna' })).toHaveValue('Central Europe Standard Time')
  expect(screen.getByRole('combobox', { name: 'Pénznem' })).toHaveValue('XTS')
  await userEvent.type(screen.getByRole('textbox', { name: 'Hivatalos cégnév' }), ' új')
  await userEvent.click(screen.getByRole('button', { name: 'Cégadatok mentése' }))
  await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({
    timeZone: 'Central Europe Standard Time', currency: 'XTS', taxNumber: '12345678-2-42',
  }))
})
it('keeps unsaved values after a conflict until the user reloads the current revision', async () => {
  const { state } = mount()
  await openCompany()
  const field = await screen.findByRole('textbox', { name: 'Hivatalos cégnév' })
  await userEvent.clear(field)
  await userEvent.type(field, 'Saját szerkesztés')
  state.stale = true
  state.profile.data = { ...state.profile.data, legalName: 'Másik kezelő módosítása', version: 7 }
  await userEvent.click(screen.getByRole('button', { name: 'Cégadatok mentése' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('időközben megváltozott')
  expect(field).toHaveValue('Saját szerkesztés')
  await userEvent.click(screen.getByRole('button', { name: 'Friss adatok betöltése' }))
  expect(await screen.findByDisplayValue('Másik kezelő módosítása')).toBeInTheDocument()
})
it('creates a company contact through the dialog', async () => {
  const { calls } = mount()
  await openCompany()
  await userEvent.click(await screen.findByRole('tab', { name: 'Kapcsolattartók' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Új kapcsolattartó' }))
  const dialog = screen.getByRole('dialog', { name: 'Új kapcsolattartó' })
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Név' }), 'Nagy Béla')
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'E-mail-cím' }),
    'bela@example.test',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Mentés' }))
  expect(await screen.findByText('Nagy Béla')).toBeInTheDocument()
  expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/contacts'))).toMatchObject({
    tenant: 'duna',
    body: { name: 'Nagy Béla', version: 0 },
  })
})
it('allows site creation without company-profile access and sends structured address data', async () => {
  const { calls } = mount(['sites.read', 'sites.create'])
  await openCompany()
  await userEvent.click(await screen.findByRole('button', { name: 'Új telephely' }))
  const dialog = screen.getByRole('dialog', { name: 'Új telephely' })
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Telephely neve' }),
    'Győri telephely',
  )
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Telephelykód' }), 'GYOR')
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Település' }), 'Győr')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Mentés' }))
  expect(await screen.findByText('Győri telephely')).toBeInTheDocument()
  expect(calls.find((c) => c.method === 'POST' && c.path.endsWith('/sites'))?.body).toMatchObject({
    code: 'GYOR',
    address: { city: 'Győr', countryCode: 'HU' },
  })
  expect(calls.some((c) => c.path === '/api/v1/company')).toBe(false)
})
it('hides every site write action for a viewer', async () => {
  mount(['sites.read'])
  await openCompany()
  await screen.findByText('Budapest')
  expect(screen.queryByRole('button', { name: 'Új telephely' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Telephely szerkesztése:/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Telephely állapota:/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Cégadatok' })).not.toBeInTheDocument()
})

it('keeps the create-only site permission usable without exposing existing sites', async () => {
  const { calls } = mount(['sites.create'])
  await openCompany()
  expect(await screen.findByRole('button', { name: 'Új telephely' })).toBeEnabled()
  expect(
    screen.getByText('A meglévő telephelyek megtekintéséhez nincs jogosultságod.'),
  ).toBeInTheDocument()
  expect(calls.some((c) => c.path.includes('/company/sites'))).toBe(false)
})
it('assigns a vehicle with assignment permission while lacking vehicle or site editing permission', async () => {
  const { calls } = mount(['sites.read', 'sites.vehicles.assign', 'vehicles.read'])
  await openCompany()
  await userEvent.click(await screen.findByRole('tab', { name: 'Járművek telephelyei' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'Telephely-hozzárendelés: DUN-001' }),
  )
  const dialog = screen.getByRole('dialog', { name: 'Jármű telephelye: DUN-001' })
  await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: 'Telephely' }), 'bp')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Mentés' }))
  await waitFor(() =>
    expect(calls.find((c) => c.path.endsWith('/car/site'))?.body).toEqual({
      siteId: 'bp',
      version: 8,
    }),
  )
  expect(await screen.findByText('Budapest')).toBeInTheDocument()
})
it('requires an explicit reason and shows an archive conflict without closing the dialog', async () => {
  const { calls } = mount()
  await openCompany()
  await userEvent.click(await screen.findByRole('tab', { name: 'Telephelyek' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Telephely állapota: Budapest' }))
  const dialog = screen.getByRole('dialog', { name: 'Telephely archiválása: Budapest' })
  expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  await userEvent.type(
    within(dialog).getByRole('textbox', { name: 'Indoklás' }),
    'Telephely bezárása',
  )
  await userEvent.click(within(dialog).getByRole('button', { name: 'Állapot módosítása' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Előbb rendeld át')
  expect(dialog).toBeInTheDocument()
})
it('permits company status management independently of access to its legal profile', async () => {
  const { calls } = mount(['companies.status'])
  await openCompany()
  await userEvent.click(await screen.findByRole('button', { name: 'Cég állapotának kezelése' }))
  const dialog = screen.getByRole('dialog', { name: 'Cég állapotának kezelése' })
  expect(within(dialog).getByRole('button', { name: 'Mégse' })).toBeEnabled()
  await userEvent.selectOptions(
    within(dialog).getByRole('combobox', { name: 'Új állapot' }),
    'Suspended',
  )
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Indoklás' }), 'Átmeneti szünet')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Állapot módosítása' }))
  await waitFor(() =>
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      status: 'Suspended',
      reason: 'Átmeneti szünet',
      version: 1,
    }),
  )
  expect(calls.some((c) => c.path === '/api/v1/company')).toBe(false)
  expect(await screen.findByText(/Az adatok megtekinthetők/)).toHaveTextContent('Átmeneti szünet')
})
it('shows who changed company data and exposes the recorded before and after values', async () => {
  mount()
  await openCompany()
  await userEvent.click(await screen.findByRole('tab', { name: 'Módosítási napló' }))
  expect(await screen.findByText('Cégadatok módosítása')).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: user.id })).toBeInTheDocument()
  await userEvent.click(screen.getByText('Részletek'))
  expect(screen.getByText('Korábbi naplóazonosító: 01a1580f-94ed-7de0-9719-2d6624422110')).toBeVisible()
  expect(screen.getByText('Régi cég')).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Előtte' })).toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Utána' })).toBeInTheDocument()
})
