import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, CarFront, Gauge, Wrench } from 'lucide-react'
import { dashboardApi } from './dashboardApi'
import type { DashboardOverview } from './dashboardApi'
import { dashboardDeadlines, deadlineState } from './dashboardDeadlines'
import type { DashboardDeadline } from './dashboardDeadlines'
import { overviewModules } from './dashboardModules'
import type { OverviewModule } from './dashboardModules'
import { QueryMessage } from './FleetFields'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'

const kilometers = (value: number) => `${value.toLocaleString('hu-HU')} km`
const monthLabel = new Intl.DateTimeFormat('hu-HU', { month: 'short', timeZone: 'UTC' })
const monthFullLabel = new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long', timeZone: 'UTC' })

export function FleetDashboardOverview({ userId, tenantId, siteId, onFleet, onVehicle }: {
  userId: string; tenantId: string; siteId: string
  onFleet: (status?: string) => void; onVehicle: (id: string) => void
}) {
  const queueId = useId()
  const overview = useQuery({ queryKey: ['dashboard', userId, tenantId, 'overview', siteId],
    queryFn: ({ signal }) => dashboardApi.overview(tenantId, siteId, signal), refetchInterval: 30000, retry: false })
  const data = overview.error ? undefined : overview.data
  return <>
    <QueryMessage pending={overview.isPending} error={overview.error} retry={() => void overview.refetch()} />
    {data && <div className="fleet-overview" aria-label="Flotta összegzése" key={siteId}>
      <OverviewModuleContent kind="metrics" data={data} onFleet={onFleet} onVehicle={onVehicle} queueId={queueId} />
      {data.vehicles.length === 0 ? <p className="access-panel dashboard-empty">Ezen a munkaterületen még nincs jármű.</p> : <>
        <div className="fleet-overview-grid">
          {(['mileage', 'ranking', 'service', 'deadlines'] as const).map(kind =>
            <OverviewModuleContent key={kind} kind={kind} data={data} onVehicle={onVehicle} queueId={queueId} />)}
        </div>
        <OverviewModuleContent kind="sites" data={data} onVehicle={onVehicle} />
      </>}
    </div>}
  </>
}

function countSites(vehicles: DashboardOverview['vehicles']) {
  const sites = new Map<string, { name: string; count: number }>()
  for (const { vehicle } of vehicles) {
    const id = vehicle.siteId ?? 'none'
    const site = sites.get(id) ?? { name: vehicle.siteName ?? 'Telephely nélkül', count: 0 }
    sites.set(id, { ...site, count: site.count + 1 })
  }
  return Array.from(sites, ([id, site]) => ({ id, ...site })).sort((a, b) => a.name.localeCompare(b.name, 'hu'))
}

