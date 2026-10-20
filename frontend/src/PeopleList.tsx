import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from './api'
import type { Member, Session, Tenant } from './api'
import { peopleApi } from './peopleApi'
import { ProtectedImage } from './ProtectedImage'
import { initials } from './peopleDisplay'
import { QueryMessage } from './FleetFields'
import { PageButtons } from './CompaniesPage'
import './profiles.css'

type Row = { id: string; name: string; email: string; avatar?: string | null; active: boolean | null; summary: string; companies: string; member?: Member }
export function PeopleList({ user, tenant, onProfile, onAction, catalogReady = true }: {
  user: Session; tenant?: Tenant; onProfile: (id: string) => void;
  onAction?: (kind: 'permissions' | 'groups' | 'status', member: Member) => void; catalogReady?: boolean
}) {
  const admin = user.systemPermissions?.includes('system.manage') ?? false
  const [showAll, setShowAll] = useState(!tenant)
  const all = admin && (showAll || !tenant)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState(''), [draft, setDraft] = useState('')
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
            summary: p.systemPermissions.includes('system.manage') ? 'Rendszergazda' : p.isAdministrator ? 'Céges admin' : 'Felhasználó',
            companies: companies.length ? `${companies.slice(0, 2).join(', ')}${companies.length > 2 ? ` +${companies.length - 2}` : ''}` : 'Nincs céges hozzáférés' } satisfies Row
        }) }
      }
      if (readMembers) {
        const data = await api.members(tenant!.id, page, search, signal)
        return { ...data, items: data.items.map(m => ({ id: m.userId, name: m.displayName ?? m.userId, email: m.email ?? '', avatar: m.avatarRevision, active: m.isActive, member: m,
          summary: m.groups?.some(g => g.isAdmin) ? 'Teljes céges hozzáférés' : `${m.permissions.length} jogosultság${m.groups?.length ? ` · ${m.groups.slice(0, 2).map(g => g.name).join(', ')}${m.groups.length > 2 ? ` +${m.groups.length - 2}` : ''}` : ''}`,
          companies: tenant!.name } satisfies Row)) }
      }
      const data = await peopleApi.colleagues(tenant!.id, page, search, signal)
      return { ...data, items: data.items.map(p => ({ id: p.id, name: p.displayName, email: p.email, avatar: p.avatarRevision, active: true, summary: 'Céges munkatárs', companies: tenant!.name } satisfies Row)) }
    },
  })
  return <>
    <form className="access-search people-search" onSubmit={e => { e.preventDefault(); setSearch(draft.trim()); setPage(1) }}>
      <div className="search-field"><Search size={18} /><input aria-label="Felhasználó keresése" placeholder="Felhasználónév, név vagy e-mail" value={draft} maxLength={100} onChange={e => setDraft(e.target.value)} /></div>
      <button className="secondary-button">Keresés</button>
      {admin && <label className="toggle-control"><input type="checkbox" role="switch" checked={all} onChange={e => { setShowAll(e.target.checked); setPage(1) }} disabled={!tenant} /><span className="toggle-track" />Összes felhasználó</label>}
      {all && <><label className="compact-filter">Jogkör<select aria-label="Szűrés jogkör szerint" value={role} onChange={e => { setRole(e.target.value); setPage(1) }}><option value="all">Minden jogkör</option><option value="admin">Adminok</option><option value="member">Nem adminok</option></select></label><label className="compact-filter">Hozzáférés<select aria-label="Szűrés céges hozzáférés szerint" value={access} onChange={e => { setAccess(e.target.value); setPage(1) }}><option value="all">Minden fiók</option><option value="with">Van céges hozzáférése</option><option value="none">Nincs céges hozzáférése</option></select></label></>}
    </form>
    <QueryMessage pending={rows.isPending} error={rows.error} retry={() => void rows.refetch()} />
    {rows.data && <><div className="table-scroll"><table className="people-table"><thead><tr><th>Felhasználó</th><th>{all ? 'Céges hozzáférés' : 'Állapot'}</th><th>Hozzáférés összegzése</th><th>Műveletek</th></tr></thead><tbody>
      {rows.data.items.map((row: Row) => <tr key={row.id}>
        <td><div className="person-cell"><ProtectedImage path={peopleApi.avatarPath(row.id)} tenantId={tenant?.id} revision={row.avatar} alt={`${row.name} profilképe`} className="person-avatar" fallback={initials(row.name)} /><div><button className="person-name text-button" onClick={() => onProfile(row.id)}>{row.name}{row.id === user.id ? ' (te)' : ''}</button><span className="member-email">@{row.id} · {row.email}</span></div></div></td>
        <td>{all ? <span className="people-company-summary">{row.companies}</span> : <span className={`status ${row.active ? 'status-active' : 'status-inactive'}`}>{row.active ? 'Aktív' : 'Felfüggesztve'}</span>}</td>
        <td><span className="permission-summary">{row.summary}</span></td>
        <td><div className="member-actions"><button className="secondary-button" aria-label={`Profil megnyitása: ${row.email || row.id}`} onClick={() => onProfile(row.id)}>Adatlap</button>
          {row.member && onAction && tenant?.permissions.includes('permissions.manage') && <><button className="secondary-button" disabled={!catalogReady} aria-label={`Jogosultságok: ${row.email || row.id}`} onClick={() => onAction('permissions', row.member!)}>Jogosultságok</button><button className="secondary-button" aria-label={`Csoportok: ${row.email || row.id}`} onClick={() => onAction('groups', row.member!)}>Csoportok</button></>}
          {row.member && onAction && tenant?.permissions.includes('members.update') && <button className="secondary-button" aria-label={`${row.active ? 'Felfüggesztés' : 'Visszaállítás'}: ${row.email || row.id}`} onClick={() => onAction('status', row.member!)}>{row.active ? 'Felfüggesztés' : 'Visszaállítás'}</button>}
        </div></td>
      </tr>)}
      {!rows.data.items.length && <tr><td colSpan={4}>Nincs találat. Próbálj másik nevet vagy e-mail-címet.</td></tr>}
    </tbody></table></div><PageButtons page={page} total={rows.data.total} pending={rows.isFetching} onPage={setPage} /></>}
  </>
}
