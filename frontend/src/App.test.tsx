import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'

function mountFleet(role = 'Owner') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, options: RequestInit) => {
      const tenantId = new Headers(options.headers).get('X-Tenant-Id')
      const data = path.includes('/tenants')
        ? [
            { id: 'duna', name: 'Duna', role },
            { id: 'pannon', name: 'Pannon', role },
          ]
        : path.includes('/vehicles')
          ? [
              {
                id: 'vehicle',
                registration: tenantId === 'duna' ? 'DUN-001' : 'PAN-002',
                make: 'Ford',
                model: 'Focus',
                status: 'Active',
              },
            ]
          : { status: 'ready' }
      return new Response(JSON.stringify(data), { status: 200 })
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

it('replaces the visible fleet when a different company is selected', async () => {
  mountFleet()
  expect(await screen.findByText('DUN-001')).toBeInTheDocument()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Munkaterület' }), 'pannon')
  expect(await screen.findByText('PAN-002')).toBeInTheDocument()
  expect(screen.queryByText('DUN-001')).not.toBeInTheDocument()
})

it('shows the fleet but does not offer vehicle creation to viewers', async () => {
  mountFleet('Viewer')
  expect(await screen.findByText('DUN-001')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Új jármű' })).not.toBeInTheDocument()
})
