import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Session } from './api'
import { UserProfileDialog } from './UserProfileDialog'
import './members.css'
import { PermissionGroups, GroupAssignmentDialog } from './PermissionGroups'

export function SystemPage({ user, usersOnly = false }: { user: Session; usersOnly?: boolean }) {
  const [tab, setTab] = useState<'users' | 'audit' | 'company-groups'>('users')
  const [page, setPage] = useState(1)
  const [roleFilter, setRoleFilter] = useState('all')
  const [accessFilter, setAccessFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const client = useQueryClient()
  const [groupUserId, setGroupUserId] = useState<string | null>(null)
  const [profileId, setProfileId] = useState<string | null>(null)
  const users = useQuery({
    queryKey: ['system-users', user.id, page, search, roleFilter, accessFilter],
    queryFn: ({ signal }) => api.systemUsers(page, search, signal, roleFilter, accessFilter),
    enabled: tab === 'users',
    retry: false,
  })
  const audit = useQuery({
    queryKey: ['system-audit', user.id, page],
    queryFn: ({ signal }) => api.systemAudit(page, signal),
    enabled: tab === 'audit',
    retry: false,
  })
  const query = tab === 'users' ? users : audit
  return (
    <section className="access-panel" aria-label="Rendszerszintű kezelés">
      <div className="access-toolbar">
        {!usersOnly && (
          <div className="access-tabs">
            <button
              aria-pressed={tab === 'users'}
              onClick={() => {
                setTab('users')
                setPage(1)
              }}
            >
              Összes felhasználó
            </button>
            <button
              aria-pressed={tab === 'audit'}
              onClick={() => {
                setTab('audit')
                setPage(1)
              }}
            >
              Módosítási napló
            </button>
            <button
              aria-pressed={tab === 'company-groups'}
              onClick={() => setTab('company-groups')}
            >
              Jogosultságcsoportok
            </button>
          </div>
        )}
        {usersOnly && (
          <p className="access-description">
            Minden regisztrált fiók, a kiválasztott cégtől függetlenül.
          </p>
        )}
        <button
          className="text-button"
          onClick={() =>
            tab === 'company-groups'
              ? void client.invalidateQueries({ queryKey: ['permission-groups', user.id] })
              : void query.refetch()
          }
        >
          Frissítés
        </button>
      </div>
      {tab === 'users' && (
        <form
          className="access-search system-user-search"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch(draft.trim())
            setPage(1)
          }}
        >
          <input
            className="system-search"
            aria-label="Felhasználó keresése rendszerszinten"
            placeholder="Felhasználónév, teljes név vagy e-mail"
            value={draft}
            maxLength={100}
            onChange={(event) => setDraft(event.target.value)}
          />
          <label>
            Jogkör
            <select
              aria-label="Szűrés jogkör szerint"
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">Minden jogkör</option>
              <option value="admin">Adminok</option>
              <option value="member">Nem adminok</option>
            </select>
          </label>
          <label>
            Céges hozzáférés
            <select
              aria-label="Szűrés céges hozzáférés szerint"
              value={accessFilter}
              onChange={(e) => {
                setAccessFilter(e.target.value)
                setPage(1)
              }}
            >
              <option value="all">Minden fiók</option>
              <option value="with">Van céges hozzáférése</option>
              <option value="none">Nincs céges hozzáférése</option>
            </select>
          </label>
          <button className="secondary-button">Keresés</button>
        </form>
      )}
      {tab === 'company-groups' ? (
        <PermissionGroups user={user} />
      ) : query.isError ? (
        <p className="notice error" role="alert">
          {query.error.message}
        </p>
      ) : query.isPending ? (
        <p className="notice">Betöltés…</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className={tab === 'users' ? 'system-users-table' : 'audit-table'}>
              {tab === 'users' ? (
                <>
                  <thead>
                    <tr>
                      <th>Felhasználó</th>
                      <th>Jogkör</th>
                      <th>Céges hozzáférés</th>
                      <th>Biztonság</th>
                      <th>Művelet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.data?.items.map((profile) => (
                      <tr key={profile.id}>
                        <td>
                          <strong>{profile.id}</strong>
                          <span className="member-email">{profile.displayName}</span>
                          <span className="member-email">{profile.email}</span>
                        </td>
                        <td>
                          <strong>
                            {profile.systemPermissions.includes('system.manage')
                              ? 'Rendszergazda'
                              : profile.isAdministrator
                                ? 'Céges admin'
                                : 'Felhasználó'}
                          </strong>
                          {(profile.companyAccess ?? []).some((c) => c.hasAccess && c.isAdmin) &&
                            !profile.systemPermissions.includes('system.manage') && (
                              <span className="member-email">
                                {profile.companyAccess
                                  ?.filter((c) => c.hasAccess && c.isAdmin)
                                  .map((c) => c.name)
                                  .join(', ')}
                              </span>
                            )}
                        </td>
                        <td>
                          {profile.systemPermissions.includes('system.manage') ? (
                            'Minden cég'
                          ) : (profile.companyAccess ?? []).some((c) => c.hasAccess) ? (
                            profile.companyAccess
                              ?.filter((c) => c.hasAccess)
                              .map((c) => c.name)
                              .join(', ')
                          ) : (
                            <span className="member-grants">Nincs céges hozzáférés</span>
                          )}
                          {(profile.companyAccess ?? [])
                            .filter((c) => c.isSuspended)
                            .map((c) => (
                              <span className="member-email" key={c.id}>
                                Felfüggesztve: {c.name}
                              </span>
                            ))}
                        </td>
                        <td>
                          {profile.systemPermissions.includes('system.manage') && (
                            <span className="member-grants">Rendszerszintű kezelési jog</span>
                          )}
                          {profile.passwordChangeRequired
                            ? 'Kötelező jelszócsere'
                            : 'Nincs előírt jelszócsere'}
                        </td>
                        <td>
                          <button
                            className="secondary-button"
                            aria-label={`Profil megnyitása: ${profile.email}`}
                            onClick={() => setProfileId(profile.id)}
                          >
                            Profil megnyitása
                          </button>
                          <button
                            className="secondary-button"
                            aria-label={`Jogosultságcsoportok: ${profile.email}`}
                            onClick={() => setGroupUserId(profile.id)}
                          >
                            Jogosultságcsoportok
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              ) : (
                <>
                  <thead>
                    <tr>
                      <th>Időpont / művelet</th>
                      <th>Módosító / érintett felhasználó</th>
                      <th>Változás</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.data?.items.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          {new Date(entry.createdAt).toLocaleString('hu-HU')}
                          <span className="member-email">{entry.action}</span>
                        </td>
                        <td>
                          <span>Módosító: {entry.actorSubject}</span>
                          <br />
                          Érintett: {entry.targetSubject ?? '–'}
                          {entry.tenantId && (
                            <span className="member-email">Cég: {entry.tenantId}</span>
                          )}
                        </td>
                        <td>
                          <details>
                            <summary>Részletek</summary>
                            <pre>{JSON.stringify(JSON.parse(entry.details), null, 2)}</pre>
                            {(entry.originalActorSubject || entry.originalTargetSubject) && (
                              <p className="field-hint">
                                Eredeti módosító ID:{' '}
                                {entry.originalActorSubject ?? entry.actorSubject}
                                <br />
                                Eredeti érintett ID:{' '}
                                {entry.originalTargetSubject ?? entry.targetSubject ?? '–'}
                              </p>
                            )}
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </table>
          </div>
          {query.data?.total === 0 && <p className="notice">Nincs találat.</p>}
          <div className="table-footer access-pagination">
            <span>
              {query.data?.total ?? 0} találat · {page}. oldal
            </span>
            <div>
              <button
                className="secondary-button"
                disabled={page === 1 || query.isFetching}
                onClick={() => setPage(page - 1)}
              >
                Előző oldal
              </button>
              <button
                className="secondary-button"
                disabled={page * 25 >= (query.data?.total ?? 0) || query.isFetching}
                onClick={() => setPage(page + 1)}
              >
                Következő oldal
              </button>
            </div>
          </div>
        </>
      )}
      {groupUserId && (
        <GroupAssignmentDialog
          user={user}
          userId={groupUserId}
          onClose={() => setGroupUserId(null)}
        />
      )}
      {profileId && (
        <UserProfileDialog id={profileId} actor={user} onClose={() => setProfileId(null)} />
      )}
    </section>
  )
}
