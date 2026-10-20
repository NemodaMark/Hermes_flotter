import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus, RefreshCw, Search } from 'lucide-react'
import { api } from './api'
import type { Invitation, Member, Session, Tenant } from './api'
import { AccessDialog } from './AccessDialog'
import { InvitationDialog, PermissionsDialog, StatusDialog } from './MemberDialogs'
import { permissionLabel } from './permissions'
import { UserProfileDialog } from './UserProfileDialog'
import './members.css'
import { CompanyAccessGroups, CompanyGroupAssignment } from './CompanyAccessGroups'
import { PermissionGroups, GroupAssignmentDialog } from './PermissionGroups'

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'A művelet nem sikerült.'
const date = (value: string) =>
  new Date(value).toLocaleString('hu-HU', {
    dateStyle: 'short',
    timeStyle: 'short',
  })

function Pagination({
  page,
  total,
  onPage,
  pending,
}: {
  page: number
  total: number
  onPage: (page: number) => void
  pending: boolean
}) {
  return (
    <div className="table-footer access-pagination">
      <span>
        {total} találat · {page}. oldal
      </span>
      <div>
        <button
          className="secondary-button"
          onClick={() => onPage(page - 1)}
          disabled={page === 1 || pending}
        >
          Előző oldal
        </button>
        <button
          className="secondary-button"
          onClick={() => onPage(page + 1)}
          disabled={page * 25 >= total || pending}
        >
          Következő oldal
        </button>
      </div>
    </div>
  )
}

