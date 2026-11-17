import { expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthScreen } from './AccountForms'
import { AccountRecoveryScreen } from './AccountRecoveryScreen'
import { clearAccountToken, readAccountLink } from './accountLink'
import { api, ApiError } from './api'
import * as entra from './entra'
import App from './App'

const token = { userId: 'anna', email: 'anna@example.test', token: 'secret_token' }

it('requests a reset email with the generic response and does not sign in', async () => {
  vi.spyOn(api, 'accountOptions').mockResolvedValue({ emailEnabled: true, requireEmailConfirmation: true })
  const request = vi.spyOn(api, 'requestAccountEmail').mockResolvedValue({ message: 'Ha használható fiók tartozik hozzá, elküldtük.' })
  const authenticated = vi.fn()
  render(<AuthScreen onAuthenticated={authenticated} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: 'Elfelejtett jelszó' }))
  await user.type(screen.getByLabelText('E-mail-cím'), token.email)
  await user.click(screen.getByRole('button', { name: 'Hivatkozás kérése' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Ha használható fiók')
  expect(request).toHaveBeenCalledWith(token.email, false)
  expect(authenticated).not.toHaveBeenCalled()
})

it('starts Entra login from the Microsoft button and allows retry after a failure', async () => {
  vi.spyOn(api, 'accountOptions').mockResolvedValue({ emailEnabled: true, requireEmailConfirmation: true, entraEnabled: true })
  const start = vi.spyOn(entra, 'startEntra').mockRejectedValueOnce(new Error('A Microsoft-belépés átmenetileg nem érhető el.'))
    .mockResolvedValueOnce(undefined)
  render(<AuthScreen onAuthenticated={vi.fn()} />)
  const button = screen.getByRole('button', { name: 'Bejelentkezés Microsofttal' })
  await waitFor(() => expect(button).toBeEnabled())
  const user = userEvent.setup()
  await user.click(button)
  expect(start).toHaveBeenCalledWith('login')
  expect(await screen.findByRole('alert')).toHaveTextContent('átmenetileg nem érhető el')
  await user.click(button)
  expect(start).toHaveBeenCalledTimes(2)
  expect(screen.queryByText('Regisztráció')).not.toBeInTheDocument()
})

it('keeps the Microsoft button visible with a reason when it is unavailable', async () => {
  vi.spyOn(api, 'accountOptions').mockResolvedValue({ emailEnabled: false, requireEmailConfirmation: false, entraEnabled: false })
  render(<AuthScreen onAuthenticated={vi.fn()} />)
  const button = screen.getByRole('button', { name: 'Bejelentkezés Microsofttal' })
  expect(button).toBeDisabled()
  await waitFor(() => expect(button).toHaveAccessibleDescription(/HTTPS és bekapcsolt Entra ID/))
  expect(screen.getByRole('button', { name: 'Belépés' })).toBeEnabled()
})

it('validates both new passwords and allows retry after an expired token error', async () => {
  const reset = vi.spyOn(api, 'resetPassword').mockRejectedValueOnce(new ApiError(400, 'A hivatkozás lejárt.'))
    .mockResolvedValue({ message: 'Az új jelszót elmentettük.' })
  render(<AccountRecoveryScreen link={{ kind: 'reset', token }} onClose={vi.fn()} />)
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('Új jelszó', { exact: true }), 'Long-passphrase-123')
  await user.type(screen.getByLabelText('Új jelszó megerősítése'), 'Other-passphrase-123')
  await user.click(screen.getByRole('button', { name: 'Új jelszó mentése' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('nem egyezik')
  expect(reset).not.toHaveBeenCalled()
  await user.clear(screen.getByLabelText('Új jelszó megerősítése'))
  await user.type(screen.getByLabelText('Új jelszó megerősítése'), 'Long-passphrase-123')
  await user.click(screen.getByRole('button', { name: 'Új jelszó mentése' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('lejárt')
  await user.click(screen.getByRole('button', { name: 'Új jelszó mentése' }))
  expect(await screen.findByRole('status')).toHaveTextContent('elmentettük')
})

it('requires an explicit confirmation click before consuming the token', async () => {
  const confirm = vi.spyOn(api, 'confirmEmail').mockResolvedValue({ message: 'Megerősítettük.' })
  render(<AccountRecoveryScreen link={{ kind: 'confirm', token }} onClose={vi.fn()} />)
  expect(confirm).not.toHaveBeenCalled()
  await userEvent.setup().click(screen.getByRole('button', { name: 'E-mail-cím megerősítése' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Megerősítettük')
  expect(confirm).toHaveBeenCalledWith(token)
})

it('removes account tokens from the URL even when the viewer is already signed in', async () => {
  window.history.replaceState(null, '', '/#/account/reset?' + new URLSearchParams(token))
  expect(readAccountLink()).toEqual({ kind: 'reset', token })
  vi.spyOn(api, 'session').mockResolvedValue({ id: 'anna', displayName: 'Anna', email: token.email })
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>)
  expect(await screen.findByRole('heading', { name: 'Új jelszó beállítása' })).toBeInTheDocument()
  await waitFor(() => expect(window.location.hash).toBe(''))
  expect(screen.getByText(token.email)).toBeInTheDocument()
})

it('rejects incomplete links and clears the fragment without retaining secrets', () => {
  window.history.replaceState(null, '', '/#/account/confirm?userId=anna&token=missing_email')
  expect(readAccountLink()).toEqual({ kind: 'confirm', token: null })
  clearAccountToken()
  expect(window.location.hash).toBe('')
})
