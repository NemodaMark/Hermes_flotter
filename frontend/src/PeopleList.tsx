import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from './api'
import type { Session, Tenant } from './api'
import { peopleApi } from './peopleApi'
import { ProtectedImage } from './ProtectedImage'
import { initials } from './peopleDisplay'
import { QueryMessage } from './FleetFields'
import { PageButtons } from './CompaniesPage'
import { ListToolbar } from './ListToolbar'
import './profiles.css'
import { Badge } from './ui/Badge'
import { ClickableRow, TableFrame } from './ui/Table'
import { Toggle } from './ui/Toggle'
import { useListSearch } from './useListSearch'
import { ViewModeSwitch } from './ViewModeSwitch'

type Row = { id: string; name: string; email: string; avatar?: string | null; active: boolean | null; role?: string; companies: string }
export function PeopleList({ user, tenant, onProfile, actions }: {
  user: Session; tenant?: Tenant; onProfile: (id: string) => void; actions?: ReactNode
}) {
  const admin = user.systemPermissions?.includes('system.manage') ?? false
  const [portraits, setPortraits] = useState(false)
  const [showAll, setShowAll] = useState(!tenant)
  const all = admin && (showAll || !tenant)
  const { page, setPage, search, draft, setDraft } = useListSearch()
  const [role, setRole] = useState('all'), [access, setAccess] = useState('all')
  const readMembers = tenant?.permissions.includes('members.read') ?? false
  const rows = useQuery({
    queryKey: ['people-list', user.id, tenant?.id, all, readMembers, page, search, role, access], retry: false,
    queryFn: async ({ signal }) => {
      if (all) {
        const data = await api.systemUsers(page, search, signal, role, access)
        return { ...data, items: data.items.map(p => {
          const companies = p.companyAccess?.filter(c => c.hasAccess).map(c => c.name) ?? []
          return { id: p.id, name: p.displayName, email: p.email, avatar: p.avatarRevision, active: null,
            role: p.systemPermissions.includes('system.manage') ? 'Rendszergazda' : p.isAdministrator ? 'Céges admin' : undefined,
            companies: companies.length ? `${companies.slice(0, 2).join(', ')}${companies.length > 2 ? ` +${companies.length - 2}` : ''}` : 'Nincs céges hozzáférés' } satisfies Row
        }) }
      }
      if (readMembers) {
        const data = await api.members(tenant!.id, page, search, signal)
        return { ...data, items: data.items.map(m => ({ id: m.userId, name: m.displayName ?? m.userId, email: m.email ?? '', avatar: m.avatarRevision, active: m.isActive,
          role: m.groups?.some(g => g.isAdmin) ? 'Céges admin' : undefined,
          companies: tenant!.name } satisfies Row)) }
      }
      const data = await peopleApi.colleagues(tenant!.id, page, search, signal)
      return { ...data, items: data.items.map(p => ({ id: p.id, name: p.displayName, email: p.email, avatar: p.avatarRevision, active: true, companies: tenant!.name } satisfies Row)) }
    },
  })
  return <>
    <ListToolbar label="Felhasználók keresése és műveletei" actions={<>
      <ViewModeSwitch visual={portraits} onChange={setPortraits} label="Portrék" />
      {admin && <Toggle checked={all} onChange={value => { setShowAll(value); setPage(1) }} disabled={!tenant}>Összes felhasználó</Toggle>}
      {actions}
    </>}>
    <div className="list-toolbar-form">
      <div className="search-field"><Search size={18} /><input aria-label="Felhasználó keresése" placeholder="Felhasználónév, név vagy e-mail" value={draft} maxLength={100} onChange={e => setDraft(e.target.value)} /></div>
      {all && <><label className="compact-filter">Jogkör<Select aria-label="Szűrés jogkör szerint" value={role} onChange={e => { setRole(e.target.value); setPage(1) }}><option value="all">Minden jogkör</option><option value="admin">Adminok</option><option value="member">Nem adminok</option></Select></label><label className="compact-filter">Hozzáférés<Select aria-label="Szűrés céges hozzáférés szerint" value={access} onChange={e => { setAccess(e.target.value); setPage(1) }}><option value="all">Minden fiók</option><option value="with">Van céges hozzáférése</option><option value="none">Nincs céges hozzáférése</option></Select></label></>}
    </div>
    </ListToolbar>
    <QueryMessage pending={false} error={rows.error} retry={() => void rows.refetch()} />
    {portraits && rows.data?.items.length ? <div className="showcase-grid" aria-label="Munkatársak portréi">{rows.data.items.map((row: Row) => <article className="showcase-item" key={row.id}>
      <button type="button" className="showcase-open" aria-label={`Profil megnyitása: ${row.email || row.id}`} onClick={() => onProfile(row.id)}>
        <div className="showcase-cover"><ProtectedImage path={peopleApi.avatarPath(row.id)} tenantId={tenant?.id} revision={row.avatar} alt={`${row.name} profilképe`} className="person-avatar" fallback={initials(row.name)} /></div>
        <div className="showcase-content"><h3>{row.name}{row.id === user.id ? ' (te)' : ''}</h3><p>@{row.id}</p><p>{row.email}</p>
          {row.role && <span className="person-role">{row.role}</span>}
          {all ? <p>{row.companies}</p> : <Badge tone={row.active ? 'success' : 'neutral'}>{row.active ? 'Aktív' : 'Felfüggesztve'}</Badge>}
        </div>
      </button>
    </article>)}</div> : <TableFrame hasRows={(rows.data?.items.length ?? 0) > 0}><table className={`people-table responsive-list${all ? '' : ' compact-list'}`}><thead><tr><th>Felhasználó</th><th>{all ? 'Céges hozzáférés' : 'Állapot'}</th></tr></thead><tbody>
      {rows.data?.items.map((row: Row) => <ClickableRow key={row.id} aria-label={`Felhasználó: ${row.name}`} onOpen={() => onProfile(row.id)}>
        <td><div className="person-cell"><ProtectedImage path={peopleApi.avatarPath(row.id)} tenantId={tenant?.id} revision={row.avatar} alt={`${row.name} profilképe`} className="person-avatar" fallback={initials(row.name)} /><div><Button className="person-name row-title" tabIndex={-1} aria-label={`Profil megnyitása: ${row.email || row.id}`} onClick={() => onProfile(row.id)}>{row.name}{row.id === user.id ? ' (te)' : ''}</Button>{row.role && <span className="person-role">{row.role}</span>}<span className="member-email" title={[row.id, row.email].filter(Boolean).join(" / ")}>@{row.id} · {row.email}</span></div></div></td>
        <td data-label={all ? 'Céges hozzáférés' : 'Állapot'}>{all ? <span className="people-company-summary">{row.companies}</span> : <Badge tone={row.active ? 'success' : 'neutral'}>{row.active ? 'Aktív' : 'Felfüggesztve'}</Badge>}</td>
      </ClickableRow>)}
      {!rows.data?.items.length && <tr><td colSpan={2} className="table-empty">{rows.isPending ? 'Felhasználók betöltése…' : 'Nincs találat. Próbálj másik nevet vagy e-mail-címet.'}</td></tr>}
    </tbody></table></TableFrame>}<PageButtons page={page} total={rows.data?.total ?? 0} pending={rows.isFetching} onPage={setPage} />
  </>
}