export function MembersPage({ user, tenant }: { user: Session; tenant: Tenant }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const queryClient = useQueryClient()
  const [profileId, setProfileId] = useState<string | null>(null)
  const canRead = tenant.permissions.includes('members.read')
  const canInvite = tenant.permissions.includes('members.invite')
  const canManage = tenant.permissions.includes('permissions.manage')
  const canGroups = canRead || canManage || tenant.permissions.includes('permission-groups.manage')
  const canUpdate = tenant.permissions.includes('members.update')
  const [tab, setTab] = useState<'members' | 'invitations' | 'groups' | 'company-groups'>(
    canRead ? 'members' : canInvite ? 'invitations' : canGroups ? 'groups' : 'members',
  )
  const activeTab =
    (tab === 'invitations' && !canInvite) ||
    ((tab === 'groups' || tab === 'company-groups') && !canGroups)
      ? 'members'
      : tab
  const [page, setPage] = useState(1)
  const [invitePage, setInvitePage] = useState(1)
  const [search, setSearch] = useState('')
  const [draftSearch, setDraftSearch] = useState('')
  const [dialog, setDialog] = useState<
    | { kind: 'permissions' | 'status' | 'groups' | 'company-groups'; member: Member }
    | { kind: 'invite' }
    | { kind: 'revoke'; invitation: Invitation }
    | null
  >(null)
  const [lookup, setLookup] = useState('')
  const catalog = useQuery({
    queryKey: ['permission-catalog', user.id],
    queryFn: ({ signal }) => api.permissions(signal),
    retry: false,
  })
  const memberKey = ['members', user.id, tenant.id]
  const invitationKey = ['invitations', user.id, tenant.id]
  const members = useQuery({
    queryKey: [...memberKey, page, search],
    queryFn: ({ signal }) => api.members(tenant.id, page, search, signal),
    enabled: canRead && activeTab === 'members',
    retry: false,
  })
  const invitations = useQuery({
    queryKey: [...invitationKey, invitePage],
    queryFn: ({ signal }) => api.invitations(tenant.id, invitePage, signal),
    enabled: canInvite && activeTab === 'invitations',
    retry: false,
  })
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tenants', user.id] })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: memberKey }),
      queryClient.invalidateQueries({ queryKey: invitationKey }),
      queryClient.invalidateQueries({ queryKey: ['permission-groups', user.id, tenant.id] }),
    ])
  }
  const lookupMember = useMutation({
    mutationFn: () => api.memberAccess(tenant.id, lookup.trim()),
    onSuccess: (access) =>
      setDialog({
        kind: 'permissions',
        member: {
          ...access,
          displayName: null,
          email: null,
          joinedAt: null,
          disabledAt: null,
        },
      }),
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.revokeInvitation(tenant.id, id),
  })
  async function confirmRevoke(id: string) {
    try {
      await revoke.mutateAsync(id)
      setDialog(null)
      await refresh()
    } catch {
      /* The mutation error is rendered below. */
    }
  }
  const permitted = canRead || canInvite || canManage || canUpdate || canGroups
  if (!permitted)
    return <p className="notice">Nincs jogosultságod a céges felhasználók kezeléséhez.</p>
  return (
    <div className="members-page">
      <section className="access-panel" aria-label="Céges hozzáférések">
        <div className="access-toolbar">
          <div
            className="access-tabs"
            role="tablist"
            aria-label="Felhasználókezelés"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const tabs = [
                'members',
                ...(canInvite ? ['invitations'] : []),
                ...(canGroups ? ['groups', 'company-groups'] : []),
              ] as Array<'members' | 'invitations' | 'groups' | 'company-groups'>
              const index = tabs.indexOf(activeTab)
              const next =
                event.key === 'Home'
                  ? tabs[0]
                  : event.key === 'End'
                    ? tabs[tabs.length - 1]
                    : tabs[
                        (index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length
                      ]
              setTab(next)
              event.currentTarget.querySelector<HTMLButtonElement>(`#${next}-tab`)?.focus()
            }}
          >
            <button
              id="members-tab"
              role="tab"
              aria-selected={activeTab === 'members'}
              tabIndex={activeTab === 'members' ? 0 : -1}
              aria-controls="access-panel"
              onClick={() => setTab('members')}
            >
              Céges felhasználók
            </button>
            {canInvite && (
              <button
                id="invitations-tab"
                role="tab"
                aria-selected={activeTab === 'invitations'}
                tabIndex={activeTab === 'invitations' ? 0 : -1}
                aria-controls="access-panel"
                onClick={() => setTab('invitations')}
              >
                Meghívások
              </button>
            )}
            {canGroups && (
              <button
                id="groups-tab"
                role="tab"
                aria-selected={activeTab === 'groups'}
                tabIndex={activeTab === 'groups' ? 0 : -1}
                aria-controls="access-panel"
                onClick={() => setTab('groups')}
              >
                Jogosultságcsoportok
              </button>
            )}
            {canGroups && (
              <button
                id="company-groups-tab"
                role="tab"
                aria-selected={activeTab === 'company-groups'}
                tabIndex={activeTab === 'company-groups' ? 0 : -1}
                aria-controls="access-panel"
                onClick={() => setTab('company-groups')}
              >
                Többcéges csoportok
              </button>
            )}
          </div>
          <div className="access-tools">
            <button
              className="icon-button"
              aria-label="Hozzáférések frissítése"
              disabled={members.isFetching || invitations.isFetching}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
            {canInvite && (
              <button
                className="primary-button"
                disabled={canManage && !catalog.isSuccess}
                onClick={() => setDialog({ kind: 'invite' })}
              >
                <Plus size={16} />
                Felhasználó meghívása
              </button>
            )}
          </div>
        </div>
        {catalog.isError && (
          <div className="notice error" role="alert">
            <p>A jogkatalógus nem tölthető be. {message(catalog.error)}</p>
            <button className="text-button" onClick={() => void catalog.refetch()}>
              Újrapróbálom
            </button>
          </div>
        )}
        <div id="access-panel" role="tabpanel" aria-labelledby={`${activeTab}-tab`}>
          {activeTab === 'company-groups' ? (
            <CompanyAccessGroups user={user} />
          ) : activeTab === 'groups' ? (
            <PermissionGroups
              user={user}
              tenant={tenant}
              catalog={catalog.data ?? []}
              onChanged={async () => {
                await queryClient.invalidateQueries({ queryKey: ['tenants', user.id] })
                await queryClient.invalidateQueries({ queryKey: memberKey })
              }}
            />
          ) : activeTab === 'members' ? (
            !canRead ? (
              <div className="notice">
                <p>A taglista megtekintéséhez külön hozzáférés szükséges.</p>
              </div>
            ) : (
              <>
                <form
                  className="access-search"
                  onSubmit={(event) => {
                    event.preventDefault()
                    setSearch(draftSearch.trim())
                    setPage(1)
                  }}
                >
                  <div className="search-field">
                    <Search size={18} />
                    <input
                      aria-label="Felhasználó keresése"
                      placeholder="Név vagy e-mail-cím"
                      value={draftSearch}
                      maxLength={100}
                      onChange={(event) => setDraftSearch(event.target.value)}
                    />
                  </div>
                  <button className="secondary-button">Keresés</button>
                </form>
                {members.isError ? (
                  <div className="notice error" role="alert">
                    <p>{message(members.error)}</p>
                    <button className="text-button" onClick={() => void members.refetch()}>
                      Újrapróbálom
                    </button>
                  </div>
                ) : members.isPending ? (
                  <div className="empty-state">
                    <LoaderCircle className="spinning" size={24} />
                    <p>Felhasználók betöltése…</p>
                  </div>
                ) : members.data.items.length ? (
                  <div className="table-scroll">
                    <table className="members-table">
                      <thead>
                        <tr>
                          <th>Felhasználó</th>
                          <th>Hozzáférés</th>
                          <th>Jogosultságok</th>
                          <th>Műveletek</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.data.items.map((member) => (
                          <tr key={member.userId}>
                            <td>
                              <strong>
                                {member.userId}
                                {member.userId === user.id && (
                                  <span className="self-label"> (te)</span>
                                )}
                              </strong>
                              <span className="member-email">
                                {member.displayName ?? 'Név nélküli felhasználó'}
                              </span>
                              <span className="member-email">{member.email ?? member.userId}</span>
                            </td>
                            <td>
                              <span
                                className={
                                  member.isActive
                                    ? 'status status-active'
                                    : 'status status-inactive'
                                }
                              >
                                {member.isActive ? 'Aktív' : 'Felfüggesztve'}
                              </span>
                            </td>
                            <td>
                              {!!member.groups?.length && (
                                <strong className="member-grants">
                                  Csoportok:{' '}
                                  {member.groups
                                    .map((x) =>
                                      x.isMultiCompany ? `${x.name} (többcéges)` : x.name,
                                    )
                                    .join(', ')}
                                </strong>
                              )}
                              <span className="member-grants">
                                {member.permissions.map(permissionLabel).join(', ') ||
                                  'Nincs kiosztott jog'}
                              </span>
                            </td>
                            <td>
                              <div className="member-actions">
                                {user.systemPermissions?.includes('system.manage') && (
                                  <button
                                    className="secondary-button"
                                    aria-label={`Profil megnyitása: ${member.email ?? member.userId}`}
                                    onClick={() => setProfileId(member.userId)}
                                  >
                                    Profil megnyitása
                                  </button>
                                )}
                                {canManage && (
                                  <button
                                    className="secondary-button"
                                    aria-label={`Jogosultságok: ${member.email ?? member.userId}`}
                                    disabled={!catalog.isSuccess}
                                    onClick={() => setDialog({ kind: 'permissions', member })}
                                  >
                                    Jogosultságok
                                  </button>
                                )}
                                {canManage && (
                                  <button
                                    className="secondary-button"
                                    aria-label={`Csoportok: ${member.email ?? member.userId}`}
                                    onClick={() => setDialog({ kind: 'groups', member })}
                                  >
                                    Csoportok
                                  </button>
                                )}
                                {canUpdate && (
                                  <button
                                    className={
                                      member.isActive
                                        ? 'secondary-button danger-text'
                                        : 'secondary-button'
                                    }
                                    aria-label={`${member.isActive ? 'Felfüggesztés' : 'Visszaállítás'}: ${member.email ?? member.userId}`}
                                    onClick={() => setDialog({ kind: 'status', member })}
                                  >
                                    {member.isActive ? 'Felfüggesztés' : 'Visszaállítás'}
                                  </button>
                                )}
                                {!canManage && !canUpdate && (
                                  <span className="field-hint">Megtekintés</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <h2>Nincs találat</h2>
                    <p>Próbálj másik nevet vagy e-mail-címet.</p>
                  </div>
                )}
                {members.isSuccess && (
                  <Pagination
                    page={page}
                    total={members.data.total}
                    onPage={setPage}
                    pending={members.isFetching}
                  />
                )}
              </>
            )
          ) : !canInvite ? (
            <p className="notice">Nincs jogosultságod a meghívások megtekintéséhez.</p>
          ) : invitations.isError ? (
            <div className="notice error" role="alert">
              <p>{message(invitations.error)}</p>
              <button className="text-button" onClick={() => void invitations.refetch()}>
                Újrapróbálom
              </button>
            </div>
          ) : invitations.isPending ? (
            <div className="empty-state">
              <LoaderCircle className="spinning" size={24} />
              <p>Meghívások betöltése…</p>
            </div>
          ) : (
            <>
              {invitations.data.items.length ? (
                <div className="table-scroll">
                  <table className="invitations-table">
                    <thead>
                      <tr>
                        <th>E-mail-cím</th>
                        <th>Állapot</th>
                        <th>Lejárat</th>
                        <th>Művelet</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invitations.data.items.map((invitation) => (
                        <tr key={invitation.id}>
                          <td>
                            <strong>{invitation.email}</strong>
                            <span className="member-grants">
                              {invitation.permissions.map(permissionLabel).join(', ') ||
                                'Nincs kiosztott jog'}
                            </span>
                          </td>
                          <td>
                            {invitation.acceptedAt
                              ? 'Elfogadva'
                              : invitation.revokedAt
                                ? 'Visszavonva'
                                : Date.parse(invitation.expiresAt) <= now
                                  ? 'Lejárt'
                                  : 'Függőben'}
                          </td>
                          <td>{date(invitation.expiresAt)}</td>
                          <td>
                            {!invitation.acceptedAt && !invitation.revokedAt && (
                              <button
                                className="secondary-button danger-text"
                                aria-label={`Meghívó visszavonása: ${invitation.email}`}
                                onClick={() => {
                                  revoke.reset()
                                  setDialog({ kind: 'revoke', invitation })
                                }}
                              >
                                Visszavonás
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">
                  <h2>Még nincs meghívás</h2>
                  <p>A létrehozott meghívók itt jelennek meg.</p>
                </div>
              )}
              <Pagination
                page={invitePage}
                total={invitations.data.total}
                onPage={setInvitePage}
                pending={invitations.isFetching}
              />
            </>
          )}
        </div>
      </section>
      {!canRead && canManage && (
        <section className="access-panel access-lookup">
          <h2>Kezelés felhasználóazonosítóval</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              lookupMember.mutate()
            }}
          >
            <label htmlFor="member-id">Felhasználóazonosító</label>
            <input
              id="member-id"
              required
              value={lookup}
              onChange={(event) => setLookup(event.target.value)}
              maxLength={256}
            />
            <button
              className="secondary-button"
              disabled={lookupMember.isPending || !catalog.isSuccess}
            >
              Jogosultságok betöltése
            </button>
          </form>
          {lookupMember.data && (
            <button
              className="secondary-button"
              onClick={() =>
                setDialog({
                  kind: 'groups',
                  member: {
                    ...lookupMember.data,
                    displayName: null,
                    email: null,
                    joinedAt: null,
                    disabledAt: null,
                  },
                })
              }
            >
              Felhasználó csoportjai
            </button>
          )}
          {lookupMember.isError && (
            <p className="form-error" role="alert">
              {message(lookupMember.error)}
            </p>
          )}
        </section>
      )}
      {profileId && user.systemPermissions?.includes('system.manage') && (
        <UserProfileDialog id={profileId} actor={user} onClose={() => setProfileId(null)} />
      )}
      {dialog?.kind === 'invite' && canInvite && (
        <InvitationDialog
          tenant={tenant}
          catalog={catalog.data ?? []}
          onClose={() => setDialog(null)}
          onChanged={refresh}
        />
      )}
      {dialog?.kind === 'permissions' && canManage && (
        <PermissionsDialog
          tenant={tenant}
          member={dialog.member}
          catalog={catalog.data ?? []}
          onClose={() => setDialog(null)}
          onChanged={refresh}
        />
      )}
      {dialog?.kind === 'groups' && canManage && (
        <GroupAssignmentDialog
          user={user}
          tenant={tenant}
          userId={dialog.member.userId}
          onClose={() => setDialog(null)}
          onCompanyGroups={() => setDialog({ kind: 'company-groups', member: dialog.member })}
          onChanged={refresh}
        />
      )}
      {dialog?.kind === 'company-groups' && canManage && (
        <CompanyGroupAssignment
          user={user}
          userId={dialog.member.userId}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'status' && canUpdate && (
        <StatusDialog
          tenant={tenant}
          member={dialog.member}
          onClose={() => setDialog(null)}
          onChanged={refresh}
        />
      )}
      {dialog?.kind === 'revoke' && canInvite && (
        <AccessDialog
          title="Meghívó visszavonása"
          pending={revoke.isPending}
          onClose={() => setDialog(null)}
        >
          <p className="access-description">
            A(z) <strong>{dialog.invitation.email}</strong> címre készült meghívó többé nem
            használható fel ennél a cégnél: <strong>{tenant.name}</strong>.
          </p>
          {revoke.isError && (
            <p className="form-error" role="alert">
              {message(revoke.error)}
            </p>
          )}
          <div className="dialog-actions">
            <button
              className="secondary-button"
              disabled={revoke.isPending}
              onClick={() => setDialog(null)}
            >
              Mégse
            </button>
            <button
              className="danger-button"
              disabled={revoke.isPending}
              onClick={() => void confirmRevoke(dialog.invitation.id)}
            >
              Meghívó visszavonása
            </button>
          </div>
        </AccessDialog>
      )}
    </div>
  )
}
