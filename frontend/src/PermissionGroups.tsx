import { Button } from './ui/Button'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type {
  GroupDraft,
  PermissionGroup,
  GroupCompanyOption,
  GroupUser,
  Permission,
  Session,
  GroupSiteSelection,
} from './api'
import { AccessDialog } from './AccessDialog'
import { PermissionFields } from './MemberDialogs'
import { permissionLabel } from './permissions'
import { Search } from 'lucide-react'
import { ListToolbar } from './ListToolbar'
import { PermissionDetails } from './PermissionDetails'

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'A művelet nem sikerült.'

const scopedPermission = (code: string) => code.startsWith('vehicles.') || code.startsWith('sites.') || code === 'audit.read'
const companyScopeLabel = (company: PermissionGroup['companies'][number]) =>
  `${company.name}: ${company.allSites !== false ? 'teljes cég' : company.sites?.map((s) => `${s.name} (${s.code})`).join(', ') || 'kijelölt telephelyek'}`

export function PermissionGroups({ user }: { user: Session }) {
  const client = useQueryClient()
  const [search, setSearch] = useState('')
  const [dialog, setDialog] = useState<
    { kind: 'edit' | 'delete'; group: PermissionGroup } | { kind: 'create' } | null
  >(null)
  const data = useQuery({
    queryKey: ['permission-groups', user.id],
    queryFn: async ({ signal }) => {
      const [groups, companies, catalog] = await Promise.all([
        api.groups(signal),
        api.groupCompanies(signal),
        api.permissions(signal),
      ])
      return { groups, companies, catalog }
    },
    retry: false,
  })
  async function refresh() {
    await Promise.all(
      ['permission-groups', 'tenants', 'members', 'people-list', 'person-profile', 'system-audit', 'vehicles', 'companies', 'organization', 'vehicle-create-options'].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    )
  }
  const groups = (data.data?.groups ?? []).filter(group => `${group.name} ${group.companies.map(company => company.name).join(' ')}`.toLocaleLowerCase('hu').includes(search.toLocaleLowerCase('hu')))
  return (
    <div>
      <ListToolbar label="Jogosultságcsoportok keresése és műveletei" actions={<>
          <Button className="text-button" onClick={() => void data.refetch()}>
            Csoportlista frissítése
          </Button>
          {data.data?.companies.some((c) => c.canEdit) && (
            <Button className="primary-button" onClick={() => setDialog({ kind: 'create' })}>
              Új jogosultságcsoport
            </Button>
          )}
      </>}>
        <div className="list-toolbar-form"><div className="search-field"><Search size={18} /><input aria-label="Jogosultságcsoport keresése" placeholder="Csoport vagy cég neve" value={search} onChange={event => setSearch(event.target.value)} maxLength={100} /></div></div>
      </ListToolbar>
      {data.isPending && (
        <p className="notice" role="status">
          Jogosultságcsoportok betöltése…
        </p>
      )}
      {data.isError && (
        <p className="notice error" role="alert">
          {message(data.error)}
        </p>
      )}
      {data.isSuccess && (
        <>
          {groups.length ? (
            <div className="table-scroll">
              <table className="groups-table responsive-list">
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
                  {groups.map((group) => (
                    <tr key={group.id}>
                      <td data-label="Csoport">
                        <strong>{group.name}</strong>
                        {group.isAdmin && (
                          <span className="member-email">
                            Védett admin · automatikusan bővülő jogkör
                          </span>
                        )}
                        {!group.isAdmin && (
                          <span className="member-email">Létrehozó: {group.createdBy}</span>
                        )}
                      </td>
                      <td data-label="Cégek">
                        {group.isAdmin
                          ? 'Felhasználónként kijelölhető cégek'
                          : group.companies.map((c) => <div key={c.id}>{companyScopeLabel(c)}</div>)}
                      </td>
                      <td data-label="Jogosultságok">
                        <div className="member-grants">
                          {group.allPermissions
                            ? 'Minden jelenlegi és későbbi céges jog'
                            : <PermissionDetails codes={group.permissions} />}
                        </div>
                      </td>
                      <td data-label="Tagok">{group.memberCount}</td>
                      <td data-label="Műveletek">
                        {group.canEdit && !group.isAdmin ? (
                          <div className="member-actions">
                            <Button
                              className="secondary-button"
                              aria-label={`Jogosultságcsoport szerkesztése: ${group.name}`}
                              onClick={() => setDialog({ kind: 'edit', group })}
                            >
                              Szerkesztés
                            </Button>
                            {!group.isAdmin && (
                              <Button
                                className="secondary-button danger-text"
                                aria-label={`Jogosultságcsoport törlése: ${group.name}`}
                                onClick={() => setDialog({ kind: 'delete', group })}
                              >
                                Törlés
                              </Button>
                            )}
                          </div>
                        ) : group.isAdmin ? (
                          'Felhasználónál kiosztható'
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
            <p className="notice">Nincs megjeleníthető jogosultságcsoport.</p>
          )}
          {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
            <GroupEditor
              group={dialog.kind === 'edit' ? dialog.group : undefined}
              companies={data.data.companies}
              catalog={data.data.catalog}
              onClose={() => setDialog(null)}
              onChanged={refresh}
            />
          )}
          {dialog?.kind === 'delete' && (
            <GroupDelete group={dialog.group} onClose={() => setDialog(null)} onChanged={refresh} />
          )}
        </>
      )}
    </div>
  )
}

function GroupEditor({
  group,
  companies,
  catalog,
  onClose,
  onChanged,
}: {
  group?: PermissionGroup
  companies: GroupCompanyOption[]
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
  const [siteScopes, setSiteScopes] = useState<GroupSiteSelection[]>(
    group?.companies.map((c) => ({ companyId: c.id, allSites: c.allSites !== false, siteIds: c.sites?.map((s) => s.id) ?? [] })) ?? [],
  )
  const scopeFor = (id: string, scopes = siteScopes): GroupSiteSelection =>
    scopes.find((s) => s.companyId === id) ?? { companyId: id, allSites: true, siteIds: [] }
  function canUse(company: GroupCompanyOption, code: string, scopes = siteScopes) {
    if (!company.permissions.includes(code)) return false
    if (!scopedPermission(code)) return true
    const target = scopeFor(company.id, scopes)
    if (code === 'sites.create' && !target.allSites) return false
    if (!company.permissionScopes) return true
    const own = company.permissionScopes.find((s) => s.code === code)
    return !!own && (own.allSites || (!target.allSites && target.siteIds.length > 0 && target.siteIds.every((id) => own.siteIds.includes(id))))
  }
  function trimPermissions(nextIds: string[], scopes: GroupSiteSelection[]) {
    const choices = companies.filter((c) => nextIds.includes(c.id))
    setPermissions((values) => values.filter((code) => choices.length > 0 && choices.every((c) => canUse(c, code, scopes))))
  }
  function changeScope(selection: GroupSiteSelection) {
    const next = [...siteScopes.filter((s) => s.companyId !== selection.companyId), selection]
    setSiteScopes(next)
    trimPermissions(ids, next)
  }
  const eligible = companies.filter(
    (c) => c.canEdit && (!group?.memberCount || c.canAssign) && (!group?.isAdmin || c.canGrantAll),
  )
  const selected = companies.filter((c) => ids.includes(c.id))
  const available = catalog
    .map((x) => x.code)
    .filter((code) => selected.length > 0 && selected.every((c) => canUse(c, code)))
  const invalidScope = ids.some((id) => !scopeFor(id).allSites && scopeFor(id).siteIds.length === 0)
  const canAll = selected.length > 0 && selected.every((c) => c.canGrantAll)
  const save = useMutation({
    mutationFn: () => {
      const body: GroupDraft = {
        name: name.trim(),
        permissions: allPermissions ? [] : permissions,
        companyIds: ids,
        allPermissions,
        siteScopes: ids.map((id) => scopeFor(id)),
      }
      return group
        ? api.updateGroup(group.id, { ...body, version: group.version })
        : api.createGroup(body)
    },
  })
  function selectCompanies(next: string[]) {
    setIds(next)
    const choices = companies.filter((c) => next.includes(c.id))
    trimPermissions(next, siteScopes)
    if (!choices.length || choices.some((c) => !c.canGrantAll)) setAll(false)
  }
  return (
    <AccessDialog
      title={group ? 'Jogosultságcsoport szerkesztése' : 'Új jogosultságcsoport'}
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
          disabled={save.isPending || group?.isAdmin}
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
        {selected.map((company) => {
          const scope = scopeFor(company.id)
          return (
            <fieldset key={company.id} className="group-site-fields" disabled={save.isPending}>
              <legend>{company.name} · telephely-hozzáférés</legend>
              <select
                aria-label={`${company.name}: telephely-hozzáférés`}
                value={scope.allSites ? 'all' : 'selected'}
                onChange={(e) => changeScope({ companyId: company.id, allSites: e.target.value === 'all', siteIds: [] })}
              >
                <option value="all">Teljes cég, telephely nélküli járművekkel</option>
                <option value="selected">Csak kijelölt telephelyek</option>
              </select>
              {!scope.allSites && (
                <div className="group-site-options">
                  {(company.sites ?? []).map((site) => (
                    <label className="permission-option" key={site.id}>
                      <input type="checkbox" aria-label={`${company.name}: ${site.name} (${site.code})`}
                        checked={scope.siteIds.includes(site.id)}
                        disabled={site.isArchived && !scope.siteIds.includes(site.id)}
                        onChange={(e) => changeScope({ ...scope, siteIds: e.target.checked ? [...scope.siteIds, site.id] : scope.siteIds.filter((id) => id !== site.id) })}
                      />
                      <span>{site.name} ({site.code}){site.isArchived ? ' · Archivált' : ''}</span>
                    </label>
                  ))}
                  {!(company.sites?.length) && <p className="field-hint">Ennél a cégnél még nincs telephely.</p>}
                  {!scope.siteIds.length && <p className="field-hint">Válassz legalább egy telephelyet.</p>}
                </div>
              )}
            </fieldset>
          )
        })}
        {ids.length > 0 && <p className="field-hint">
          A telephelykijelölés a jármű- és telephelyműveleteket, valamint ezek naplóját korlátozza.
          A többi céges jog cégszintű. Más csoportból és közvetlenül kapott jogok hozzáadódnak.
        </p>}
        <label className="permission-option">
          <input
            type="checkbox"
            checked={allPermissions}
            disabled={save.isPending || !canAll || group?.isAdmin}
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
          <Button
            type="button"
            className="secondary-button"
            disabled={save.isPending}
            onClick={onClose}
          >
            Mégse
          </Button>
          <Button className="primary-button" disabled={save.isPending || !ids.length || invalidScope}>
            Jogosultságcsoport mentése
          </Button>
        </div>
      </form>
    </AccessDialog>
  )
}
function GroupDelete({
  group,
  onClose,
  onChanged,
}: {
  group: PermissionGroup
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const remove = useMutation({
    mutationFn: () => api.deleteGroup(group.id, group.version),
  })
  return (
    <AccessDialog title="Jogosultságcsoport törlése" pending={remove.isPending} onClose={onClose}>
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
        <Button className="secondary-button" disabled={remove.isPending} onClick={onClose}>
          Mégse
        </Button>
        <Button
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
          Jogosultságcsoport törlése
        </Button>
      </div>
    </AccessDialog>
  )
}

export function GroupAssignmentDialog({
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
    queryKey: ['group-user', user.id, userId],
    queryFn: async ({ signal }) => {
      const [groups, access] = await Promise.all([
        api.groups(signal),
        api.groupUser(userId, signal),
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
        'permission-groups',
        'system-users',
        'people-list',
        'person-profile',
        'user-profile',
        'system-audit',
        'vehicles',
        'companies',
        'organization',
        'vehicle-create-options',
      ].map((key) => client.invalidateQueries({ queryKey: [key] })),
    )
  }
  return (
    <AccessDialog title="Felhasználó jogosultságcsoportjai" pending={pending} onClose={onClose}>
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
        <AssignmentFields
          key={data.dataUpdatedAt}
          groups={data.data.groups}
          access={data.data.access}
          onPending={setPending}
          onChanged={refresh}
          onClose={onClose}
        />
      )}
      <Button
        type="button"
        className="text-button"
        disabled={pending || data.isFetching}
        onClick={() => void data.refetch()}
      >
        Csoporttagságok újratöltése
      </Button>
    </AccessDialog>
  )
}
function AssignmentFields({
  groups,
  access,
  onPending,
  onChanged,
  onClose,
}: {
  groups: PermissionGroup[]
  access: GroupUser
  onPending: (value: boolean) => void
  onChanged: () => Promise<void>
  onClose: () => void
}) {
  const [ids, setIds] = useState(access.groupIds)
  const [adminCompanies, setAdminCompanies] = useState(access.adminCompanyIds ?? [])
  const admin = groups.find((group) => group.isAdmin)
  const needsAdminCompany = !!admin && ids.includes(admin.id) && adminCompanies.length === 0
  const save = useMutation({
    mutationFn: () =>
      api.assignGroups(
        access.userId,
        ids,
        access.version,
        admin && ids.includes(admin.id) ? adminCompanies : [],
      ),
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
        <legend>Jogosultságcsoporttagságok</legend>
        {groups.map((group) => (
          <div key={group.id}>
            <label className="permission-option">
              <input
                type="checkbox"
                checked={ids.includes(group.id)}
                onChange={(e) =>
                  setIds(
                    e.target.checked ? [...ids, group.id] : ids.filter((id) => id !== group.id),
                  )
                }
              />
              <span>
                {group.name}
                {!group.isAdmin && (
                  <small>{group.companies.map(companyScopeLabel).join(' · ')}</small>
                )}
                <small>
                  {group.allPermissions
                    ? 'Minden jelenlegi és későbbi céges jog'
                    : group.permissions.map(permissionLabel).join(', ') || 'Nincs kiosztott jog'}
                </small>
              </span>
            </label>
            {group.isAdmin && ids.includes(group.id) && (
              <fieldset className="permission-fields company-options">
                <legend>Adminjog ezeknél a cégeknél</legend>
                {group.companies.map((company) => (
                  <label className="permission-option" key={company.id}>
                    <input
                      type="checkbox"
                      checked={adminCompanies.includes(company.id)}
                      onChange={(e) =>
                        setAdminCompanies(
                          e.target.checked
                            ? [...adminCompanies, company.id]
                            : adminCompanies.filter((id) => id !== company.id),
                        )
                      }
                    />
                    <span>{company.name}</span>
                  </label>
                ))}
                {needsAdminCompany && (
                  <p className="field-hint">Válassz legalább egy céget az adminjoghoz.</p>
                )}
              </fieldset>
            )}
          </div>
        ))}
      </fieldset>
      {!groups.length && (
        <p className="notice">
          Nincs általad minden cégénél kiosztható csoport. Először hozz létre egyet a
          Jogosultságcsoportok fülön.
        </p>
      )}
      {access.hasOtherGroups && (
        <p className="field-hint">Más, általad nem kezelhető csoporttagságok megmaradnak.</p>
      )}
      <p className="field-hint">
        Az adminjog csak a külön kijelölt cégeknél érvényes. Más csoportok a mellettük felsorolt
        cégekhez adnak hozzáférést. A felfüggesztett céges hozzáférés felfüggesztve marad.
      </p>
      {save.isError && (
        <p className="form-error" role="alert">
          {message(save.error)}
        </p>
      )}
      <div className="dialog-actions">
        <Button
          type="button"
          className="secondary-button"
          disabled={save.isPending}
          onClick={onClose}
        >
          Mégse
        </Button>
        <Button
          className="primary-button"
          disabled={save.isPending || !groups.length || needsAdminCompany}
        >
          Tagság mentése
        </Button>
      </div>
    </form>
  )
}
