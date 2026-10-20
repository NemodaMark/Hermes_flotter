import { useMutation } from '@tanstack/react-query'
import { LoaderCircle } from 'lucide-react'
import { api } from './api'
import type { InvitationAcceptance, Session } from './api'
import './members.css'

export function InvitationScreen({
  request,
  user,
  onAccepted,
  onDismiss,
  onLogout,
  loggingOut,
  logoutError,
}: {
  request: InvitationAcceptance | null
  user: Session
  onAccepted: (tenantId: string) => void
  onDismiss: () => void
  onLogout: () => void
  loggingOut: boolean
  logoutError: string | null
}) {
  const mutation = useMutation({
    mutationFn: () => api.acceptInvitation(request!),
    onSuccess: (access) => onAccepted(access.tenantId),
  })
  return (
    <main className="account-page">
      <header className="account-brand">
        <span className="brand-mark">H</span>
        <span>
          HERMES<small>Flottakezelés</small>
        </span>
      </header>
      <section className="account-panel invitation-acceptance" aria-labelledby="invitation-title">
        <h1 id="invitation-title">Céges meghívó</h1>
        <p className="account-description">
          Bejelentkezve: <strong>{user.email}</strong>
        </p>
        {request ? (
          <>
            <p className="access-description">
              A meghívó elfogadásával csatlakozol a céghez, a meghívóban kiosztott jogokkal. A
              meghívónak ehhez az e-mail-címhez kell tartoznia.
            </p>
            {mutation.isError && (
              <p className="form-error" role="alert">
                {mutation.error.message}
              </p>
            )}
            <button
              className="primary-button account-submit"
              disabled={mutation.isPending || loggingOut}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending && <LoaderCircle size={16} className="spinning" />}Meghívó
              elfogadása
            </button>
          </>
        ) : (
          <p className="form-error" role="alert">
            A meghívási hivatkozás hiányos vagy hibás. Kérj új hivatkozást a meghívó küldőjétől.
          </p>
        )}
        {logoutError && (
          <p className="form-error" role="alert">
            {logoutError}
          </p>
        )}
        <div className="invitation-account-actions">
          <button
            className="text-button"
            disabled={mutation.isPending || loggingOut}
            onClick={onLogout}
          >
            Másik fiókkal lépek be
          </button>
          <button
            className="text-button"
            disabled={mutation.isPending || loggingOut}
            onClick={onDismiss}
          >
            Meghívó bezárása
          </button>
        </div>
      </section>
    </main>
  )
}
