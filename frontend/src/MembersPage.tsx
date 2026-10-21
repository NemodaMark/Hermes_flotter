import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Plus, RefreshCw } from 'lucide-react'
import { api } from './api'
import type { Invitation, Member, Session, Tenant } from './api'
import { AccessDialog } from './AccessDialog'
import { InvitationDialog, PermissionsDialog, StatusDialog } from './MemberDialogs'
import { PermissionDetails } from './PermissionDetails'
import { PeopleList } from './PeopleList'
import { UserProfilePage } from './UserProfilePage'
import './members.css'
import { ListToolbar } from './ListToolbar'
import { GroupAssignmentDialog } from './PermissionGroups'

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

export function MembersPage({ user, tenant, onProfile, mode = 'members' }: { user: Session; tenant: Tenant; onProfile?: (id: string) => void; mode?: 'members' | 'invitations' }) {
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
  const canUpdate = tenant.permissions.includes('members.update')
  const [invitePage, setInvitePage] = useState(1)
  const [dialog, setDialog] = useState<
    | { kind: 'permissions' | 'status' | 'groups'; member: Member }
    | { kind: 'invite' }
    | { kind: 'revoke'; invitation: Invitation }
    | null
  >(null)
  const [lookup, setLookup] = useState('')
  const catalog = useQuery({
    queryKey: ['permission-catalog', user.id],
    queryFn: ({ signal }) => api.permissions(signal),
    enabled: canInvite || canManage || canUpdate,
    retry: false,
  })
  const memberKey = ['members', user.id, tenant.id]
  const invitationKey = ['invitations', user.id, tenant.id]
  const invitations = useQuery({
    queryKey: [...invitationKey, invitePage],
    queryFn: ({ signal }) => api.invitations(tenant.id, invitePage, signal),
    enabled: canInvite && mode === 'invitations',
    retry: false,
  })
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['tenants', user.id] })
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['system-users', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['people-list', user.id] }),
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
  if (profileId) return <UserProfilePage id={profileId} actor={user} tenant={tenant} onBack={() => setProfileId(null)} />
  const actions = <>
    <button className="icon-button" aria-label={mode === 'invitations' ? 'Meghívások frissítése' : 'Hozzáférések frissítése'} disabled={invitations.isFetching} onClick={() => void refresh()}><RefreshCw size={17} /></button>
    {canInvite && <button className="primary-button" disabled={canManage && !catalog.isSuccess} onClick={() => setDialog({ kind: 'invite' })}><Plus size={16} />Felhasználó meghívása</button>}
  </>
  return (
    <div className="members-page">
      <section className="access-panel" aria-label={mode === 'members' ? 'Céges hozzáférések' : 'Meghívások'}>
        {mode === 'invitations' && <ListToolbar label="Meghívások műveletei" actions={actions} />}
        {catalog.isError && (
          <div className="notice error" role="alert">
            <p>A jogkatalógus nem tölthető be. {message(catalog.error)}</p>
            <button className="text-button" onClick={() => void catalog.refetch()}>
              Újrapróbálom
            </button>
          </div>
        )}
        <div>
          {mode === 'members' ? (
            <PeopleList user={user} tenant={tenant} onProfile={onProfile ?? setProfileId} catalogReady={catalog.isSuccess} actions={actions} onAction={(kind, member) => setDialog({ kind, member })} />
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
                  <table className="invitations-table responsive-list">
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
                          <td data-label="E-mail-cím">
                            <strong>{invitation.email}</strong>
                            <PermissionDetails codes={invitation.permissions} />
                          </td>
                          <td data-label="Állapot">
                            {invitation.acceptedAt
                              ? 'Elfogadva'
                              : invitation.revokedAt
                                ? 'Visszavonva'
                                : Date.parse(invitation.expiresAt) <= now
                                  ? 'Lejárt'
                                  : 'Függőben'}
                          </td>
                          <td data-label="Lejárat">{date(invitation.expiresAt)}</td>
                          <td data-label="Műveletek">
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
      {mode === 'members' && !canRead && canManage && (
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
