import { Button } from './ui/Button'
import { LiquidGlass } from './ui/LiquidGlass'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Building2, LoaderCircle, X } from 'lucide-react'
import { api } from './api'
import type { Session } from './api'
import { startEntra } from './entra'
import { LoginGarage } from './LoginGarage'

export function AuthScreen({
  onAuthenticated,
  invitationPending = false,
  entraError = null,
}: {
  onAuthenticated: (user: Session) => Promise<void>
  invitationPending?: boolean
  entraError?: string | null
}) {
  const [mode, setMode] = useState<'login' | 'forgot' | 'resend'>('login')
  const [submission, setSubmission] = useState<'local' | 'microsoft' | null>(null)
  const pending = submission !== null
  const [error, setError] = useState<string | null>(entraError)
  const [notice, setNotice] = useState<string | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [entraAvailability, setEntraAvailability] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading')
  const entraHint = {
    loading: 'A Microsoft-belépés ellenőrzése…',
    ready: null,
    unavailable: window.location.protocol === 'https:'
      ? 'A Microsoft Entra ID ezen a kiszolgálón nincs bekapcsolva.'
      : 'A Microsoft-belépéshez HTTPS és bekapcsolt Entra ID szükséges.',
    error: 'A Microsoft-belépés állapota nem ellenőrizhető. Frissítsd az oldalt.',
  }[entraAvailability]
  useEffect(() => {
    let active = true
    void api.accountOptions().then(options => {
      if (active) {
        setEmailEnabled(options.emailEnabled)
        setEntraAvailability(options.entraEnabled ? 'ready' : 'unavailable')
      }
    }).catch(() => { if (active) setEntraAvailability('error') })
    return () => { active = false }
  }, [])

  async function microsoft() {
    setError(null)
    setSubmission('microsoft')
    try { await startEntra('login') }
    catch (failure) {
      setError(failure instanceof Error ? failure.message : 'A Microsoft-bejelentkezés nem indítható.')
      setSubmission(null)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const email = String(values.get('email')).trim()
    const password = String(values.get('password'))
    setError(null)
    setNotice(null)
    setSubmission('local')
    try {
      if (mode === 'forgot' || mode === 'resend') {
        setNotice((await api.requestAccountEmail(email, mode === 'resend')).message)
        return
      }
      await onAuthenticated(await api.login(email, password))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'A kérés nem sikerült.')
    } finally {
      setSubmission(null)
    }
  }

  return (
    <main className="account-page fleet-auth">
      <LoginGarage />
      <header className="fleet-wordmark">HERMES <small>Flottakezelés</small></header>
      <div className="fleet-auth-controls">
      {invitationPending && (
        <p className="invitation-context">
          Céges meghívó elfogadásához lépj be a meghívott e-mail-címhez tartozó fiókkal. Belépés
          után itt folytathatod a csatlakozást.
        </p>
      )}
      <LiquidGlass as="section" className="account-panel" aria-labelledby="account-title">
        {mode !== 'login' && <Button type="button" variant="link" disabled={pending}
          onClick={() => { setMode('login'); setError(null); setNotice(null) }}>Vissza a bejelentkezéshez</Button>}
        <h1 id="account-title">{mode === 'login' ? 'Bejelentkezés' : mode === 'forgot' ? 'Elfelejtett jelszó' : 'E-mail-cím megerősítése'}</h1>
        {(mode === 'forgot' || mode === 'resend') && <p className="account-description">
          Add meg a fiókod e-mail-címét. A levélben kapott hivatkozással folytathatod.
        </p>}
        {notice && <p role="status" className="access-success">{notice}</p>}
        <form key={mode} onSubmit={submit} className="account-form">
          <label htmlFor="email">
            {mode === 'login' ? 'Felhasználónév vagy e-mail-cím' : 'E-mail-cím'}
          </label>
          <input
            id="email"
            name="email"
            type={mode === 'login' ? 'text' : 'email'}
            autoComplete={mode === 'login' ? 'username' : 'email'}
            required
            maxLength={254}
            disabled={pending}
          />
          {mode === 'login' && <>
          <label htmlFor="password">Jelszó</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
            disabled={pending}
          />
          </>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button className="primary-button account-submit" disabled={pending}>
            {submission === 'local' ? <LoaderCircle size={18} className="spinning" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
            {mode === 'login' ? 'Belépés' : 'Hivatkozás kérése'}
          </Button>
        </form>
        {mode === 'login' && <div className="entra-entry">
          <Button type="button" variant="outline" size="lg" disabled={pending || entraAvailability !== 'ready'}
            loading={submission === 'microsoft'} aria-describedby={entraHint ? 'entra-entry-hint' : undefined}
            iconLeft={<span className="microsoft-mark" aria-hidden="true"><i /><i /><i /><i /></span>}
            onClick={() => void microsoft()}>
            Bejelentkezés Microsofttal
          </Button>
          {entraHint && <p id="entra-entry-hint" aria-live="polite">{entraHint}</p>}
        </div>}
        {emailEnabled && <div className="dialog-actions">
          <Button type="button" variant="link" disabled={pending} onClick={() => { setMode('forgot'); setError(null); setNotice(null) }}>Elfelejtett jelszó</Button>
          <Button type="button" variant="link" disabled={pending} onClick={() => { setMode('resend'); setError(null); setNotice(null) }}>Megerősítő levél kérése</Button>
        </div>}
      </LiquidGlass>
      </div>
      <footer className="fleet-auth-footer">
        <a className="fleet-auth-credit" href={`${import.meta.env.BASE_URL}models/studio/LICENSE.md`}>Golf 8 GTI · GT Cars: Hyperspeed · CC BY 4.0</a>
      </footer>
    </main>
  )
}

export function CompanyForm({
  onSave,
  pending,
  error,
  idPrefix = 'onboarding',
  onCancel,
}: {
  onSave: (name: string) => void
  pending: boolean
  error: string | null
  idPrefix?: string
  onCancel?: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
  }, [])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSave(String(new FormData(event.currentTarget).get('name')).trim())
  }
  return (
    <form className="account-form company-form" onSubmit={submit}>
      <label htmlFor={`${idPrefix}-name`}>Cégnév</label>
      <input
        ref={input}
        id={`${idPrefix}-name`}
        name="name"
        required
        maxLength={160}
        disabled={pending}
        placeholder="Például Duna Fuvar Kft."
      />
      <p className="field-hint">
        Az új cégnél megkapod a működéshez és a jogosultságok kiosztásához szükséges jogokat.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {onCancel && (
          <Button type="button" className="secondary-button" onClick={onCancel} disabled={pending}>
            Mégse
          </Button>
        )}
        <Button className="primary-button" disabled={pending}>
          {pending ? <LoaderCircle size={18} className="spinning" /> : <Building2 size={18} />}Cég
          létrehozása
        </Button>
      </div>
    </form>
  )
}

export function CompanyDialog({
  onClose,
  ...form
}: {
  onClose: () => void
  onSave: (name: string) => void
  pending: boolean
  error: string | null
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    dialog.current?.showModal()
    dialog.current?.querySelector('input')?.focus()
  }, [])
  return (
    <dialog
      ref={dialog}
      aria-labelledby="company-title"
      onCancel={(event) => {
        if (form.pending) event.preventDefault()
        else onClose()
      }}
    >
      <div className="dialog-heading">
        <h2 id="company-title">Új cég létrehozása</h2>
        <Button
          className="icon-button"
          aria-label="Bezárás"
          onClick={onClose}
          disabled={form.pending}
        >
          <X size={20} />
        </Button>
      </div>
      <CompanyForm {...form} idPrefix="new-company" onCancel={onClose} />
    </dialog>
  )
}
