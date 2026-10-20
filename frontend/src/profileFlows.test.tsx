import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { resetCsrfToken } from './api'
import type { Session, UserProfile } from './api'
import { permissionNames } from './permissions'

const initial: UserProfile = {
  id: '01a15815-06cf-7c23-b0b4-ff9941894029',
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
  window.history.replaceState(null, '', '/')
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

function mount({ admin = true, forced = false, forceOnVehicle = false, hash = '' } = {}) {
  if (hash) window.history.replaceState(null, '', hash)
  const session: Session = {
    id: 'anna',
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
        return json([
          {
            id: 'duna',
            name: 'Duna',
            permissions: Object.keys(permissionNames),
          },
        ])
      if (url.pathname === '/api/v1/permissions')
        return json(
          Object.entries(permissionNames).map(([code, name]) => ({
            code,
            name,
          })),
        )
      if (url.pathname === '/api/v1/vehicles') {
        if (state.forceOnVehicle) {
          state.forceOnVehicle = false
          state.session.passwordChangeRequired = true
          return json({ code: 'password_change_required', title: 'Kötelező jelszócsere' }, 403)
        }
        return json([])
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
  await screen.findByDisplayValue(initial.displayName)
  return screen.getByRole('dialog', { name: 'Felhasználói profil' })
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
  expect(within(dialog).getByText(initial.id)).toBeInTheDocument()
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
  expect(screen.queryByRole('button', { name: /Profil megnyitása/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Rendszerkezelés' })).not.toBeInTheDocument()
})

it('lists system users and shows who changed what in the central journal', async () => {
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Rendszerkezelés' }))
  expect(
    await screen.findByRole('button', {
      name: `Profil megnyitása: ${initial.email}`,
    }),
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Módosítási napló' }))
  expect(await screen.findByText('user.profile_changed')).toBeInTheDocument()
  expect(screen.getByText('Módosító: anna')).toBeInTheDocument()
  fireEvent.click(screen.getByText('Részletek'))
  await waitFor(() => expect(screen.getByText(/"DisplayName": "Régi"/)).toBeInTheDocument())
})
