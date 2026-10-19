import { expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { resetCsrfToken } from './api'

function mountApp({ role = 'Owner', signedIn = true, expire = false } = {}) {
  resetCsrfToken()
  const user = { id: 'anna', displayName: 'Kovács Anna', email: 'anna@example.test' }
  let session = signedIn ? user : null
  let tenants = signedIn
    ? [
        { id: 'duna', name: 'Duna', role },
        { id: 'pannon', name: 'Pannon', role },
      ]
    : []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit) => {
      const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
      if (path.endsWith('/csrf')) return json({ requestToken: 'test-token' })
      if (path.endsWith('/session')) return session ? json(session) : json({}, 401)
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
          const tenant = { id: 'new-company', name: input.name, role: 'Owner' }
          tenants = [...tenants, tenant]
          return json(tenant, 201)
        }
        return json(tenants)
      }
      if (path.includes('/vehicles')) {
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

it('replaces the visible fleet when a different company is selected', async () => {
  mountApp()
  expect(await screen.findByText('DUN-001')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Munkaterület' }), 'pannon')
  expect(await screen.findByText('PAN-002')).toBeInTheDocument()
  expect(screen.queryByText('DUN-001')).not.toBeInTheDocument()
})

it('shows the fleet but does not offer vehicle creation to viewers', async () => {
  mountApp({ role: 'Viewer' })
  expect(await screen.findByText('DUN-001')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Új jármű' })).not.toBeInTheDocument()
})

it('logs in and offers company creation to a user without memberships', async () => {
  mountApp({ signedIn: false })
  await screen.findByRole('heading', { name: 'Bejelentkezés' })
  await userEvent.type(screen.getByLabelText('E-mail-cím'), 'anna@example.test')
  await userEvent.type(screen.getByLabelText('Jelszó', { exact: true }), 'test-password-123')
  await userEvent.click(screen.getByRole('button', { name: 'Belépés' }))
  expect(
    await screen.findByRole('heading', { name: 'Hozd létre az első cégedet' }),
  ).toBeInTheDocument()
})

it('takes a newly registered user through creating their first company', async () => {
  mountApp({ signedIn: false })
  await userEvent.click(await screen.findByRole('button', { name: 'Regisztráció' }))
  await userEvent.type(screen.getByLabelText('Teljes név'), 'Teszt Elek')
  await userEvent.type(screen.getByLabelText('E-mail-cím'), 'elek@example.test')
  await userEvent.type(screen.getByLabelText('Jelszó', { exact: true }), 'test-password-123')
  await userEvent.type(screen.getByLabelText('Jelszó megerősítése'), 'test-password-123')
  await userEvent.click(screen.getByRole('button', { name: 'Fiók létrehozása' }))
  await screen.findByRole('heading', { name: 'Hozd létre az első cégedet' })
  await userEvent.type(screen.getByLabelText('Cégnév'), 'Saját Flotta Kft.')
  await userEvent.click(screen.getByRole('button', { name: 'Cég létrehozása' }))
  expect(await screen.findByRole('heading', { name: 'Itt kezdődik a flotta' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Munkaterület' })).toHaveValue('new-company')
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
