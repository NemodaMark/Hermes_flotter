import { beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { resetCsrfToken } from './api'
import type { Member, Tenant } from './api'
import { permissionNames } from './permissions'
import { invitationUrl } from './invitationLink'

const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '22222222-2222-4222-8222-222222222222'
const invitationId = '33333333-3333-4333-8333-333333333333'
const token = 'a'.repeat(43)
const acceptance = { tenantId, invitationId, token }
const allPermissions = Object.keys(permissionNames)
const user = { id: 'anna', displayName: 'Kovács Anna', email: 'anna@example.test' }
const initialMember: Member = {
  userId: 'elek',
  displayName: 'Teszt Elek',
  email: 'elek@example.test',
  isActive: true,
  version: 7,
  permissions: ['vehicles.read'],
  joinedAt: null,
  disabledAt: null,
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
type Call = {
  path: string
  method: string
  tenant: string | null
  csrf: string | null
  body: Record<string, unknown> | undefined
}

beforeEach(() => {
  resetCsrfToken()
  window.history.replaceState(null, '', '/#/vehicles')
  if (!HTMLDialogElement.prototype.showModal)
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '')
    }
  if (!HTMLDialogElement.prototype.close)
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open')
    }
})

function mount({
  permissions = allPermissions,
  signedIn = true,
  hash = '',
}: { permissions?: string[]; signedIn?: boolean; hash?: string } = {}) {
  if (hash) window.history.replaceState(null, '', hash)
  let session = signedIn ? user : null
  const companies: Tenant[] = [
    { id: tenantId, name: 'Duna', permissions },
    { id: otherTenantId, name: 'Pannon', permissions },
  ]
  let members = [{ ...initialMember }]
  const invitations: unknown[] = []
  const calls: Call[] = []
  const state = {
    permissionsFailure: null as { status: number; code: string; title: string } | null,
    statusFailure: null as { status: number; code: string; title: string } | null,
    accessVersion: 8,
    expireMutation: false,
    accepted: false,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit) => {
      const url = new URL(path, 'https://hermes.test')
      const method = options.method ?? 'GET'
      const headers = new Headers(options.headers)
      const body = options.body ? JSON.parse(options.body as string) : undefined
      calls.push({
        path,
        method,
        tenant: headers.get('X-Tenant-Id'),
        csrf: headers.get('X-CSRF-TOKEN'),
        body,
      })
      if (url.pathname.endsWith('/csrf')) return json({ requestToken: 'csrf-token' })
      if (url.pathname.endsWith('/session')) return session ? json(session) : json({}, 401)
      if (url.pathname.endsWith('/login') || url.pathname.endsWith('/register')) {
        session = user
        return json(user)
      }
      if (url.pathname.endsWith('/logout')) {
        session = null
        return new Response(null, { status: 204 })
      }
      if (state.expireMutation && method !== 'GET') {
        session = null
        return json({}, 401)
      }
      if (url.pathname === '/api/v1/tenants') return json(companies)
      if (url.pathname === '/api/v1/permissions')
        return json(allPermissions.map((code) => ({ code, name: permissionNames[code] })))
      if (url.pathname.endsWith('/permissions') && url.pathname.includes('/members/')) {
        if (method === 'GET')
          return json({
            ...members[0],
            tenantId,
            version: state.accessVersion,
            permissions: ['vehicles.create'],
          })
        if (state.permissionsFailure)
          return json(state.permissionsFailure, state.permissionsFailure.status)
        members = members.map((member) => ({
          ...member,
          permissions: body.permissions,
          version: member.version + 1,
        }))
        return json({ ...members[0], tenantId })
      }
      if (url.pathname.endsWith('/status')) {
        if (state.statusFailure) return json(state.statusFailure, state.statusFailure.status)
        members = members.map((member) => ({
          ...member,
          isActive: body.isActive,
          version: member.version + 1,
        }))
        return json({ ...members[0], tenantId })
      }
      if (url.pathname === '/api/v1/members') {
        const items =
          headers.get('X-Tenant-Id') === otherTenantId
            ? [
                {
                  ...initialMember,
                  userId: 'panni',
                  displayName: 'Pannon Panni',
                  email: 'panni@example.test',
                },
              ]
            : members
        return json({
          items,
          total: items.length,
          page: Number(url.searchParams.get('page') ?? '1'),
          pageSize: 25,
        })
      }
      if (url.pathname === '/api/v1/invitations/accept') {
        state.accepted = true
        return json({
          tenantId,
          userId: user.id,
          isActive: true,
          version: 1,
          permissions: ['vehicles.read'],
        })
      }
      if (url.pathname === '/api/v1/invitations') {
        if (method === 'GET')
          return json({ items: invitations, total: invitations.length, page: 1, pageSize: 25 })
        const invitation = {
          id: invitationId,
          email: body.email,
          permissions: body.permissions,
          createdAt: '2026-10-20T12:00:00Z',
          expiresAt: '2099-10-27T12:00:00Z',
          acceptedAt: null,
          revokedAt: null,
        }
        invitations.push(invitation)
        return json({ invitation, acceptance }, 201)
      }
      if (url.pathname.startsWith('/api/v1/invitations/') && method === 'DELETE') {
        Object.assign(invitations[0] as object, { revokedAt: '2026-10-21T12:00:00Z' })
        return new Response(null, { status: 204 })
      }
      if (url.pathname === '/api/v1/vehicles') return json([])
      if (url.pathname === '/api/v1/members/elek') return json(members[0])
      if (url.pathname.startsWith('/api/v1/people/')) {
        const target = url.pathname.endsWith('/elek') ? members[0] : user
        return json({ person: { id: 'elek', displayName: target.displayName, email: target.email, phoneNumber: null, avatarRevision: null }, version: 1, canEdit: false, canManageAccount: false, vehicles: [] })
      }
      if (url.pathname.startsWith('/health')) return json({ status: 'ready' })
      throw new Error(`Unexpected request: ${method} ${path}`)
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
  return {
    client,
    calls,
    state,
    companies,
    setMembers: (items: Member[]) => {
      members = items
    },
  }
}

async function openMembers() {
  await userEvent.click(await screen.findByRole('button', { name: 'Felhasználók' }))
  await screen.findByText('Teszt Elek')
}
async function openMemberProfile() {
  await openMembers()
  expect(screen.queryByRole('columnheader', { name: 'Műveletek' })).not.toBeInTheDocument()
  expect(screen.queryByRole('columnheader', { name: 'Hozzáférés összegzése' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('row', { name: 'Felhasználó: Teszt Elek' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Céges hozzáférések' }))
  await screen.findByRole('heading', { name: 'Céges hozzáférések' })
  await screen.findByText('1 jogosultság')
}

it('edits direct grants with the correct company, CSRF token and membership version', async () => {
  const { calls } = mount()
  await openMemberProfile()
  await userEvent.click(screen.getByRole('button', { name: 'Jogosultságok: elek@example.test' }))
  const dialog = screen.getByRole('dialog')
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Jármű felvétele' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Jogosultságok mentése' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(calls.find((call) => call.method === 'PUT')).toMatchObject({
    tenant: tenantId,
    csrf: 'csrf-token',
    body: { permissions: ['vehicles.read', 'vehicles.create'], version: 7 },
  })
  expect(await screen.findByText('2 jogosultság')).toBeInTheDocument()
})

it('keeps existing grants outside the actors delegation scope locked and unchanged', async () => {
  const { calls, setMembers } = mount({
    permissions: allPermissions.filter((code) => code !== 'vehicles.create'),
  })
  setMembers([{ ...initialMember, permissions: ['vehicles.read', 'vehicles.create'] }])
  await openMembers()
  await userEvent.click(screen.getByRole('row', { name: 'Felhasználó: Teszt Elek' }))
  await userEvent.click(await screen.findByRole('tab', { name: 'Céges hozzáférések' }))
  await screen.findByText('2 jogosultság')
  await userEvent.click(screen.getByRole('button', { name: 'Jogosultságok: elek@example.test' }))
  const dialog = screen.getByRole('dialog')
  const locked = within(dialog).getByRole('checkbox', { name: /Jármű felvétele/ })
  expect(locked).toBeChecked()
  expect(locked).toBeDisabled()
  await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Járművek megtekintése' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Jogosultságok mentése' }))
  await waitFor(() =>
    expect(calls.find((call) => call.method === 'PUT')?.body?.permissions).toEqual([
      'vehicles.create',
    ]),
  )
})

it('creates a manual invitation link without putting its secret in the HTTP query string', async () => {
  const { calls } = mount()
  await openMembers()
  await userEvent.click(screen.getByRole('button', { name: 'Felhasználó meghívása' }))
  await userEvent.type(screen.getByLabelText('E-mail-cím'), 'uj@example.test')
  await userEvent.click(screen.getByRole('checkbox', { name: 'Járművek megtekintése' }))
  await userEvent.click(screen.getByRole('button', { name: 'Meghívó létrehozása' }))
  const input = await screen.findByLabelText('Meghívási hivatkozás')
  const link = new URL((input as HTMLInputElement).value)
  expect(link.search).toBe('')
  expect(new URLSearchParams(link.hash.slice(1)).get('token')).toBe(token)
  expect(
    calls.find((call) => call.method === 'POST' && call.path === '/api/v1/invitations'),
  ).toMatchObject({
    tenant: tenantId,
    csrf: 'csrf-token',
    body: { email: 'uj@example.test', permissions: ['vehicles.read'] },
  })
  await userEvent.click(within(screen.getByRole('dialog')).getByText('Bezárás', { exact: true }))
  await userEvent.click(screen.getByRole('button', { name: 'Meghívások' }))
  expect(await screen.findByText('uj@example.test')).toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Meghívó visszavonása: uj@example.test' }),
  )
  expect(calls.some((call) => call.method === 'DELETE')).toBe(false)
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Meghívó visszavonása' }),
  )
  expect(await screen.findByText('Visszavonva')).toBeInTheDocument()
  expect(calls.find((call) => call.method === 'DELETE')).toMatchObject({
    tenant: tenantId,
    csrf: 'csrf-token',
    path: `/api/v1/invitations/${invitationId}`,
  })
})

it('allows invitation-only members to invite without reading members or assigning rights', async () => {
  const { calls } = mount({ permissions: ['members.invite'] })
  await userEvent.click(await screen.findByRole('button', { name: 'Felhasználók' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Felhasználó meghívása' }))
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('E-mail-cím'), 'uj@example.test')
  await userEvent.click(screen.getByRole('button', { name: 'Meghívó létrehozása' }))
  await screen.findByLabelText('Meghívási hivatkozás')
  expect(calls.some((call) => call.path.startsWith('/api/v1/members'))).toBe(false)
  expect(
    calls.find((call) => call.method === 'POST' && call.path === '/api/v1/invitations')?.body
      ?.permissions,
  ).toEqual([])
})

it('offers read-only member access without any mutation controls', async () => {
  const { calls } = mount({ permissions: ['members.read'] })
  await openMembers()
  expect(screen.queryByRole('button', { name: 'Felhasználó meghívása' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Jogosultságok:/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Felfüggesztés:/ })).not.toBeInTheDocument()
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Felhasználó keresése' }),
    'elek@example.test',
  )
  expect(screen.queryByRole('button', { name: 'Keresés' })).not.toBeInTheDocument()
  await waitFor(() =>
    expect(
      calls.some(
        (call) => call.path.includes('search=elek%40example.test') && call.tenant === tenantId,
      ),
    ).toBe(true),
  )
})
it('keeps permission-only management on the profile without fetching a member-reader endpoint', async () => {
  const { calls } = mount({ permissions: ['permissions.manage'], hash: '#/profile/elek' })
  await userEvent.click(await screen.findByRole('tab', { name: 'Céges hozzáférések' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Jogosultságok: elek' }))
  expect(await screen.findByRole('dialog', { name: 'Jogosultságok módosítása' })).toBeInTheDocument()
  expect(calls.some(call => call.path === '/api/v1/members/elek/permissions')).toBe(true)
  expect(calls.some(call => call.path === '/api/v1/members/elek')).toBe(false)
  expect(screen.queryByRole('button', { name: /Felfüggesztés:/ })).not.toBeInTheDocument()
})

it('confirms company-local suspension and supports reactivation using the refreshed version', async () => {
  const { calls } = mount()
  await openMemberProfile()
  await userEvent.click(screen.getByRole('button', { name: 'Felfüggesztés: elek@example.test' }))
  expect(calls.some((call) => call.method === 'PATCH')).toBe(false)
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Felfüggesztés' }),
  )
  expect(await screen.findByText('Felfüggesztve')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Visszaállítás: elek@example.test' }))
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Visszaállítás' }),
  )
  expect(await screen.findByText('Aktív')).toBeInTheDocument()
  expect(
    calls
      .filter((call) => call.method === 'PATCH')
      .map((call) => ({ tenant: call.tenant, body: call.body })),
  ).toEqual([
    { tenant: tenantId, body: { isActive: false, version: 7 } },
    { tenant: tenantId, body: { isActive: true, version: 8 } },
  ])
})

it('shows the last-manager protection error without pretending suspension succeeded', async () => {
  const { state } = mount()
  state.statusFailure = {
    status: 409,
    code: 'last_permission_manager',
    title: 'Az utolsó aktív jogosultságkezelő nem függeszthető fel.',
  }
  await openMemberProfile()
  await userEvent.click(screen.getByRole('button', { name: 'Felfüggesztés: elek@example.test' }))
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Felfüggesztés' }),
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Az utolsó aktív jogosultságkezelő')
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.queryByText('Felfüggesztve')).not.toBeInTheDocument()
})

it('reloads stale grants explicitly before retrying with the new version', async () => {
  const { state, calls } = mount()
  state.permissionsFailure = {
    status: 409,
    code: 'stale_membership',
    title: 'A tagság időközben megváltozott.',
  }
  await openMemberProfile()
  await userEvent.click(screen.getByRole('button', { name: 'Jogosultságok: elek@example.test' }))
  await userEvent.click(screen.getByRole('button', { name: 'Jogosultságok mentése' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Friss adatok betöltése' }))
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: 'Jármű felvétele' })).toBeChecked(),
  )
  expect(screen.getByRole('checkbox', { name: 'Járművek megtekintése' })).not.toBeChecked()
  state.permissionsFailure = null
  await userEvent.click(screen.getByRole('button', { name: 'Jogosultságok mentése' }))
  await waitFor(() =>
    expect(calls.filter((call) => call.method === 'PUT').at(-1)?.body).toEqual({
      permissions: ['vehicles.create'],
      version: 8,
    }),
  )
})

it('resets private editor state when the current company changes during an open dialog', async () => {
  const { calls, client } = mount()
  await openMemberProfile()
  await userEvent.click(screen.getByRole('button', { name: 'Jogosultságok: elek@example.test' }))
  // A background access refresh can remove the current company while an editor is open.
  act(() => client.setQueryData<Tenant[]>(['tenants', user.id], [{ id: otherTenantId, name: 'Pannon', permissions: allPermissions }]))
  await userEvent.click(await screen.findByRole('button', { name: 'Felhasználók' }))
  expect(await screen.findByText('Pannon Panni')).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByText('Teszt Elek')).not.toBeInTheDocument()
  expect(calls.filter((call) => call.path.startsWith('/api/v1/members')).at(-1)?.tenant).toBe(
    otherTenantId,
  )
})

it('clears private data and returns to login if a management mutation finds an expired session', async () => {
  const { state, client } = mount()
  await openMemberProfile()
  await userEvent.click(screen.getByRole('button', { name: 'Jogosultságok: elek@example.test' }))
  state.expireMutation = true
  await userEvent.click(screen.getByRole('button', { name: 'Jogosultságok mentése' }))
  expect(await screen.findByRole('heading', { name: 'Bejelentkezés' })).toBeInTheDocument()
  expect(screen.queryByText('Teszt Elek')).not.toBeInTheDocument()
  expect(
    client
      .getQueryCache()
      .getAll()
      .some((query) => query.queryKey[0] === 'members'),
  ).toBe(false)
})

it('keeps a pending invitation through login and selects its company only after explicit acceptance', async () => {
  const url = invitationUrl(acceptance)
  const { calls, state } = mount({ signedIn: false, hash: new URL(url).hash })
  expect(await screen.findByText(/Céges meghívó elfogadásához/)).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Felhasználónév vagy e-mail-cím'), user.email)
  await userEvent.type(screen.getByLabelText('Jelszó', { exact: true }), 'test-password-123')
  await userEvent.click(screen.getByRole('button', { name: 'Belépés' }))
  await screen.findByRole('heading', { name: 'Céges meghívó' })
  expect(state.accepted).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: 'Meghívó elfogadása' }))
  expect(await screen.findByRole('button', { name: 'Munkaterület váltása: Duna / Összes telephely' })).toBeInTheDocument()
  expect(window.location.hash).toBe('')
  expect(calls.find((call) => call.path === '/api/v1/invitations/accept')).toMatchObject({
    tenant: null,
    csrf: 'csrf-token',
    body: acceptance,
  })
})

it('handles incomplete invitation links without sending a malformed acceptance', async () => {
  const { calls } = mount({ hash: '#invite=1&token=bad' })
  expect(await screen.findByRole('alert')).toHaveTextContent('hiányos vagy hibás')
  expect(screen.queryByRole('button', { name: 'Meghívó elfogadása' })).not.toBeInTheDocument()
  expect(calls.some((call) => call.path === '/api/v1/invitations/accept')).toBe(false)
  await userEvent.click(screen.getByRole('button', { name: 'Meghívó bezárása' }))
  await screen.findByRole('button', { name: /Munkaterület váltása:/ })
  expect(window.location.hash).toBe('')
})
