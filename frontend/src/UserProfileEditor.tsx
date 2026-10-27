import { Button } from './ui/Button'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Session, UserProfile } from './api'
import './members.css'

export function UserProfileEditor({
  id,
  actor,
  section,
  active = true,
}: {
  id: string
  actor: Session
  section: 'profile' | 'security'
  active?: boolean
}) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['user-profile', actor.id, id],
    queryFn: ({ signal }) => api.userProfile(id, signal),
    staleTime: 0,
    retry: false,
  })
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<'force' | 'grant' | 'revoke' | null>(null)
  const [previousActive, setPreviousActive] = useState(active)
  if (previousActive !== active) {
    setPreviousActive(active)
    if (!active) setConfirmation(null)
  }
  const mutation = useMutation({
    mutationFn: async (
      input:
        | { kind: 'profile'; body: Parameters<typeof api.editUser>[1] }
        | { kind: 'force' | 'grant' | 'revoke'; version: number },
    ) => {
      if (input.kind === 'profile') return api.editUser(id, input.body)
      if (input.kind === 'force') return api.forcePasswordChange(id, input.version)
      return api.systemAccess(id, input.kind === 'grant', input.version)
    },
    onSuccess: async (profile) => {
      client.setQueryData(['user-profile', actor.id, id], profile)
      setConfirmation(null)
      await Promise.all([
        client.invalidateQueries({ queryKey: ['system-users'] }),
        client.invalidateQueries({ queryKey: ['people-list'] }),
        client.invalidateQueries({ queryKey: ['person-profile'] }),
        client.invalidateQueries({ queryKey: ['members'] }),
        client.invalidateQueries({ queryKey: ['system-audit'] }),
        client.invalidateQueries({ queryKey: ['session'] }),
        client.invalidateQueries({ queryKey: ['tenants'] }),
        client.invalidateQueries({ queryKey: ['profile-member'] }),
      ])
    },
  })
  async function save(input: Parameters<typeof mutation.mutateAsync>[0]) {
    setNotice(null)
    try {
      await mutation.mutateAsync(input)
      setNotice('A módosítás mentve és naplózva.')
    } catch {
      /* Render the server error below. */
    }
  }
  return (
    <section className="profile-editor" aria-label={section === 'profile' ? 'Profiladatok szerkesztése' : 'Fiókbiztonság kezelése'}>
      {query.isPending ? (
        <p>Profil betöltése…</p>
      ) : query.isError ? (
        <p className="form-error" role="alert">
          {query.error.message}
        </p>
      ) : (
        <>
          {section === 'profile' && <><p className="field-hint">
            A profiladatok minden cégnél közösek.
          </p>
          {/* A security-only revision change must not discard an unsaved profile draft. */}
          <ProfileForm
            key={JSON.stringify([query.data.id, query.data.displayName, query.data.email, query.data.phoneNumber])}
            profile={query.data}
            pending={mutation.isPending}
            save={(body) => void save({ kind: 'profile', body })}
          /></>}
          {section === 'security' && <><dl className="profile-details">
            <div>
              <dt>Jelszócsere</dt>
              <dd>
                {query.data.passwordChangeRequired
                  ? 'Kötelező a következő belépéskor'
                  : 'Nincs előírva'}
              </dd>
            </div>
            {query.data.passwordChangeRequestedAt && (
              <div>
                <dt>Elrendelve</dt>
                <dd>{new Date(query.data.passwordChangeRequestedAt).toLocaleString('hu-HU')}</dd>
              </div>
            )}
            {query.data.passwordChangedAt && (
              <div>
                <dt>Utolsó jelszócsere</dt>
                <dd>{new Date(query.data.passwordChangedAt).toLocaleString('hu-HU')}</dd>
              </div>
            )}
          </dl>
          <div className="profile-security">
            <section>
            <h3>Fiókbiztonság</h3>
            <p className="field-hint">
              A jelszó nem olvasható és nem írható át itt. A felhasználó a jelenlegi jelszavával lép
              be, majd kötelezően újat választ. A meglévő munkamenetei megszűnnek.
            </p>
            <Button
              type="button"
              className="secondary-button"
              disabled={mutation.isPending}
              onClick={() => {
                mutation.reset()
                setConfirmation('force')
              }}
            >
              Kötelező jelszócsere elrendelése
            </Button>
            </section><section>
            <h3>Rendszerszintű jogosultság</h3>
            <p className="field-hint">
              {query.data.systemPermissions.includes('system.manage')
                ? 'Van rendszerszintű kezelési joga.'
                : 'Nincs rendszerszintű kezelési joga.'}{' '}
              Ez a jog minden céghez és profilhoz hozzáférést ad, és továbbadható.
            </p>
            <Button
              type="button"
              className="secondary-button"
              disabled={mutation.isPending}
              onClick={() => {
                mutation.reset()
                setConfirmation(
                  query.data.systemPermissions.includes('system.manage') ? 'revoke' : 'grant',
                )
              }}
            >
              {query.data.systemPermissions.includes('system.manage')
                ? 'Rendszerszintű jog visszavonása'
                : 'Rendszerszintű jog megadása'}
            </Button>
            </section>
          </div>
          {confirmation && (
            <div className="profile-confirmation" role="group" aria-label="Művelet megerősítése">
              <p>
                {confirmation === 'force'
                  ? 'Elrendeled a kötelező jelszócserét minden céges hozzáférésére?'
                  : confirmation === 'grant'
                    ? 'Teljes rendszerszintű hozzáférést adsz ennek a felhasználónak?'
                    : 'Visszavonod a felhasználó rendszerszintű hozzáférését?'}
              </p>
              <div className="dialog-actions">
                <Button
                  className="secondary-button"
                  disabled={mutation.isPending}
                  onClick={() => setConfirmation(null)}
                >
                  Mégse
                </Button>
                <Button
                  className="danger-button"
                  disabled={mutation.isPending}
                  onClick={() =>
                    void save({
                      kind: confirmation,
                      version: query.data.version,
                    })
                  }
                >
                  Megerősítem
                </Button>
              </div>
            </div>
          )}
          </>}
        </>
      )}
      {mutation.isError && (
        <p role="alert" className="form-error">
          {mutation.error.message}
        </p>
      )}
      {(query.isError || mutation.isError) && (
        <Button
          className="text-button"
          disabled={mutation.isPending}
          onClick={() => {
            mutation.reset()
            setConfirmation(null)
            void query.refetch()
          }}
        >
          Profil újratöltése
        </Button>
      )}
      {notice && (
        <p className="field-hint" role="status">
          {notice}
        </p>
      )}
    </section>
  )
}

