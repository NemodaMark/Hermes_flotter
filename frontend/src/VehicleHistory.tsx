import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fleetApi } from './fleetApi'
import type { OdometerEntry, RegistrationEntry } from './fleetApi'
import type { Page } from './api'
import { QueryMessage } from './FleetFields'
import { PageButtons } from './CompaniesPage'

export function VehicleHistory({ tenantId, id, kind }: { tenantId: string; id: string; kind: 'odometer' | 'registrations' }) {
  const [page, setPage] = useState(1)
  const query = useQuery<Page<OdometerEntry | RegistrationEntry>>({ queryKey: ['fleet-management', tenantId, id, kind, page],
    queryFn: ({ signal }) => kind === 'registrations' ? fleetApi.registrations(tenantId, id, page, signal) : fleetApi.odometer(tenantId, id, page, signal), retry: false })
  return <section aria-label={kind === 'registrations' ? 'Rendszámelőzmények' : 'Kilométerelőzmények'}>
    <h3>{kind === 'registrations' ? 'Rendszámelőzmények' : 'Kilométerelőzmények'}</h3>
    <QueryMessage pending={query.isPending} error={query.error} retry={() => void query.refetch()} />
    {query.data && <>{query.data.items.length ? <ol className="vehicle-history-timeline">{query.data.items.map(row => <li key={row.id}>
      <div><strong>{'kilometers' in row ? `${row.kilometers.toLocaleString('hu-HU')} km` : `${row.registration} · ${row.countryCode}`}</strong>
        <time dateTime={row.recordedAt}>{new Date(row.recordedAt).toLocaleString('hu-HU')}</time></div>
      <span>Rögzítette: {row.recordedBy === 'system:migration' ? 'Korábbi járműadat átvétele' : row.recordedBy}</span>
    </li>)}</ol> : <p className="field-hint">{kind === 'registrations' ? 'Még nincs rendszámelőzmény.' : 'Még nincs rögzített kilométerállás.'}</p>}
      {query.data.total > 0 && <PageButtons page={page} total={query.data.total} pending={query.isFetching} onPage={setPage} />}
    </>}
  </section>
}