export function OverviewModuleContent({ kind, data, onVehicle, onFleet, queueId, limit, deadlineType, deadlineTiming }: {
  kind: OverviewModule; data: DashboardOverview; onVehicle: (id: string) => void; onFleet?: (status?: string) => void
  queueId?: string; limit?: number; deadlineType?: DashboardDeadline['kind'] | 'all'; deadlineTiming?: 'all' | 'overdue' | 'upcoming'
}) {
  const headingId = useId()
  const [extra, setExtra] = useState(0)
  const heading = (detail?: string | number) => <div className="dashboard-section-heading">
    <h3 id={headingId}>{overviewModules[kind]}</h3>{detail !== undefined && <span>{detail}</span>}
  </div>
  const current = data.vehicles.filter(({ vehicle }) => vehicle.status !== 'Archived')
  if (kind === 'mileage') return <MileageChart months={data.monthlyMileage} />
  if (kind === 'ranking') {
    const rows = data.topVehicles.slice(0, limit ?? 5)
    return <section className="access-panel fleet-rank" aria-labelledby={headingId}>
      {heading(`${data.monthlyMileage.length} hónap`)}
      {rows.length ? <ol>{rows.map(car => <li key={car.vehicleId}>
        <Button variant="ghost" onClick={() => onVehicle(car.vehicleId)} aria-label={`${car.registration} · ${kilometers(car.kilometers)}`}>
          <span><strong>{car.registration}</strong><small>{car.make} {car.model}</small></span>
          <span>{kilometers(car.kilometers)}</span><ArrowRight size={15} aria-hidden="true" />
        </Button>
        <div className="fleet-rank-track" aria-hidden="true"><span style={{ width: `${100 * car.kilometers / rows[0]!.kilometers}%` }} /></div>
      </li>)}</ol> : <p className="dashboard-empty">Még nincs mérhető futásteljesítmény.</p>}
    </section>
  }
  if (kind === 'sites') {
    const sites = countSites(current)
    return <section className="access-panel dashboard-sites" aria-labelledby={headingId}>
      {heading(sites.length)}
      {sites.length ? <dl>{sites.map(({ id, name, count }) => <div key={id}><dt>{name}</dt><dd>{count}</dd></div>)}</dl>
        : <p className="dashboard-empty">Nincs megjeleníthető telephely.</p>}
    </section>
  }
  const deadlines = dashboardDeadlines(data.vehicles, data.today)
  const serviceReasons = new Map<string, DashboardDeadline>()
  for (const item of deadlines) {
    if (item.kind !== 'inspection' && item.kind !== 'insurance' && !serviceReasons.has(item.car.vehicle.id))
      serviceReasons.set(item.car.vehicle.id, item)
  }
  const serviceQueue = current.filter(({ vehicle }) => vehicle.status !== 'Maintenance' && serviceReasons.has(vehicle.id))
  if (kind === 'metrics') {
    const totals = [
      { label: 'Jármű a flottában', short: 'Jármű', value: data.vehicles.length, icon: CarFront, action: onFleet ? () => onFleet() : undefined },
      { label: 'Aktív jármű', short: 'Aktív', value: current.filter(({ vehicle }) => vehicle.status === 'Active').length, icon: Gauge, action: onFleet ? () => onFleet('Active') : undefined },
      { label: 'Szervizben', short: 'Szervizben', value: current.filter(({ vehicle }) => vehicle.status === 'Maintenance').length, icon: Wrench, action: onFleet ? () => onFleet('Maintenance') : undefined },
      { label: 'Szervizre vár', short: 'Szervizre vár', value: serviceQueue.length, icon: CalendarClock, action: queueId && data.vehicles.length ? () => {
        const section = document.getElementById(queueId)
        section?.focus()
        section?.scrollIntoView?.({ block: 'nearest' })
      } : undefined },
    ]
    return <div className="fleet-metrics" role="group" aria-label="Flotta állapota">
      {totals.map(({ label, short, value, icon: Icon, action }) => {
        const content = <><Icon size={17} aria-hidden="true" /><span>{short}</span><strong>{value}</strong></>
        return action ? <Button key={label} className="fleet-metric" variant="ghost" aria-label={short === 'Szervizre vár' ? undefined : `${label} megnyitása`} onClick={action}>{content}</Button>
          : <div key={label} className="fleet-metric">{content}</div>
      })}
    </div>
  }
  if (kind === 'service') {
    const displayed = (limit ?? 5) + extra
    return <section id={queueId} tabIndex={queueId ? -1 : undefined} className="access-panel fleet-rank" aria-labelledby={headingId}>
      {heading(`${serviceQueue.length} jármű`)}
      {serviceQueue.length ? <ul>{serviceQueue.slice(0, displayed).map(({ vehicle }) => {
        const reason = serviceReasons.get(vehicle.id)!
        return <li key={vehicle.id}><Button variant="ghost" onClick={() => onVehicle(vehicle.id)} aria-label={`${vehicle.registration} · szerviz`}>
          <span><strong>{vehicle.registration}</strong><small>{reason.label} · {deadlineState(reason).label.toLowerCase()}</small></span>
          <ArrowRight size={15} aria-hidden="true" />
        </Button></li>
      })}</ul> : <p className="dashboard-empty">Nincs szervizre váró jármű.</p>}
      {serviceQueue.length > displayed && <div className="dashboard-more"><Button variant="outline"
        onClick={() => setExtra(count => count + 5)}>További járművek ({serviceQueue.length - displayed})</Button></div>}
    </section>
  }

  const filtered = deadlines.filter(item => {
    const overdue = (item.days ?? item.distance ?? 0) < 0
    return (!deadlineType || deadlineType === 'all' || deadlineType === item.kind)
      && (!deadlineTiming || deadlineTiming === 'all' || (deadlineTiming === 'overdue' ? overdue : !overdue))
  })
  const displayed = (limit ?? 6) + extra
  return <section className="access-panel dashboard-deadlines" aria-labelledby={headingId}>
    <div className="dashboard-section-heading"><h3 id={headingId}>Határidők <span>({filtered.length})</span></h3><span>Lejárt és következő 30 nap</span></div>
    {filtered.length ? <ul>{filtered.slice(0, displayed).map(item => {
      const state = deadlineState(item)
      return <li key={`${item.car.vehicle.id}-${item.kind}`}>
        <Button variant="ghost" className="dashboard-deadline" onClick={() => onVehicle(item.car.vehicle.id)}
          aria-label={`${item.car.vehicle.registration} · ${item.label}`}>
          <strong>{item.car.vehicle.registration}</strong>
          <span className="dashboard-deadline-detail"><span>{item.label}</span>
            {item.date && <time dateTime={item.date}>{new Date(item.date).toLocaleDateString('hu-HU', { timeZone: 'UTC' })}</time>}
          </span>
          <Badge dot={false} tone={state.tone}>{state.label}</Badge>
        </Button>
      </li>
    })}</ul> : <p className="dashboard-empty">Nincs esedékes határidő.</p>}
    {filtered.length > displayed && <div className="dashboard-more"><Button variant="outline"
      onClick={() => setExtra(count => count + 6)}>További határidők ({filtered.length - displayed})</Button></div>}
  </section>
}

