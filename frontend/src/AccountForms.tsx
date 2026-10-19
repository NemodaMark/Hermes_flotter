import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Building2, LoaderCircle, X } from 'lucide-react'
import { api } from './api'
import type { Session } from './api'

export function AuthScreen({
  onAuthenticated,
}: {
  onAuthenticated: (user: Session) => Promise<void>
}) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    setPending(true)
    try {
      const user =
        mode === 'login'
          ? await api.login(email, password)
          : await api.register({
              displayName: String(values.get('displayName')).trim(),
              email,
              password,
            })
      await onAuthenticated(user)
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
      <section className="account-panel" aria-labelledby="account-title">
        <div className="account-tabs" aria-label="Fiókműveletek">
          <button
            type="button"
            className={mode === 'login' ? 'selected' : ''}
            aria-pressed={mode === 'login'}
            disabled={pending}
            onClick={() => {
              setMode('login')
              setError(null)
            }}
          >
            Bejelentkezés
          </button>
          <button
            type="button"
            className={mode === 'register' ? 'selected' : ''}
            aria-pressed={mode === 'register'}
            disabled={pending}
            onClick={() => {
              setMode('register')
              setError(null)
            }}
          >
            Regisztráció
          </button>
        </div>
        <h1 id="account-title">{mode === 'login' ? 'Bejelentkezés' : 'Hozd létre a fiókodat'}</h1>
        <p className="account-description">
          {mode === 'login'
            ? 'Lépj be a céges munkaterületeidhez.'
            : 'Egy fiókkal több cég flottáját is kezelheted.'}
        </p>
        <form key={mode} onSubmit={submit} className="account-form">
          {mode === 'register' && (
            <>
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
          <label htmlFor="email">E-mail-cím</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            required
            maxLength={254}
            disabled={pending}
          />
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
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button account-submit" disabled={pending}>
            {pending ? <LoaderCircle size={18} className="spinning" /> : <ArrowRight size={18} />}
            {mode === 'login' ? 'Belépés' : 'Fiók létrehozása'}
          </button>
        </form>
        {mode === 'register' && (
          <p className="account-note">A következő lépésben létrehozhatod az első cégedet.</p>
        )}
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
      <p className="field-hint">Az új cégnél tulajdonosi hozzáférést kapsz.</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        {onCancel && (
          <button type="button" className="secondary-button" onClick={onCancel} disabled={pending}>
            Mégse
          </button>
        )}
        <button className="primary-button" disabled={pending}>
          {pending ? <LoaderCircle size={18} className="spinning" /> : <Building2 size={18} />}Cég
          létrehozása
        </button>
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
        <button
          className="icon-button"
          aria-label="Bezárás"
          onClick={onClose}
          disabled={form.pending}
        >
          <X size={20} />
        </button>
      </div>
      <CompanyForm {...form} idPrefix="new-company" onCancel={onClose} />
    </dialog>
  )
}
