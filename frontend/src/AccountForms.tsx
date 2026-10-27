import { Button } from './ui/Button'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Building2, LoaderCircle, X } from 'lucide-react'
import { api } from './api'
import type { Session } from './api'

export function AuthScreen({
  onAuthenticated,
  invitationPending = false,
}: {
  onAuthenticated: (user: Session) => Promise<void>
  invitationPending?: boolean
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot' | 'resend'>('login')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(false)
  useEffect(() => {
    let active = true
    void api.accountOptions().then(options => { if (active) setEmailEnabled(options.emailEnabled) }).catch(() => {})
    return () => { active = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const email = String(values.get('email')).trim()
    const password = String(values.get('password'))
    if (mode === 'register' && password !== values.get('confirmation')) {
      setError('A két jelszó nem egyezik meg.')
      return
    }
    setError(null)
    setNotice(null)
    setPending(true)
    try {
      if (mode === 'forgot' || mode === 'resend') {
        setNotice((await api.requestAccountEmail(email, mode === 'resend')).message)
        return
      }
      const user =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register({
              userName: String(values.get('userName')).trim(),
              displayName: String(values.get('displayName')).trim(),
              email,
              password,
            })
      if ('requiresEmailConfirmation' in user) {
        setNotice(user.message)
        setMode('resend')
      } else await onAuthenticated(user)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'A kérés nem sikerült.')
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
      {invitationPending && (
        <p className="invitation-context">
          Céges meghívó elfogadásához lépj be vagy regisztrálj a meghívott e-mail-címmel. Belépés
          után itt folytathatod a csatlakozást.
        </p>
      )}
      <section className="account-panel" aria-labelledby="account-title">
        <div className="account-tabs" aria-label="Fiókműveletek">
          <Button
            type="button"
            className={mode === 'login' ? 'selected' : ''}
            aria-pressed={mode === 'login'}
            disabled={pending}
            onClick={() => {
              setMode('login')
              setError(null)
              setNotice(null)
            }}
          >
            Bejelentkezés
          </Button>
          <Button
            type="button"
            className={mode === 'register' ? 'selected' : ''}
            aria-pressed={mode === 'register'}
            disabled={pending}
            onClick={() => {
              setMode('register')
              setError(null)
              setNotice(null)
            }}
          >
            Regisztráció
          </Button>
        </div>
        <h1 id="account-title">{mode === 'login' ? 'Bejelentkezés' : mode === 'register' ? 'Hozd létre a fiókodat' : mode === 'forgot' ? 'Elfelejtett jelszó' : 'E-mail-cím megerősítése'}</h1>
        {(mode === 'forgot' || mode === 'resend') && <p className="account-description">
          Add meg a fiókod e-mail-címét. A levélben kapott hivatkozással folytathatod.
        </p>}
        {notice && <p role="status" className="access-success">{notice}</p>}
        <form key={mode} onSubmit={submit} className="account-form">
          {mode === 'register' && (
            <>
              <label htmlFor="userName">Felhasználónév</label>
              <input
                id="userName"
                name="userName"
                autoComplete="username"
                required
                minLength={3}
                maxLength={64}
                pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}"
                disabled={pending}
                aria-describedby="username-hint"
              />
              <p className="field-hint" id="username-hint">
                Egyedi, állandó azonosító. 3–64 karakter: angol betű, szám, pont, kötőjel vagy
                aláhúzás. A kis- és nagybetű azonosnak számít.
              </p>
              <label htmlFor="displayName">Teljes név</label>
              <input
                id="displayName"
                name="displayName"
                autoComplete="name"
                required
                maxLength={120}
                disabled={pending}
              />
            </>
          )}
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
          {(mode === 'login' || mode === 'register') && <>
          <label htmlFor="password">Jelszó</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            required
            minLength={mode === 'register' ? 12 : undefined}
            maxLength={128}
            disabled={pending}
            aria-describedby={mode === 'register' ? 'password-hint' : undefined}
          />
          {mode === 'register' && (
            <>
              <p className="field-hint" id="password-hint">
                Legalább 12 karakter. Használhatsz egy hosszabb jelmondatot is.
              </p>
              <label htmlFor="confirmation">Jelszó megerősítése</label>
              <input
                id="confirmation"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                disabled={pending}
              />
            </>
          )}
          </>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button className="primary-button account-submit" disabled={pending}>
            {pending ? <LoaderCircle size={18} className="spinning" /> : <ArrowRight size={18} />}
            {mode === 'login' ? 'Belépés' : mode === 'register' ? 'Fiók létrehozása' : 'Hivatkozás kérése'}
          </Button>
        </form>
        {emailEnabled && <div className="dialog-actions">
          <Button type="button" disabled={pending} onClick={() => { setMode('forgot'); setError(null); setNotice(null) }}>Elfelejtett jelszó</Button>
          <Button type="button" disabled={pending} onClick={() => { setMode('resend'); setError(null); setNotice(null) }}>Megerősítő levél kérése</Button>
        </div>}
      </section>
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