function MileageChart({ months }: { months: DashboardOverview['monthlyMileage'] }) {
  const headingId = useId()
  const maximum = Math.max(1, ...months.map(x => x.kilometers ?? 0))
  const total = months.reduce((sum, x) => sum + (x.kilometers ?? 0), 0)
  return <section className="access-panel fleet-mileage" aria-labelledby={headingId}>
    <div className="dashboard-section-heading"><h3 id={headingId}>Havi futásteljesítmény</h3>
      <span>{months.some(x => x.kilometers !== null) ? kilometers(total) : 'Nincs mérhető adat'}</span></div>
    <ul className="fleet-mileage-chart" style={{ gridTemplateColumns: `repeat(${Math.min(6, Math.max(1, months.length))}, minmax(0, 1fr))` }} aria-label={`Havi kilométerek · ${months.length} hónap`}>
      {months.map(entry => {
        const date = new Date(entry.month)
        const value = entry.kilometers
        return <li key={entry.month} aria-label={`${monthFullLabel.format(date)} · ${value === null ? 'nincs mérhető adat' : kilometers(value)}`}>
          <span className="fleet-mileage-value" aria-hidden="true">{value?.toLocaleString('hu-HU') ?? '–'}</span>
          <span className="fleet-mileage-bar" aria-hidden="true"><i data-measured={value !== null}
            style={{ height: value === null ? undefined : `max(3px, ${100 * value / maximum}%)` }} /></span>
          <time dateTime={entry.month} aria-hidden="true">{monthLabel.format(date)}</time>
        </li>
      })}
    </ul>
    <p className="fleet-mileage-note">Az óraállások különbsége a későbbi rögzítés hónapjához kerül.</p>
  </section>
}
