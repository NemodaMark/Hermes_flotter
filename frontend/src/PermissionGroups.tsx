import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from './api'
import type { MemberAccess, Permission, PermissionGroup, Session, Tenant } from './api'
import { AccessDialog } from './AccessDialog'
import { PermissionFields } from './MemberDialogs'
import { permissionLabel } from './permissions'

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'A művelet nem sikerült.'

export function PermissionGroups({
  user,
  tenant,
  catalog,
  onChanged,
}: {
  user: Session
  tenant: Tenant
  catalog: Permission[]
  onChanged: () => Promise<void>
}) {
  const client = useQueryClient()
  const key = ['permission-groups', user.id, tenant.id]
  const groups = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => api.groups(tenant.id, signal),
    retry: false,
  })
  const [dialog, setDialog] = useState<
    { kind: 'edit' | 'delete'; group: PermissionGroup } | { kind: 'create' } | null
  >(null)
  const canManage = tenant.permissions.includes('permission-groups.manage')
  async function refresh() {
    await client.invalidateQueries({ queryKey: key })
    await onChanged()
  }
  return (
    <div className="groups-content">
      <div className="access-toolbar">
        <p className="access-description">
          A csoport jogai minden hozzárendelt felhasználóra érvényesek.
        </p>
        {canManage && (
          <button
            className="primary-button"
            disabled={!catalog.length || !groups.isSuccess}
            onClick={() => setDialog({ kind: 'create' })}
          >
            Új csoport
          </button>
        )}
      </div>
      {groups.isPending && (
        <p className="notice" role="status">
          Csoportok betöltése…
        </p>
      )}
      {groups.isError && (
        <div className="notice error" role="alert">
          {message(groups.error)}{' '}
          <button className="text-button" onClick={() => void groups.refetch()}>
            Újrapróbálom
          </button>
        </div>
      )}
      {groups.isSuccess && (
        <div className="table-scroll">
          <table className="groups-table">
            <thead>
              <tr>
                <th>Csoport</th>
                <th>Jogosultságok</th>
                <th>Tagok</th>
                <th>Művelet</th>
              </tr>
            </thead>
            <tbody>
              {groups.data.map((group) => (
                <tr key={group.id}>
                  <td>
                    <strong>{group.name}</strong>
                    {group.isAdmin && (
                      <small className="member-grants">Minden jelenlegi és későbbi céges jog</small>
                    )}
                  </td>
                  <td>
                    <span className="member-grants">
                      {group.permissions.map(permissionLabel).join(', ') || 'Nincs kiosztott jog'}
                    </span>
                  </td>
                  <td>{group.memberCount}</td>
                  <td>
                    {group.isAdmin ? (
                      <span className="field-hint">Automatikusan kezelt</span>
                    ) : canManage ? (
                      <div className="row-actions">
                        <button
                          className="secondary-button"
                          onClick={() => setDialog({ kind: 'edit', group })}
                          aria-label={`Csoport szerkesztése: ${group.name}`}
                        >
                          Szerkesztés
                        </button>
                        <button
                          className="secondary-button danger-text"
                          onClick={() => setDialog({ kind: 'delete', group })}
                          aria-label={`Csoport törlése: ${group.name}`}
                        >
                          Törlés
                        </button>
                      </div>
                    ) : (
                      <span className="field-hint">Megtekintés</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <GroupEditor
          tenant={tenant}
          catalog={catalog}
          group={dialog.kind === 'edit' ? dialog.group : undefined}
          onClose={() => setDialog(null)}
          onChanged={refresh}
        />
      )}
      {dialog?.kind === 'delete' && (
        <DeleteGroup
          tenant={tenant}
          group={dialog.group}
          onClose={() => setDialog(null)}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

function GroupEditor({
  tenant,
  catalog,
  group,
  onClose,
  onChanged,
}: {
  tenant: Tenant
  catalog: Permission[]
  group?: PermissionGroup
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [permissions, setPermissions] = useState(group?.permissions ?? [])
  const save = useMutation({
    mutationFn: () =>
      group
        ? api.updateGroup(tenant.id, group.id, name.trim(), permissions, group.version)
        : api.createGroup(tenant.id, name.trim(), permissions),
  })
  return (
    <AccessDialog
      title={group ? 'Csoport szerkesztése' : 'Új jogosultságcsoport'}
      pending={save.isPending}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save
            .mutateAsync()
            .then(async () => {
              onClose()
              await onChanged()
            })
            .catch(() => {})
        }}
      >
        <p className="access-description">
          {tenant.name}
          {group && ' · A változás minden csoporttag jogait módosítja.'}
        </p>
        <label htmlFor="group-name">Csoport neve</label>
        <input
          id="group-name"
          data-autofocus
          required
          maxLength={80}
          value={name}
          disabled={save.isPending}
          onChange={(e) => setName(e.target.value)}
        />
        <PermissionFields
          catalog={catalog}
          selected={permissions}
          available={tenant.permissions}
          onChange={setPermissions}
          disabled={save.isPending}
        />
        {save.isError && (
          <p className="form-error" role="alert">
            {message(save.error)}
          </p>
        )}
        {save.error instanceof ApiError && save.error.status === 409 && (
          <p className="field-hint">
            Zárd be az ablakot, frissítsd a listát, majd nyisd meg újra a csoportot.
          </p>
        )}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={save.isPending}
            onClick={onClose}
          >
            Mégse
          </button>
          <button className="primary-button" disabled={save.isPending}>
            Csoport mentése
          </button>
        </div>
      </form>
    </AccessDialog>
  )
}

function DeleteGroup({
  tenant,
  group,
  onClose,
  onChanged,
}: {
  tenant: Tenant
  group: PermissionGroup
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const remove = useMutation({
    mutationFn: () => api.deleteGroup(tenant.id, group.id, group.version),
  })
  return (
    <AccessDialog title="Csoport törlése" pending={remove.isPending} onClose={onClose}>
      <p className="access-description">
        <strong>{group.name}</strong> · {tenant.name}
      </p>
      <p>
        A törlés {group.memberCount} felhasználótól vonja vissza a csoportból kapott jogokat. Más
        csoportjaik és egyedi jogaik megmaradnak.
      </p>
      {remove.isError && (
        <p className="form-error" role="alert">
          {message(remove.error)}
        </p>
      )}
      <div className="dialog-actions">
        <button className="secondary-button" disabled={remove.isPending} onClick={onClose}>
          Mégse
        </button>
        <button
          className="danger-button"
          disabled={remove.isPending}
          onClick={() =>
            void remove
              .mutateAsync()
              .then(async () => {
                onClose()
                await onChanged()
              })
              .catch(() => {})
          }
        >
          Csoport törlése
        </button>
      </div>
    </AccessDialog>
  )
}

export function GroupAssignmentDialog({
  user,
  tenant,
  userId,
  onClose,
  onChanged,
  onCompanyGroups,
}: {
  user: Session
  tenant: Tenant
  userId: string
  onClose: () => void
  onChanged: () => Promise<void>
  onCompanyGroups?: () => void
}) {
  const data = useQuery({
    queryKey: ['group-assignment', user.id, tenant.id, userId],
    queryFn: async ({ signal }) => {
      const [access, groups] = await Promise.all([
        api.memberAccess(tenant.id, userId, signal),
        api.groups(tenant.id, signal),
      ])
      return { access, groups }
    },
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
  const [pending, setPending] = useState(false)
  return (
    <AccessDialog title="Felhasználó csoportjai" pending={pending} onClose={onClose}>
      <p className="access-description">
        <strong>{userId}</strong> · {tenant.name}
      </p>
      {data.isPending && <p role="status">Csoportok betöltése…</p>}
      {data.isError && (
        <p className="form-error" role="alert">
          {message(data.error)}
        </p>
      )}
      {data.isSuccess && !data.isFetching && (
        <AssignmentFields
          key={data.dataUpdatedAt}
          tenant={tenant}
          access={data.data.access}
          groups={data.data.groups}
          onPending={setPending}
          onClose={onClose}
          onChanged={onChanged}
        />
      )}
      {onCompanyGroups && (
        <button
          type="button"
          className="secondary-button"
          disabled={pending}
          onClick={onCompanyGroups}
        >
          Többcéges csoportok
        </button>
      )}
      {!pending && (
        <button type="button" className="text-button" onClick={() => void data.refetch()}>
          Friss adatok betöltése
        </button>
      )}
    </AccessDialog>
  )
}

function AssignmentFields({
  tenant,
  access,
  groups,
  onPending,
  onClose,
  onChanged,
}: {
  tenant: Tenant
  access: MemberAccess
  groups: PermissionGroup[]
  onPending: (value: boolean) => void
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [selected, setSelected] = useState(
    access.groups?.filter((x) => !x.isMultiCompany).map((x) => x.id) ?? [],
  )
  const save = useMutation({
    mutationFn: () => api.assignGroups(tenant.id, access.userId, selected, access.version),
  })
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onPending(true)
        void save
          .mutateAsync()
          .then(async () => {
            onClose()
            await onChanged()
          })
          .catch(() => {})
          .finally(() => onPending(false))
      }}
    >
      <fieldset className="permission-fields" disabled={save.isPending}>
        <legend>Csoporttagságok</legend>
        {groups.map((group) => (
          <label className="permission-option" key={group.id}>
            <input
              type="checkbox"
              checked={selected.includes(group.id)}
              disabled={group.permissions.some((code) => !tenant.permissions.includes(code))}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, group.id]
                    : selected.filter((id) => id !== group.id),
                )
              }
            />
            <span>
              {group.name}
              <small>
                {group.isAdmin
                  ? 'Minden jelenlegi és későbbi céges jog'
                  : group.permissions.map(permissionLabel).join(', ') || 'Nincs kiosztott jog'}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="field-hint">
        A csoportok és az egyedi jogok összeadódnak. Az admin tagságot céges admin vagy
        rendszergazda módosíthatja.
      </p>
      {save.isError && (
        <p className="form-error" role="alert">
          {message(save.error)}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={save.isPending}
          onClick={onClose}
        >
          Mégse
        </button>
        <button className="primary-button" disabled={save.isPending}>
          Csoporttagság mentése
        </button>
      </div>
    </form>
  )
}
