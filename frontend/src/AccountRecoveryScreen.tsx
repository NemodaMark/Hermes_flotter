import { useState } from 'react'
import type { FormEvent } from 'react'
import { api } from './api'
import type { AccountLink } from './accountLink'
import { Button } from './ui/Button'

export function AccountRecoveryScreen({ link, onClose }: { link: AccountLink; onClose: () => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!link.token) return
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    const confirmation = String(form.get('confirmation') ?? '')
    if (link.kind === 'reset' && password !== confirmation) { setError('A két új jelszó nem egyezik.'); return }
    setPending(true)
    setError(null)
    try {
      const result = link.kind === 'confirm' ? await api.confirmEmail(link.token)
        : await api.resetPassword(link.token, password, confirmation)
      setSuccess(result.message)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'A kérés nem sikerült.')
    } finally { setPending(false) }
  }
  return <main className="account-page">
    <header className="account-brand"><span className="brand-mark">H</span><span>HERMES<small>Flottakezelés</small></span></header>
    <section className="account-panel" aria-labelledby="recovery-title">
      <h1 id="recovery-title">{link.kind === 'confirm' ? 'E-mail-cím megerősítése' : 'Új jelszó beállítása'}</h1>
      {!link.token ? <p role="alert" className="form-error">A hivatkozás hiányos vagy érvénytelen. A bejelentkezési oldalon kérj új levelet.</p>
        : success ? <p role="status" className="access-success">{success}</p>
          : <form onSubmit={submit} className="account-form">
            <p className="account-description">{link.token.email}</p>
            {link.kind === 'reset' && <>
              <label htmlFor="reset-password">Új jelszó</label>
              <input id="reset-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={pending} />
              <p className="field-hint">Legalább 12 karakter. A korábbi bejelentkezések megszűnnek.</p>
              <label htmlFor="reset-confirmation">Új jelszó megerősítése</label>
              <input id="reset-confirmation" name="confirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={pending} />
            </>}
            {error && <p role="alert" className="form-error">{error}</p>}
            <Button className="primary-button account-submit" disabled={pending}>{pending ? 'Folyamatban…' : link.kind === 'confirm' ? 'E-mail-cím megerősítése' : 'Új jelszó mentése'}</Button>
          </form>}
      <Button type="button" disabled={pending} onClick={onClose}>Vissza a bejelentkezéshez</Button>
    </section>
  </main>
}
