import { chooseOption } from './selectTestUtils'
import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { resetCsrfToken } from './api'
import type { Session, UserProfile } from './api'
import { permissionNames } from './permissions'

const initial: UserProfile = {
  id: 'kiss.eszter',
  displayName: 'Kiss Eszter',
  email: 'eszter@example.test',
  phoneNumber: null,
  version: 7,
  passwordChangeRequired: false,
  passwordChangeRequestedAt: null,
  passwordChangedAt: null,
  systemPermissions: [],
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
beforeEach(() => {
  resetCsrfToken()
  window.history.replaceState(null, '', '/#/vehicles')
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

function mount({
  admin = true,
  forced = false,
  forceOnVehicle = false,
  hash = '',
  noCompanies = false,
  own = false,
  companyPermissions = Object.keys(permissionNames),
} = {}) {
  if (hash) window.history.replaceState(null, '', hash)
  const session: Session = {
    id: own ? initial.id : 'anna',
    displayName: 'Kovács Anna',
    email: 'anna@example.test',
    passwordChangeRequired: forced,
    systemPermissions: admin ? ['system.manage'] : [],
  }
  const state = {
    profile: { ...initial },
    session,
    stale: false,
    forceOnVehicle,
  }
  const calls: {
    path: string
    method: string
    body?: Record<string, unknown>
    csrf: string | null
  }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit) => {
      const url = new URL(path, 'https://hermes.test')
      const method = options.method ?? 'GET'
      const body = options.body ? JSON.parse(String(options.body)) : undefined
      calls.push({
        path,
        method,
        body,
        csrf: new Headers(options.headers).get('X-CSRF-TOKEN'),
      })
      if (url.pathname.endsWith('/csrf')) return json({ requestToken: 'profile-csrf' })
      if (url.pathname.endsWith('/session')) return json(state.session)
      if (url.pathname.endsWith('/change-password')) {
        state.session = { ...state.session, passwordChangeRequired: false }
        return json(state.session)
      }
      if (url.pathname === '/api/v1/tenants')
        return json(
          noCompanies
            ? []
            : [
                {
                  id: 'duna',
                  name: 'Duna',
                  permissions: companyPermissions,
                },
              ],
        )
      if (url.pathname === '/api/v1/permissions')
        return json(
          Object.entries(permissionNames).map(([code, name]) => ({
            code,
            name,
          })),
        )
      if (url.pathname === '/api/v1/vehicles' || url.pathname === '/api/v1/vehicles/search') {
        if (state.forceOnVehicle) {
          state.forceOnVehicle = false
          state.session.passwordChangeRequired = true
          return json({ code: 'password_change_required', title: 'Kötelező jelszócsere' }, 403)
        }
        return json(url.pathname.endsWith('/search') ? { items: [], total: 0, availableTotal: 0, page: 1, pageSize: 25 } : [])
      }
      if (url.pathname === '/api/v1/members')
        return json({
          items: [
            {
              userId: initial.id,
              displayName: initial.displayName,
              email: initial.email,
              isActive: true,
              version: 1,
              permissions: [],
              joinedAt: null,
              disabledAt: null,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        })
      if (url.pathname === `/api/v1/people/${initial.id}`)
        return json({ person: state.profile, version: state.profile.version, canEdit: admin || own, canManageAccount: admin, vehicles: [] })
      if (url.pathname.startsWith('/api/v1/mileage/months/'))
        return json({ userId: url.searchParams.get('userId'), month: '2026-10-01', mode: 'Entries', totalKm: 460, privateKm: 60,
          monthlyLimitKm: 900, version: 2, submittedAt: null, updatedBy: null, updatedAt: null, dueMonth: null, entries: [] })
      if (url.pathname === '/api/v1/mileage/accounts')
        return json([{ userId: initial.id, name: initial.displayName, monthlyLimitKm: 900, version: 1 }])
      if (url.pathname === `/api/v1/members/${initial.id}`)
        return json({ userId: initial.id, displayName: initial.displayName, email: initial.email, isActive: true, version: 1, permissions: [], joinedAt: null, disabledAt: null })
      if (url.pathname === '/api/v1/system/users')
        return json({ items: [state.profile], total: 1, page: 1, pageSize: 25 })
      if (url.pathname === '/api/v1/system/audit-events')
        return json({
          items: [
            {
              id: 'audit',
              actorSubject: session.id,
              targetSubject: initial.id,
              tenantId: null,
              action: 'user.profile_changed',
              details: '{"before":{"DisplayName":"Régi"},"after":{"DisplayName":"Új"}}',
              createdAt: '2026-10-20T08:00:00Z',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 25,
        })
      if (url.pathname === `/api/v1/system/users/${initial.id}`) {
        if (method === 'PUT') {
          if (state.stale)
            return json(
              {
                code: 'stale_profile',
                title: 'A profil időközben megváltozott.',
              },
              409,
            )
          state.profile = {
            ...state.profile,
            ...body,
            version: state.profile.version + 1,
          }
        }
        return json(state.profile)
      }
      if (url.pathname.endsWith('/require-password-change')) {
        state.profile = {
          ...state.profile,
          passwordChangeRequired: true,
          version: state.profile.version + 1,
        }
        return json(state.profile)
      }
      if (url.pathname.endsWith('/system-access')) {
        state.profile = {
          ...state.profile,
          systemPermissions: body.enabled ? ['system.manage'] : [],
          version: state.profile.version + 1,
        }
        return json(state.profile)
      }
      if (url.pathname === '/health/ready') return json({ status: 'ready' })
      throw new Error(`Unexpected request: ${method} ${path}`)
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return { calls, state, client }
}
async function openProfile() {
  await userEvent.click(await screen.findByRole('button', { name: 'Felhasználók' }))
  await userEvent.click(
    await screen.findByRole('button', {
      name: `Profil megnyitása: ${initial.email}`,
    }),
  )
  const profile = await screen.findByRole('region', { name: 'Felhasználói profil' })
  await userEvent.click(await within(profile).findByRole('button', { name: 'Szerkesztés' }))
  await within(profile).findByDisplayValue(initial.displayName)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  return profile
}

it('requires the password change before the workspace or an invitation can be used', async () => {
  const { calls } = mount({
    forced: true,
    hash: `#invite=1&tenantId=11111111-1111-4111-8111-111111111111&invitationId=22222222-2222-4222-8222-222222222222&token=${'a'.repeat(43)}`,
  })
  expect(await screen.findByRole('heading', { name: 'Kötelező jelszócsere' })).toBeInTheDocument()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Meghívó elfogadása' })).not.toBeInTheDocument()
  expect(
    calls.some((call) => call.path.includes('/tenants') || call.path.includes('/vehicles')),
  ).toBe(false)
  expect(screen.getByRole('button', { name: 'Kijelentkezés' })).toBeEnabled()
})

it('checks confirmation and reuse, then clears the restriction after a successful change', async () => {
  const { calls, client } = mount({ forced: true })
  const current = await screen.findByLabelText('Jelenlegi jelszó')
  await userEvent.type(current, 'current-password-42')
  await userEvent.type(screen.getByLabelText('Új jelszó', { exact: true }), 'different-password-42')
  await userEvent.type(screen.getByLabelText('Új jelszó megerősítése'), 'mismatch-password-42')
  await userEvent.click(screen.getByRole('button', { name: 'Jelszó megváltoztatása' }))
  expect(screen.getByRole('alert')).toHaveTextContent('A két új jelszó nem egyezik.')
  await userEvent.clear(screen.getByLabelText('Új jelszó megerősítése'))
  await userEvent.type(screen.getByLabelText('Új jelszó megerősítése'), 'different-password-42')
  await userEvent.click(screen.getByRole('button', { name: 'Jelszó megváltoztatása' }))
  expect(await screen.findByRole('navigation')).toBeInTheDocument()
  const call = calls.find((item) => item.path.endsWith('/change-password'))!
  expect(call.body).toEqual({
    currentPassword: 'current-password-42',
    newPassword: 'different-password-42',
    confirmPassword: 'different-password-42',
  })
  expect(call.csrf).toBe('profile-csrf')
  expect(screen.queryByLabelText('Jelenlegi jelszó')).not.toBeInTheDocument()
  expect(client.getMutationCache().getAll()).toHaveLength(0)
})

it('switches immediately to the forced change screen on the server restriction response', async () => {
  mount({ forceOnVehicle: true })
  expect(await screen.findByRole('heading', { name: 'Kötelező jelszócsere' })).toBeInTheDocument()
  expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
})

it('opens the profile from the company members, shows immutable ID and saves editable fields with the revision', async () => {
  const { calls } = mount()
  const dialog = await openProfile()
  expect(within(dialog).getByText(`@${initial.id}`)).toBeInTheDocument()
  expect(within(dialog).queryByLabelText('Felhasználói ID')).not.toBeInTheDocument()
  await userEvent.clear(within(dialog).getByLabelText('Teljes név'))
  await userEvent.type(within(dialog).getByLabelText('Teljes név'), 'Kiss Eszter Júlia')
  await userEvent.type(within(dialog).getByLabelText('Telefonszám'), '+36 30 1234567')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Profil mentése' }))
  expect(await within(dialog).findByRole('status')).toHaveTextContent('mentve és naplózva')
  expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
    displayName: 'Kiss Eszter Júlia',
    email: initial.email,
    phoneNumber: '+36 30 1234567',
    version: 7,
  })
})

it('requires a deliberate confirmation before forcing a password change or granting global access', async () => {
  const { calls } = mount()
  const dialog = await openProfile()
  await userEvent.click(within(dialog).getByRole('tab', { name: 'Fiókbiztonság' }))
  await userEvent.click(
    within(dialog).getByRole('button', {
      name: 'Kötelező jelszócsere elrendelése',
    }),
  )
  expect(calls.some((call) => call.path.endsWith('/require-password-change'))).toBe(false)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Megerősítem' }))
  expect(await within(dialog).findByText('Kötelező a következő belépéskor')).toBeInTheDocument()
  expect(calls.find((call) => call.path.endsWith('/require-password-change'))?.body).toEqual({
    version: 7,
  })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Rendszerszintű jog megadása' }))
  expect(calls.some((call) => call.path.endsWith('/system-access'))).toBe(false)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Megerősítem' }))
  expect(
    await within(dialog).findByRole('button', {
      name: 'Rendszerszintű jog visszavonása',
    }),
  ).toBeInTheDocument()
  expect(calls.find((call) => call.path.endsWith('/system-access'))?.body).toEqual({
    enabled: true,
    version: 8,
  })
})

it('separates the profile panels, supports keyboard navigation and retains drafts across security changes', async () => {
  const { calls } = mount({ companyPermissions: [...Object.keys(permissionNames), 'mileage.manage'] })
  const page = await openProfile()
  expect(within(page).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Profiladatok', 'Havi km-elszámolás', 'Céges hozzáférések', 'Fiókbiztonság'])
  expect(within(page).getByRole('tabpanel', { name: 'Profiladatok' })).toBeVisible()
  expect(within(page).queryByRole('button', { name: 'Kötelező jelszócsere elrendelése' })).not.toBeInTheDocument()
  await userEvent.clear(within(page).getByLabelText('Teljes név'))
  await userEvent.type(within(page).getByLabelText('Teljes név'), 'Megkezdett szerkesztés')
  within(page).getByRole('tab', { name: 'Profiladatok' }).focus()
  await userEvent.keyboard('{ArrowRight}{ArrowRight}')
  expect(within(page).getByRole('tab', { name: 'Céges hozzáférések' })).toHaveFocus()
  expect(within(page).getByRole('tabpanel', { name: 'Céges hozzáférések' })).toBeVisible()
  expect(within(page).queryByRole('button', { name: 'Profil mentése' })).not.toBeInTheDocument()
  await userEvent.keyboard('{End}')
  expect(within(page).getByRole('tab', { name: 'Fiókbiztonság' })).toHaveAttribute('aria-selected', 'true')
  await userEvent.click(within(page).getByRole('button', { name: 'Kötelező jelszócsere elrendelése' }))
  await userEvent.click(within(page).getByRole('button', { name: 'Megerősítem' }))
  await within(page).findByText('Kötelező a következő belépéskor')
  await userEvent.click(within(page).getByRole('tab', { name: 'Profiladatok' }))
  expect(within(page).getByLabelText('Teljes név')).toHaveValue('Megkezdett szerkesztés')
  expect(calls.filter(call => call.method === 'PUT')).toHaveLength(0)
  await userEvent.click(within(page).getByRole('button', { name: 'Profil mentése' }))
  await waitFor(() => expect(calls.find(call => call.method === 'PUT')?.body).toMatchObject({ displayName: 'Megkezdett szerkesztés', version: 8 }))
})

it('cancels an unconfirmed security operation when leaving its tab', async () => {
  const { calls } = mount()
  const page = await openProfile()
  await userEvent.click(within(page).getByRole('tab', { name: 'Fiókbiztonság' }))
  await userEvent.click(within(page).getByRole('button', { name: 'Rendszerszintű jog megadása' }))
  expect(within(page).getByRole('button', { name: 'Megerősítem' })).toBeInTheDocument()
  await userEvent.click(within(page).getByRole('tab', { name: 'Profiladatok' }))
  await userEvent.click(within(page).getByRole('tab', { name: 'Fiókbiztonság' }))
  expect(within(page).queryByRole('button', { name: 'Megerősítem' })).not.toBeInTheDocument()
  expect(calls.some(call => call.path.endsWith('/system-access'))).toBe(false)
})

it('does not expose account or company management tabs or fetch private account data for a colleague viewer', async () => {
  const { calls } = mount({ admin: false, companyPermissions: ['mileage.record'], hash: `#/profile/${initial.id}` })
  const tabs = await screen.findByRole('tablist', { name: 'Felhasználói adatlap részei' })
  expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Profiladatok'])
  expect(screen.queryByRole('tab', { name: 'Céges hozzáférések' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Fiókbiztonság' })).not.toBeInTheDocument()
  expect(calls.some(call => call.path.startsWith('/api/v1/system/'))).toBe(false)
  expect(calls.some(call => call.path.startsWith('/api/v1/members/'))).toBe(false)
  expect(calls.some(call => call.path.startsWith('/api/v1/mileage/'))).toBe(false)
})

it('shows the current company mileage and opens the report for the signed-in person', async () => {
  const { calls } = mount({ own: true, admin: false, companyPermissions: ['mileage.record'], hash: `#/profile/${initial.id}` })
  const summary = await screen.findByRole('region', { name: 'Aktuális havi km-állás' })
  await within(summary).findByText('440 km')
  expect(within(summary).getByText('400 km')).toBeVisible()
  expect(within(summary).getByText('60 km')).toBeVisible()
  expect(within(summary).getByRole('progressbar')).toHaveAttribute('value', '460')
  expect(screen.queryByLabelText('Teljes név')).not.toBeInTheDocument()
  await userEvent.click(within(summary).getByRole('button', { name: 'Elszámolás megnyitása' }))
  expect(await screen.findByRole('button', { name: 'Km-tétel hozzáadása' })).toBeVisible()
  expect(screen.getByLabelText('Elszámolási hónap')).toHaveValue('2026-10')
  expect(calls.filter(call => call.path.startsWith('/api/v1/mileage/')).map(call => call.path)).toEqual([
    '/api/v1/mileage/months/current?userId=kiss.eszter',
    '/api/v1/mileage/months/2026-10-01?userId=kiss.eszter',
  ])
})

it('opens the selected colleague’s mileage for a company mileage manager', async () => {
  const { calls } = mount({ admin: false, companyPermissions: ['mileage.manage'], hash: `#/profile/${initial.id}` })
  await userEvent.click(await screen.findByRole('tab', { name: 'Havi km-elszámolás' }))
  expect(await screen.findByText('Személyes havi km-keret beállítása')).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Felhasználó' })).not.toBeInTheDocument()
  const reports = calls.filter(call => call.path.startsWith('/api/v1/mileage/months/'))
  expect(reports).toHaveLength(2)
  expect(reports.every(call => new URL(call.path, 'https://hermes.test').searchParams.get('userId') === initial.id)).toBe(true)
})

it('keeps stale profile edits unsaved and explicitly reloads the fresh revision', async () => {
  const { state, calls } = mount()
  const dialog = await openProfile()
  state.stale = true
  state.profile = {
    ...state.profile,
    displayName: 'Másik kezelő változtatása',
    version: 9,
  }
  await userEvent.clear(within(dialog).getByLabelText('Teljes név'))
  await userEvent.type(within(dialog).getByLabelText('Teljes név'), 'Elavult szerkesztés')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Profil mentése' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('időközben megváltozott')
  expect(within(dialog).getByDisplayValue('Elavult szerkesztés')).toBeInTheDocument()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Profil újratöltése' }))
  expect(await within(dialog).findByDisplayValue('Másik kezelő változtatása')).toBeInTheDocument()
  expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1)
})

it('hides global profile actions from users with company permissions only', async () => {
  mount({ admin: false })
  await userEvent.click(await screen.findByRole('button', { name: 'Felhasználók' }))
  await screen.findByText(initial.displayName)
  await userEvent.click(screen.getByRole('button', { name: /Profil megnyitása/ }))
  await screen.findByRole('region', { name: 'Felhasználói profil' })
  expect(screen.queryByRole('button', { name: 'Profil mentése' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Rendszerkezelés' })).not.toBeInTheDocument()
  expect(screen.queryByRole('tab', { name: 'Összes felhasználó' })).not.toBeInTheDocument()
})

it('opens the global directory from Users and filters admins or accounts without company access', async () => {
  const { calls, state } = mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Felhasználók' }))
  const toggle = await screen.findByRole('switch', { name: 'Összes felhasználó' })
  expect(toggle).not.toBeChecked()
  await userEvent.click(toggle)
  expect(toggle).toBeChecked()
  expect(await screen.findByText('Nincs céges hozzáférés')).toBeInTheDocument()
  expect(calls.some((c) => new URL(c.path, 'https://hermes.test').pathname === '/api/v1/members')).toBe(true)
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Felhasználó keresése' }),
    'kiss',
  )
  expect(screen.queryByRole('button', { name: 'Keresés' })).not.toBeInTheDocument()
  await chooseOption(
    screen.getByRole('combobox', { name: 'Szűrés céges hozzáférés szerint' }),
    'none',
  )
  await waitFor(() =>
    expect(
      calls.some((c) => c.path.includes('search=kiss') && c.path.includes('access=none')),
    ).toBe(true),
  )
  state.profile = { ...state.profile, isAdministrator: true, systemPermissions: ['system.manage'] }
  await chooseOption(
    screen.getByRole('combobox', { name: 'Szűrés jogkör szerint' }),
    'admin',
  )
  expect(await screen.findByText('Rendszergazda')).toBeInTheDocument()
  await waitFor(() =>
    expect(
      calls.some(
        (c) =>
          c.path.includes('page=1') &&
          c.path.includes('role=admin') &&
          c.path.includes('access=none'),
      ),
    ).toBe(true),
  )
})

it('lists system users and shows who changed what in the central journal', async () => {
  mount()
  await userEvent.click(await screen.findByText('Beállítások'))
  await userEvent.click(screen.getByRole('button', { name: 'Rendszerkezelés' }))
  expect(screen.queryByRole('button', { name: /Profil megnyitása/ })).not.toBeInTheDocument()
  expect(await screen.findByText('user.profile_changed')).toBeInTheDocument()
  expect(screen.getByRole('cell', { name: 'anna' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('Részletek', { selector: 'summary' }))
  await waitFor(() => expect(screen.getByText(/"DisplayName": "Régi"/)).toBeInTheDocument())
})

it('keeps global user management available before the first company is created', async () => {
  mount({ noCompanies: true })
  await userEvent.click(await screen.findByRole('button', { name: 'Felhasználók' }))
  expect(
    await screen.findByRole('button', { name: `Profil megnyitása: ${initial.email}` }),
  ).toBeInTheDocument()
  expect(screen.getByText('Nincs céges hozzáférés')).toBeInTheDocument()
  expect(
    screen.queryByRole('heading', { name: 'Hozd létre az első cégedet' }),
  ).not.toBeInTheDocument()
})