function ProfileForm({
  profile,
  pending,
  save,
}: {
  profile: UserProfile
  pending: boolean
  save: (body: Parameters<typeof api.editUser>[1]) => void
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    save({
      displayName: String(data.get('displayName')).trim(),
      email: String(data.get('email')).trim(),
      phoneNumber: String(data.get('phoneNumber')).trim() || null,
      version: profile.version,
    })
  }
  return (
    <form className="account-form" onSubmit={submit}>
      <label htmlFor="profile-name">Teljes név</label>
      <input
        id="profile-name"
        name="displayName"
        defaultValue={profile.displayName}
        required
        maxLength={120}
        disabled={pending}
        data-autofocus
      />
      <label htmlFor="profile-email">Belépési e-mail-cím</label>
      <input
        id="profile-email"
        name="email"
        type="email"
        defaultValue={profile.email}
        required
        maxLength={254}
        disabled={pending}
      />
      <p className="field-hint">
        Az e-mail módosítása minden eszközről kijelentkezteti a felhasználót.
      </p>
      <label htmlFor="profile-phone">Telefonszám</label>
      <input
        id="profile-phone"
        name="phoneNumber"
        type="tel"
        defaultValue={profile.phoneNumber ?? ''}
        maxLength={40}
        disabled={pending}
      />
      <div className="dialog-actions">
        <Button className="primary-button" disabled={pending}>
          {pending ? 'Mentés…' : 'Profil mentése'}
        </Button>
      </div>
    </form>
  )
}
