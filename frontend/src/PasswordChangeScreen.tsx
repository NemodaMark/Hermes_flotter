import { Button } from './ui/Button'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import type { Session } from './api'

export function PasswordChangeScreen({
  user,
  onChanged,
  onLogout,
  loggingOut,
  logoutError,
}: {
  user: Session
  onChanged: (user: Session) => Promise<void>
  onLogout: () => void
  loggingOut: boolean
  logoutError: string | null
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const current = String(values.get('currentPassword'))
    const password = String(values.get('newPassword'))
    const confirmation = String(values.get('confirmPassword'))
    if (password !== confirmation) {
      setError('A két új jelszó nem egyezik.')
      return
    }
    if (password === current) {
      setError('Az új jelszó térjen el a jelenlegitől.')
      return
    }
    setError(null)
    setPending(true)
    try {
      const session = await api.changePassword(current, password, confirmation)
      form.reset()
      await onChanged(session)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'A jelszócsere nem sikerült.')
    } finally {
      setPending(false)
    }
  }
  return (
    <main className="account-page">
      <header className="account-brand">
        <span className="brand-mark">H</span>
        <span>
          HERMES<small>Flottakezelés</small>
        </span>
      </header>
      <section className="account-panel" aria-labelledby="password-change-title">
        <h1 id="password-change-title">Kötelező jelszócsere</h1>
        <p className="account-description">
          {user.id} · {user.email}
          <br />A rendszer kezelője jelszócserét kért. A folytatáshoz adj meg egy új jelszót.
        </p>
        <form className="account-form" onSubmit={submit}>
          <label htmlFor="currentPassword">Jelenlegi jelszó</label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={pending || loggingOut}
          />
          <label htmlFor="newPassword">Új jelszó</label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            aria-describedby="password-change-hint"
            disabled={pending || loggingOut}
          />
          <p id="password-change-hint" className="field-hint">
            12–128 karakter, a jelenlegi jelszótól eltérően.
          </p>
          <label htmlFor="confirmPassword">Új jelszó megerősítése</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            disabled={pending || loggingOut}
          />
          {(error || logoutError) && (
            <p className="form-error" role="alert">
              {error || logoutError}
            </p>
          )}
          <Button className="primary-button account-submit" disabled={pending || loggingOut}>
            {pending ? 'Mentés…' : 'Jelszó megváltoztatása'}
          </Button>
        </form>
        <Button className="text-button" onClick={onLogout} disabled={pending || loggingOut}>
          Kijelentkezés
        </Button>
      </section>
    </main>
  )
}
