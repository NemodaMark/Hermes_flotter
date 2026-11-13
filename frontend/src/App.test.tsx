import { chooseOption } from './selectTestUtils'
import { expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { api, resetCsrfToken } from './api'

function mountApp({
  permissions = ['vehicles.read', 'vehicles.create'],
  signedIn = true,
  expire = false,
  canCreateUnassigned = true,
  ownAvatarRevision = null as string | null,
} = {}) {
  resetCsrfToken()
  const user = { id: 'anna', displayName: 'Kovács Anna', email: 'anna@example.test' }
  let session = signedIn ? user : null
  let tenants = signedIn
    ? [
        { id: 'duna', name: 'Duna', permissions },
        { id: 'pannon', name: 'Pannon', permissions },
      ]
    : []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit) => {
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
      if (path.endsWith('/csrf')) return json({ requestToken: 'test-token' })
      if (path.endsWith('/session')) return session ? json(session) : json({}, 401)
      if (path === '/api/v1/people/anna') return json({ person: { ...user, phoneNumber: null, avatarRevision: ownAvatarRevision }, version: 1, canEdit: true, canManageAccount: false, vehicles: [] })
      if (path === '/api/v1/people/anna/avatar') return new Response('pixels', { headers: { 'Content-Type': 'image/png' } })
      if (path.endsWith('/login') || path.endsWith('/register')) {
        session = user
        return json(user)
      }
      if (path.endsWith('/logout')) {
        session = null
        return new Response(null, { status: 204 })
      }
      if (path.endsWith('/tenants')) {
        if (options.method === 'POST') {
          const input = JSON.parse(options.body as string) as { name: string }
          const tenant = {
            id: 'new-company',
            name: input.name,
            permissions: ['vehicles.read', 'vehicles.create'],
          }
          tenants = [...tenants, tenant]
          return json(tenant, 201)
        }
        return json(tenants)
      }
      if (path === '/api/v1/dashboard') return json({ mode: 'Overview', priority: 0, sourceGroup: null, canReadVehicles: true, vehicles: [] })
      if (path.endsWith('/permissions') || path.endsWith('/permission-groups') || path.endsWith('/permission-groups/companies')) return json([])
      if (/\/(members|people|invitations)(\?|$)/.test(path)) return json({ items: [], total: 0, page: 1, pageSize: 25 })
      if (path.endsWith('/vehicles/create-options')) return json({ canCreateUnassigned, sites: [{ id: 'site-a', name: 'Budapest', code: 'BP' }] })
      if (path.endsWith('/vehicles/site-options')) return json([{ id: 'site-a', name: 'Budapest', code: 'BP' }])
      if (path.startsWith('/api/v1/vehicles/search?')) {
        if (expire) { session = null; return json({}, 401) }
        const tenantId = new Headers(options.headers).get('X-Tenant-Id')
        const query = new URL(path, 'http://localhost').searchParams
        const all = tenantId === 'new-company' ? [] : [{ id: 'vehicle', registration: tenantId === 'duna' ? 'DUN-001' : 'PAN-002', make: 'Ford', model: 'Focus', status: 'Active' }]
        const items = all.filter(car => (query.get('siteId') ?? 'all') === 'all' && (query.get('status') === 'all' || query.get('status') === car.status)
          && `${car.registration} ${car.make} ${car.model}`.toLowerCase().includes((query.get('search') ?? '').toLowerCase()))
        return json({ items, total: items.length, availableTotal: all.length, page: 1, pageSize: Number(query.get('pageSize') ?? 25) })
      }
      if (path.includes('/vehicles')) {
        if (options.method === 'POST') return json({ id: 'created', ...JSON.parse(String(options.body)) }, 201)
        if (expire) {
          session = null
          return json({}, 401)
        }
        const tenantId = new Headers(options.headers).get('X-Tenant-Id')
        return json(
          tenantId === 'new-company'
            ? []
            : [
                {
                  id: 'vehicle',
                  registration: tenantId === 'duna' ? 'DUN-001' : 'PAN-002',
                  make: 'Ford',
                  model: 'Focus',
                  status: 'Active',
                },
              ],
        )
      }
      return json({ status: 'ready' })
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return client
}

it('opens the dashboard for the root URL while keeping explicit fleet links available', async () => {
  window.history.replaceState(null, '', '/')
  mountApp()
  expect(await screen.findByRole('heading', { name: 'Flotta áttekintés' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Járművek' }))
  expect(await screen.findByText('DUN-001')).toBeInTheDocument()
  expect(window.location.hash).toBe('#/vehicles')
})

it('replaces the visible fleet when a different company is selected', async () => {
  mountApp()
  expect(await screen.findByText('DUN-001')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Munkaterület váltása:/ }))
  await chooseOption(screen.getByRole('combobox', { name: 'Munkaterület' }), 'pannon')
  expect(await screen.findByText('PAN-002')).toBeInTheDocument()
  expect(screen.queryByText('DUN-001')).not.toBeInTheDocument()
})

it('offers vehicle creation only with the explicit permission', async () => {
  mountApp({ permissions: ['vehicles.read'] })
  expect(await screen.findByText('DUN-001')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Új jármű' })).not.toBeInTheDocument()
})
it('uses the uploaded profile photo in the sidebar independently of the selected company', async () => {
  const blobUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:own-photo')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  mountApp({ ownAvatarRevision: 'photo-v1' })
  await waitFor(() => expect(screen.getByRole('img', { name: 'Saját profilkép' })).toHaveAttribute('src', 'blob:own-photo'))
  await userEvent.click(screen.getByRole('button', { name: /Munkaterület váltása:/ }))
  await chooseOption(screen.getByRole('combobox', { name: 'Munkaterület' }), 'pannon')
  await screen.findByText('PAN-002')
  expect(screen.getByRole('img', { name: 'Saját profilkép' })).toHaveAttribute('src', 'blob:own-photo')
  const calls = vi.mocked(fetch).mock.calls.filter(([path]) => path === '/api/v1/people/anna/avatar')
  expect(calls).toHaveLength(1)
  expect(new Headers(calls[0][1]?.headers).get('X-Tenant-Id')).toBeNull()
  expect(screen.queryByText('Rendszer elérhető')).not.toBeInTheDocument()
  blobUrl.mockRestore(); revoke.mockRestore()
})

it('filters the fleet by an authorized empty site and resets the site when changing company', async () => {
  mountApp()
  await screen.findByText('DUN-001')
  expect(screen.queryByRole('combobox', { name: 'Munkaterület' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Munkaterület váltása: Duna \/ Összes telephely/ }))
  await chooseOption(screen.getByRole('combobox', { name: 'Munkaterület telephelye' }), 'site-a')
  expect(screen.getByRole('button', { name: 'Munkaterület váltása: Duna / Budapest' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Munkaterület-választó bezárása' }))
  expect(screen.queryByText('DUN-001')).not.toBeInTheDocument()
  expect(screen.getByRole('columnheader', { name: 'Jármű' })).toBeInTheDocument()
  expect(screen.getByText(/Nincs találat/)).toBeInTheDocument()
  expect(new Headers(vi.mocked(fetch).mock.calls.find(([path]) => String(path).endsWith('/vehicles/site-options'))?.[1]?.headers).get('X-Tenant-Id')).toBe('duna')
  await userEvent.click(screen.getByRole('button', { name: 'Új jármű' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Telephely' })).toHaveValue('Budapest (BP)'))
  await userEvent.click(screen.getByRole('button', { name: 'Vissza a járművekhez' }))
  await userEvent.click(screen.getByRole('button', { name: /Munkaterület váltása:/ }))
  await chooseOption(screen.getByRole('combobox', { name: 'Munkaterület' }), 'pannon')
  expect(await screen.findByText('PAN-002')).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Munkaterület telephelye' })).toHaveValue('Összes telephely')
})

it('puts fleet search, filtering and creation in the same toolbar without duplicate totals', async () => {
  mountApp()
  await screen.findByText('DUN-001')
  const toolbar = screen.getByRole('group', { name: 'Járművek keresése és műveletei' })
  expect(within(toolbar).getByRole('textbox', { name: 'Jármű keresése' })).toBeInTheDocument()
  expect(within(toolbar).getByRole('combobox', { name: 'Szűrés állapot szerint' })).toBeInTheDocument()
  expect(within(toolbar).getByRole('button', { name: 'Új jármű' })).toBeInTheDocument()
  expect(within(toolbar).queryByText('1 jármű')).not.toBeInTheDocument()
  expect(screen.getByText('1 jármű')).toBeInTheDocument()
  expect(screen.getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Jármű', 'Gyártó / modell', 'Km-állás', 'Állapot'])
  expect(screen.queryByRole('button', { name: /Jármű szerkesztése:/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Járműlista frissítése' })).not.toBeInTheDocument()
  expect(screen.queryByText('Céges hozzáférés')).not.toBeInTheDocument()
})

it('pages the server results and resets page on filters, page size and workspace changes', async () => {
  const rows = Array.from({ length: 26 }, (_, i) => ({ id: `car-${i}`, registration: `SERVER-${String(i + 1).padStart(3, '0')}`, make: 'Ford', model: 'Focus', status: 'Active' }))
  const search = vi.spyOn(api, 'searchVehicles').mockImplementation(async (_tenant, query) => ({
    items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    total: rows.length, availableTotal: rows.length, page: query.page, pageSize: query.pageSize,
  }))
  mountApp()
  await screen.findByText('SERVER-001')
  expect(screen.getByText('26 jármű')).toBeInTheDocument()
  expect(screen.queryByText('SERVER-026')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Következő oldal' }))
  await screen.findByText('SERVER-026')
  expect(screen.queryByText('SERVER-001')).not.toBeInTheDocument()
  expect(screen.getByText('2 / 2. oldal')).toBeInTheDocument()
  await chooseOption(screen.getByRole('combobox', { name: 'Szűrés állapot szerint' }), 'Maintenance')
  await waitFor(() => expect(search).toHaveBeenLastCalledWith('duna', expect.objectContaining({ page: 1, status: 'Maintenance' }), expect.any(AbortSignal)))
  await chooseOption(screen.getByRole('combobox', { name: 'Járművek száma oldalanként' }), '50')
  await waitFor(() => expect(search).toHaveBeenLastCalledWith('duna', expect.objectContaining({ page: 1, pageSize: 50 }), expect.any(AbortSignal)))
  await userEvent.click(screen.getByRole('button', { name: /Munkaterület váltása:/ }))
  await chooseOption(screen.getByRole('combobox', { name: 'Munkaterület telephelye' }), 'site-a')
  await waitFor(() => expect(search).toHaveBeenLastCalledWith('duna', expect.objectContaining({ page: 1, siteId: 'site-a' }), expect.any(AbortSignal)))
  await chooseOption(screen.getByRole('combobox', { name: 'Munkaterület' }), 'pannon')
  await waitFor(() => expect(search).toHaveBeenLastCalledWith('pannon', expect.objectContaining({ page: 1, search: '', status: 'all', siteId: 'all' }), expect.any(AbortSignal)))
})

it('debounces search and trusts historical plate matches from the server without filtering the page again', async () => {
  const search = vi.spyOn(api, 'searchVehicles').mockImplementation(async (_tenant, query) => ({
    items: [{ id: 'server-match', registration: 'CURRENT-001', make: 'Ford', model: 'Focus', status: 'Active' }],
    total: 1, availableTotal: 80, page: query.page, pageSize: query.pageSize,
  }))
  mountApp()
  await screen.findByText('CURRENT-001')
  await userEvent.click(screen.getByRole('button', { name: 'Következő oldal' }))
  // The server's total controls the page button, not the number of rendered rows.
  expect(screen.getByRole('button', { name: 'Következő oldal' })).toBeDisabled()
  await userEvent.type(screen.getByRole('textbox', { name: 'Jármű keresése' }), 'OLD-456')
  await waitFor(() => expect(search).toHaveBeenLastCalledWith('duna', expect.objectContaining({ search: 'OLD-456', page: 1 }), expect.any(AbortSignal)))
  expect(screen.getByText('CURRENT-001')).toBeInTheDocument()
  expect(screen.getByText('1 / 80 jármű')).toBeInTheDocument()
  expect(search.mock.calls.filter(([, query]) => query.search.length > 0)).toHaveLength(1)
})

it('cancels stale company searches and never replaces a newer workspace with their late response', async () => {
  let finishOld!: (value: Awaited<ReturnType<typeof api.searchVehicles>>) => void
  const search = vi.spyOn(api, 'searchVehicles').mockImplementation((tenant, query) => tenant === 'duna'
    ? new Promise(resolve => { finishOld = resolve })
    : Promise.resolve({ items: [{ id: 'pannon-car', registration: 'NEW-SCOPE', make: 'Ford', model: 'Focus', status: 'Active' }], total: 1, availableTotal: 1, page: 1, pageSize: query.pageSize }))
  mountApp()
  await screen.findByText('Járművek betöltése…')
  await userEvent.click(screen.getByRole('button', { name: /Munkaterület váltása:/ }))
  await chooseOption(screen.getByRole('combobox', { name: 'Munkaterület' }), 'pannon')
  await screen.findByText('NEW-SCOPE')
  expect(search.mock.calls[0][2]?.aborted).toBe(true)
  finishOld({ items: [{ id: 'old', registration: 'OLD-SCOPE', make: 'Ford', model: 'Focus', status: 'Active' }], total: 1, availableTotal: 1, page: 1, pageSize: 25 })
  await waitFor(() => expect(screen.queryByText('OLD-SCOPE')).not.toBeInTheDocument())
  expect(screen.getByText('NEW-SCOPE')).toBeInTheDocument()
})

it('opens users, invitations and groups as independent pages with distinct URLs', async () => {
  mountApp({ permissions: ['vehicles.read', 'members.read', 'members.invite', 'permission-groups.manage'] })
  const nav = await screen.findByRole('navigation', { name: 'Fő navigáció' })
  await userEvent.click(await within(nav).findByRole('button', { name: 'Felhasználók' }))
  await screen.findByRole('textbox', { name: 'Felhasználó keresése' })
  expect(window.location.hash).toBe('#/users')
  expect(screen.queryByRole('tablist', { name: 'Felhasználókezelés' })).not.toBeInTheDocument()
  expect(within(nav).getByRole('button', { name: 'Meghívások' }).closest('details')).not.toHaveAttribute('open')
  await userEvent.click(within(nav).getByText('Beállítások'))
  await userEvent.click(within(nav).getByRole('button', { name: 'Meghívások' }))
  await screen.findByText(/Még nincs meghívás/)
  expect(window.location.hash).toBe('#/invitations')
  expect(screen.queryByRole('textbox', { name: 'Felhasználó keresése' })).not.toBeInTheDocument()
  await userEvent.click(within(nav).getByRole('button', { name: 'Jogosultságcsoportok' }))
  await screen.findByRole('textbox', { name: 'Jogosultságcsoport keresése' })
  expect(window.location.hash).toBe('#/permission-groups')
})

it('restores an invitation page from its URL and denies it without the company permission', async () => {
  window.history.replaceState(null, '', '/#/invitations')
  mountApp({ permissions: ['vehicles.read'] })
  expect(await screen.findByText('Nincs jogosultságod a meghívások megtekintéséhez.')).toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: 'Fő navigáció' })
  expect(within(nav).queryByRole('button', { name: 'Meghívások' })).not.toBeInTheDocument()
  expect(within(nav).queryByRole('button', { name: 'Jogosultságcsoportok' })).not.toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([path]) => /\/invitations(\?|$)/.test(String(path)))).toBe(false)
  expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).endsWith('/vehicles'))).toBe(false)
})

it('does not fetch or display vehicles without read permission, even with create permission', async () => {
  mountApp({ permissions: ['vehicles.create'] })
  expect(
    await screen.findByText('Nincs jogosultságod a járműlista megtekintéséhez.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Új jármű' })).toBeInTheDocument()
  expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).includes('/vehicles'))).toBe(
    false,
  )
})

it('requires an allowed site for vehicle creation with a site-restricted permission', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  mountApp({ permissions: ['vehicles.create'], canCreateUnassigned: false })
  await userEvent.click(await screen.findByRole('button', { name: 'Új jármű' }))
  const site = await screen.findByRole('combobox', { name: 'Telephely' })
  await waitFor(() => expect(site).toBeEnabled())
  expect(site).toBeRequired()
  expect(screen.queryByRole('option', { name: 'Nincs telephelyhez rendelve' })).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Rendszám'), 'NEW-001')
  await userEvent.type(screen.getByLabelText('Gyártó'), 'Ford')
  await userEvent.type(screen.getByLabelText('Modell'), 'Focus')
  await userEvent.click(screen.getByRole('button', { name: 'Jármű létrehozása' }))
  expect(vi.mocked(fetch).mock.calls.some(([path, options]) => String(path).endsWith('/vehicles') && options?.method === 'POST')).toBe(false)
  await chooseOption(site, 'site-a')
  await userEvent.click(screen.getByRole('button', { name: 'Jármű létrehozása' }))
  await waitFor(() => {
    const options = vi.mocked(fetch).mock.calls.find(([path, options]) => String(path).endsWith('/vehicles') && options?.method === 'POST')?.[1]
    expect(JSON.parse(String(options?.body))).toMatchObject({ registration: 'NEW-001', make: 'Ford', model: 'Focus', siteId: 'site-a', data: { bodyType: 'Unknown' } })
  })
})

it('logs in and offers company creation to a user without memberships', async () => {
  mountApp({ signedIn: false })
  await screen.findByRole('heading', { name: 'Bejelentkezés' })
  await userEvent.type(screen.getByLabelText('Felhasználónév vagy e-mail-cím'), 'anna@example.test')
  await userEvent.type(screen.getByLabelText('Jelszó', { exact: true }), 'test-password-123')
  await userEvent.click(screen.getByRole('button', { name: 'Belépés' }))
  expect(
    await screen.findByRole('heading', { name: 'Hozd létre az első cégedet' }),
  ).toBeInTheDocument()
})

it('takes an invited account through creating its first company after sign-in', async () => {
  mountApp({ signedIn: false })
  await userEvent.type(await screen.findByLabelText('Felhasználónév vagy e-mail-cím'), 'anna')
  await userEvent.type(screen.getByLabelText('Jelszó', { exact: true }), 'test-password-123')
  await userEvent.click(screen.getByRole('button', { name: 'Belépés' }))
  await screen.findByRole('heading', { name: 'Hozd létre az első cégedet' })
  await userEvent.type(screen.getByLabelText('Cégnév'), 'Saját Flotta Kft.')
  await userEvent.click(screen.getByRole('button', { name: 'Cég létrehozása' }))
  expect(await screen.findByText('Ezen a munkaterületen még nincs jármű.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Munkaterület váltása: Saját Flotta Kft. / Összes telephely' })).toBeInTheDocument()
})

it('clears private data on logout and returns to the login form', async () => {
  const client = mountApp()
  await screen.findByText('DUN-001')
  await userEvent.click(screen.getByRole('button', { name: 'Kijelentkezés' }))
  expect(await screen.findByRole('heading', { name: 'Bejelentkezés' })).toBeInTheDocument()
  expect(screen.queryByText('DUN-001')).not.toBeInTheDocument()
  expect(client.getQueryData(['tenants', 'anna'])).toBeUndefined()
})

it('returns to login when a protected request detects an expired session', async () => {
  mountApp({ expire: true })
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Bejelentkezés' })).toBeInTheDocument(),
  )
  expect(screen.queryByRole('heading', { name: 'Járműállomány' })).not.toBeInTheDocument()
})

it('clears private data when the periodic session check finds an expired session', async () => {
  const client = mountApp()
  await screen.findByText('DUN-001')
  vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 401 }))
  await client.refetchQueries({ queryKey: ['session'] })
  expect(await screen.findByRole('heading', { name: 'Bejelentkezés' })).toBeInTheDocument()
  await waitFor(() => {
    expect(client.getQueryData(['tenants', 'anna'])).toBeUndefined()
    expect(client.getQueryData(['vehicles', 'anna', 'duna'])).toBeUndefined()
  })
})
