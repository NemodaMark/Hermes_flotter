import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from './api'
import type { Session } from './api'
import { QueryMessage } from './FleetFields'
import { PageButtons } from './CompaniesPage'
import { PermissionGroups } from './PermissionGroups'
import './members.css'

export function SystemPage({ user, onUsers }: { user: Session; onUsers?: () => void }) {
  const [tab, setTab] = useState<'audit' | 'groups'>('audit')
  const [page, setPage] = useState(1)
  const audit = useQuery({ queryKey: ['system-audit', user.id, page], queryFn: ({ signal }) => api.systemAudit(page, signal), enabled: tab === 'audit', retry: false })
  return <section className="access-panel" aria-label="Rendszerkezelés">
    <div className="access-toolbar"><div className="access-tabs"><button aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>Módosítási napló</button><button aria-pressed={tab === 'groups'} onClick={() => setTab('groups')}>Jogosultságcsoportok</button></div>{onUsers && <button className="secondary-button" onClick={onUsers}>Felhasználók megnyitása</button>}</div>
    {tab === 'groups' ? <PermissionGroups user={user} /> : <><QueryMessage pending={audit.isPending} error={audit.error} retry={() => void audit.refetch()} />
      {audit.data && <><div className="table-scroll"><table className="audit-table"><thead><tr><th>Időpont</th><th>Módosító</th><th>Művelet</th><th>Részletek</th></tr></thead><tbody>{audit.data.items.map(entry => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString('hu-HU')}</td><td>{entry.actorSubject}</td><td>{entry.action}{entry.targetSubject && <span className="member-email">{entry.targetSubject}</span>}</td><td><details><summary>Részletek</summary><pre>{JSON.stringify(JSON.parse(entry.details), null, 2)}</pre></details></td></tr>)}{!audit.data.items.length && <tr><td colSpan={4}>Még nincs naplóbejegyzés.</td></tr>}</tbody></table></div><PageButtons page={page} total={audit.data.total} pending={audit.isFetching} onPage={setPage} /></>}
    </>}
  </section>
}
