import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type {
  CompanyAccessDraft,
  CompanyAccessGroup,
  CompanyAccessOption,
  CompanyAccessUser,
  Permission,
  Session,
} from './api'
import { AccessDialog } from './AccessDialog'
import { PermissionFields } from './MemberDialogs'
import { permissionLabel } from './permissions'

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'A művelet nem sikerült.'

export function CompanyAccessGroups({ user }: { user: Session }) {
  const client = useQueryClient()
  const [dialog, setDialog] = useState<
    { kind: 'edit' | 'delete'; group: CompanyAccessGroup } | { kind: 'create' } | null
  >(null)
  const data = useQuery({
    queryKey: ['company-access-groups', user.id],
    queryFn: async ({ signal }) => {
      const [groups, companies, catalog] = await Promise.all([
        api.companyAccessGroups(signal),
        api.companyAccessOptions(signal),
        api.permissions(signal),
      ])
      return { groups, companies, catalog }
    },
    retry: false,
  })
  async function refresh() {
    await Promise.all(
      ['company-access-groups', 'tenants', 'members', 'system-audit'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    )
  }
  return (
    <div>
      <div className="access-toolbar">
        <p className="access-description">
          A csoporttagok a kijelölt cégekhez kapnak hozzáférést, a megadott jogokkal.
        </p>
        <div className="member-actions">
          <button className="text-button" onClick={() => void data.refetch()}>
            Csoportlista frissítése
          </button>
          {data.data?.companies.some((c) => c.canEdit) && (
            <button className="primary-button" onClick={() => setDialog({ kind: 'create' })}>
              Új többcéges csoport
            </button>
          )}
        </div>
      </div>
      {data.isPending && (
        <p className="notice" role="status">
          Többcéges csoportok betöltése…
        </p>
      )}
      {data.isError && (
        <p className="notice error" role="alert">
          {message(data.error)}
        </p>
      )}
      {data.isSuccess && (
        <>
          {data.data.groups.length ? (
            <div className="table-scroll">
              <table className="groups-table">
                <thead>
                  <tr>
                    <th>Csoport</th>
                    <th>Cégek</th>
                    <th>Jogosultságok</th>
                    <th>Tagok</th>
                    <th>Művelet</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.groups.map((group) => (
                    <tr key={group.id}>
                      <td>
                        <strong>{group.name}</strong>
                        <span className="member-email">Létrehozó: {group.createdBy}</span>
                      </td>
                      <td>{group.companies.map((c) => c.name).join(', ')}</td>
                      <td>
                        <span className="member-grants">
                          {group.allPermissions
                            ? 'Minden jelenlegi és későbbi céges jog'
                            : group.permissions.map(permissionLabel).join(', ') ||
                              'Nincs kiosztott jog'}
                        </span>
                      </td>
                      <td>{group.memberCount}</td>
                      <td>
                        {group.canEdit ? (
                          <div className="member-actions">
                            <button
                              className="secondary-button"
                              aria-label={`Többcéges csoport szerkesztése: ${group.name}`}
                              onClick={() => setDialog({ kind: 'edit', group })}
                            >
                              Szerkesztés
                            </button>
                            <button
                              className="secondary-button danger-text"
                              aria-label={`Többcéges csoport törlése: ${group.name}`}
                              onClick={() => setDialog({ kind: 'delete', group })}
                            >
                              Törlés
                            </button>
                          </div>
                        ) : (
                          'Megtekintés'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="notice">
              Nincs megjeleníthető többcéges csoport.
            </p>
          )}
          <p className="notice">
            A felhasználó sorában a Csoportok → Többcéges csoportok gombbal osztható ki. Új cég
            hozzáadása a meglévő csoporttagokra is érvényes.
          </p>
          {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
            <CompanyGroupEditor
              group={dialog.kind === 'edit' ? dialog.group : undefined}
              companies={data.data.companies}
              catalog={data.data.catalog}
              onClose={() => setDialog(null)}
              onChanged={refresh}
            />
          )}
          {dialog?.kind === 'delete' && (
            <CompanyGroupDelete
              group={dialog.group}
              onClose={() => setDialog(null)}
              onChanged={refresh}
            />
          )}
        </>
      )}
    </div>
  )
}

function CompanyGroupEditor({
  group,
  companies,
  catalog,
  onClose,
  onChanged,
}: {
  group?: CompanyAccessGroup
  companies: CompanyAccessOption[]
  catalog: Permission[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [ids, setIds] = useState(group?.companies.map((x) => x.id) ?? [])
  const [permissions, setPermissions] = useState(
    group?.allPermissions ? [] : (group?.permissions ?? []),
  )
  const [allPermissions, setAll] = useState(group?.allPermissions ?? false)
  const eligible = companies.filter((c) => c.canEdit && (!group?.memberCount || c.canAssign))
  const selected = companies.filter((c) => ids.includes(c.id))
  const available = catalog
    .map((x) => x.code)
    .filter((code) => selected.length > 0 && selected.every((c) => c.permissions.includes(code)))
  const canAll = selected.length > 0 && selected.every((c) => c.canGrantAll)
  const save = useMutation({
    mutationFn: () => {
      const body: CompanyAccessDraft = {
        name: name.trim(),
        permissions: allPermissions ? [] : permissions,
        companyIds: ids,
        allPermissions,
      }
      return group
        ? api.updateCompanyAccessGroup(group.id, { ...body, version: group.version })
        : api.createCompanyAccessGroup(body)
    },
  })
  function selectCompanies(next: string[]) {
    setIds(next)
    const choices = companies.filter((c) => next.includes(c.id))
    setPermissions((values) =>
      values.filter(
        (code) => choices.length > 0 && choices.every((c) => c.permissions.includes(code)),
      ),
    )
    if (!choices.length || choices.some((c) => !c.canGrantAll)) setAll(false)
  }
  return (
    <AccessDialog
      title={group ? 'Többcéges csoport szerkesztése' : 'Új többcéges csoport'}
      pending={save.isPending}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void save
            .mutateAsync()
            .then(async () => {
              onClose()
              await onChanged()
            })
            .catch(() => {})
        }}
      >
        <label htmlFor="company-group-name">Csoport neve</label>
        <input
          id="company-group-name"
          data-autofocus
          required
          maxLength={80}
          value={name}
          disabled={save.isPending}
          onChange={(e) => setName(e.target.value)}
        />
        <fieldset className="permission-fields company-options" disabled={save.isPending}>
          <legend>Hozzáférés ezekhez a cégekhez</legend>
          {eligible.map((company) => (
            <label className="permission-option" key={company.id}>
              <input
                type="checkbox"
                checked={ids.includes(company.id)}
                onChange={(e) =>
                  selectCompanies(
                    e.target.checked ? [...ids, company.id] : ids.filter((id) => id !== company.id),
                  )
                }
              />
              <span>{company.name}</span>
            </label>
          ))}
        </fieldset>
        {!ids.length && <p className="field-hint">Válassz legalább egy céget.</p>}
        <label className="permission-option">
          <input
            type="checkbox"
            checked={allPermissions}
            disabled={save.isPending || !canAll}
            onChange={(e) => setAll(e.target.checked)}
          />
          <span>
            Minden jelenlegi és későbbi céges jog
            <small>Csak a kijelölt cégek adminjai oszthatják ki.</small>
          </span>
        </label>
        {!allPermissions && ids.length > 0 && (
          <PermissionFields
            catalog={catalog}
            selected={permissions}
            available={available}
            onChange={setPermissions}
            disabled={save.isPending || !ids.length}
          />
        )}
        <p className="field-hint">
          Csak minden kijelölt cégnél kiosztható jogot választhatsz. Cégek kivétele a csoporttagok
          hozzáférését is visszavonja; a külön kiosztott jogaik megmaradnak.
        </p>
        {save.isError && (
          <p className="form-error" role="alert">
            {message(save.error)} Zárd be az ablakot és frissítsd a listát, ha az adatok időközben
            megváltoztak.
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
          <button className="primary-button" disabled={save.isPending || !ids.length}>
            Többcéges csoport mentése
          </button>
        </div>
      </form>
    </AccessDialog>
  )
}
function CompanyGroupDelete({
  group,
  onClose,
  onChanged,
}: {
  group: CompanyAccessGroup
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const remove = useMutation({
    mutationFn: () => api.deleteCompanyAccessGroup(group.id, group.version),
  })
  return (
    <AccessDialog title="Többcéges csoport törlése" pending={remove.isPending} onClose={onClose}>
      <p>
        <strong>{group.name}</strong>
      </p>
      <p>
        {group.memberCount} felhasználó csoportból kapott hozzáférése szűnik meg ezeknél a cégeknél:{' '}
        {group.companies.map((x) => x.name).join(', ')}.
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
          Többcéges csoport törlése
        </button>
      </div>
    </AccessDialog>
  )
}

export function CompanyGroupAssignment({
  user,
  userId,
  onClose,
}: {
  user: Session
  userId: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const [pending, setPending] = useState(false)
  const data = useQuery({
    queryKey: ['company-group-user', user.id, userId],
    queryFn: async ({ signal }) => {
      const [groups, access] = await Promise.all([
        api.companyAccessGroups(signal),
        api.companyAccessUser(userId, signal),
      ])
      return { groups: groups.filter((x) => x.canAssign), access }
    },
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
  })
  async function refresh() {
    await Promise.all(
      [
        'tenants',
        'members',
        'company-access-groups',
        'system-users',
        'user-profile',
        'system-audit',
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    )
  }
  return (
    <AccessDialog title="Felhasználó többcéges csoportjai" pending={pending} onClose={onClose}>
      <p className="access-description">
        <strong>{userId}</strong>
      </p>
      {data.isPending && <p role="status">Csoportok betöltése…</p>}
      {data.isError && (
        <p className="form-error" role="alert">
          {message(data.error)}
        </p>
      )}
      {data.isSuccess && !data.isFetching && (
        <CompanyAssignmentFields
          key={data.dataUpdatedAt}
          groups={data.data.groups}
          access={data.data.access}
          onPending={setPending}
          onChanged={refresh}
          onClose={onClose}
        />
      )}
      <button
        type="button"
        className="text-button"
        disabled={pending || data.isFetching}
        onClick={() => void data.refetch()}
      >
        Csoporttagságok újratöltése
      </button>
    </AccessDialog>
  )
}
function CompanyAssignmentFields({
  groups,
  access,
  onPending,
  onChanged,
  onClose,
}: {
  groups: CompanyAccessGroup[]
  access: CompanyAccessUser
  onPending: (value: boolean) => void
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const [ids, setIds] = useState(access.groupIds)
  const save = useMutation({
    mutationFn: () => api.assignCompanyAccessGroups(access.userId, ids, access.version),
  })
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
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
        <legend>Többcéges csoporttagságok</legend>
        {groups.map((group) => (
          <label className="permission-option" key={group.id}>
            <input
              type="checkbox"
              checked={ids.includes(group.id)}
              onChange={(e) =>
                setIds(e.target.checked ? [...ids, group.id] : ids.filter((id) => id !== group.id))
              }
            />
            <span>
              {group.name}
              <small>Cégek: {group.companies.map((x) => x.name).join(', ')}</small>
              <small>
                {group.allPermissions
                  ? 'Minden jelenlegi és későbbi céges jog'
                  : group.permissions.map(permissionLabel).join(', ') || 'Nincs kiosztott jog'}
              </small>
            </span>
          </label>
        ))}
      </fieldset>
      {!groups.length && (
        <p className="notice">
          Nincs általad minden cégénél kiosztható csoport. Először hozz létre egyet a Többcéges
          csoportok fülön.
        </p>
      )}
      {access.hasOtherGroups && (
        <p className="field-hint">Más, általad nem kezelhető csoporttagságok megmaradnak.</p>
      )}
      <p className="field-hint">
        A kijelölés minden felsorolt cégre érvényes. A korábban felfüggesztett céges hozzáférés
        felfüggesztve marad.
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
        <button className="primary-button" disabled={save.isPending || !groups.length}>
          Többcéges tagság mentése
        </button>
      </div>
    </form>
  )
}
