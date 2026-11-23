import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { mediaApi } from './peopleApi'
import { QueryMessage } from './FleetFields'
import { PageButtons } from './CompaniesPage'

function Person({ username, name }: { username: string; name: string }) {
  return <span className="assignment-person"><strong>{name}</strong><span className="field-hint">@{username}</span></span>
}
function Timestamp({ value }: { value: string }) {
  return <time dateTime={value}>{new Date(value).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'medium' })}</time>
}

export function VehicleAssignmentHistory({ tenantId, id }: { tenantId: string; id: string }) {
  const [page, setPage] = useState(1)
  const history = useQuery({
    queryKey: ['vehicle-assignee-history', tenantId, id, page],
    queryFn: ({ signal }) => mediaApi.assigneeHistory(tenantId, id, page, signal),
    retry: false,
  })
  return <section aria-label="Jármű használati előzményei">
    <div className="org-section-tools"><h3>Használati előzmények</h3></div>
    <QueryMessage pending={history.isPending} error={history.error} retry={() => void history.refetch()} />
    {history.data && <>
      {history.data.items.length ? <div className="table-scroll"><table className="org-table assignment-history-table">
        <thead><tr><th scope="col">Használó</th><th scope="col">Mettől</th><th scope="col">Meddig</th><th scope="col">Hozzárendelte</th><th scope="col">Lezárta / átadta</th></tr></thead>
        <tbody>{history.data.items.map(row => <tr key={row.id}>
          <td><Person username={row.userId} name={row.displayName} /></td>
          <td><Timestamp value={row.assignedAt} /></td>
          <td>{row.releasedAt ? <Timestamp value={row.releasedAt} /> : <span className="status status-active">Jelenleg is</span>}</td>
          <td><Person username={row.assignedBy} name={row.assignedByDisplayName} /></td>
          <td>{row.releasedBy ? <Person username={row.releasedBy} name={row.releasedByDisplayName ?? row.releasedBy} /> : '—'}</td>
        </tr>)}</tbody>
      </table></div> : <p className="notice">{history.data.total ? 'Ezen az oldalon nincs hozzárendelés.' : 'Ehhez a járműhöz még nem történt felhasználói hozzárendelés.'}</p>}
      {history.data.total > 0 && <PageButtons page={page} total={history.data.total} pending={history.isFetching} onPage={setPage} />}
    </>}
  </section>
}
