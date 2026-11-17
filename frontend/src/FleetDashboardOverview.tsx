import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, CarFront, Gauge, Wrench } from 'lucide-react'
import { dashboardApi } from './dashboardApi'
import type { DashboardOverview } from './dashboardApi'
import { dashboardDeadlines, deadlineState } from './dashboardDeadlines'
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
  const overview = useQuery({ queryKey: ['dashboard', userId, tenantId, 'overview', siteId],
    queryFn: ({ signal }) => dashboardApi.overview(tenantId, siteId, signal), refetchInterval: 30000, retry: false })
  return <>
    <QueryMessage pending={overview.isPending} error={overview.error} retry={() => void overview.refetch()} />
    {overview.data && !overview.error && <OverviewContent key={siteId} data={overview.data} onFleet={onFleet} onVehicle={onVehicle} />}
  </>
}

function OverviewContent({ data, onFleet, onVehicle }: {
  data: DashboardOverview; onFleet: (status?: string) => void; onVehicle: (id: string) => void
}) {
  const [visibleDeadlines, setVisibleDeadlines] = useState(6)
  const [visibleService, setVisibleService] = useState(5)
  const deadlines = dashboardDeadlines(data.vehicles, data.today)
  const current = data.vehicles.filter(car => car.vehicle.status !== 'Archived')
  const serviceDeadlines = new Map<string, string>()
  for (const item of deadlines) {
    if (item.kind === 'service' || item.kind === 'service-km' || item.kind === 'appointment') {
      if (!serviceDeadlines.has(item.car.vehicle.id)) serviceDeadlines.set(item.car.vehicle.id, `${item.label} · ${deadlineState(item).label.toLowerCase()}`)
    }
  }
  const maintenance = current.filter(car => car.vehicle.status === 'Maintenance')
  const serviceQueue = current.filter(car => car.vehicle.status !== 'Maintenance' && serviceDeadlines.has(car.vehicle.id))
  const totals = [
    { label: 'Jármű a flottában', short: 'Jármű', value: data.vehicles.length, icon: CarFront, onClick: () => onFleet() },
    { label: 'Aktív jármű', short: 'Aktív', value: current.filter(car => car.vehicle.status === 'Active').length, icon: Gauge, onClick: () => onFleet('Active') },
    { label: 'Szervizben', short: 'Szervizben', value: maintenance.length, icon: Wrench, onClick: () => onFleet('Maintenance') },
  ]
  const sites = Array.from(current.reduce((counts, { vehicle }) => {
    const name = vehicle.siteName ?? 'Telephely nélkül'
    counts.set(name, (counts.get(name) ?? 0) + 1)
    return counts
  }, new Map<string, number>()))
  return <div className="fleet-overview" aria-label="Flotta összegzése">
    <div className="fleet-metrics" role="group" aria-label="Flotta állapota">
      {totals.map(({ label, short, value, icon: Icon, onClick }) => <Button key={label} className="fleet-metric"
        variant="ghost" aria-label={`${label} megnyitása`} onClick={onClick}>
        <Icon size={19} aria-hidden="true" /><span>{short}</span><strong>{value}</strong>
      </Button>)}
      <Button variant="ghost" className="fleet-metric" disabled={!data.vehicles.length} onClick={() => {
        const section = document.getElementById('fleet-service-queue')
        section?.focus()
        section?.scrollIntoView?.({ block: 'nearest' })
      }}>
        <CalendarClock size={19} aria-hidden="true" /><span>Szervizre vár</span><strong>{serviceQueue.length}</strong>
      </Button>
    </div>
    {!data.vehicles.length ? <p className="access-panel dashboard-empty">Ezen a munkaterületen még nincs jármű.</p> : <>
      <div className="fleet-overview-grid">
        <MileageChart months={data.monthlyMileage} />
        <section className="access-panel fleet-rank" aria-labelledby="fleet-rank-title">
          <div className="dashboard-section-heading"><h3 id="fleet-rank-title">Legtöbbet futott járművek</h3><span>6 hónap</span></div>
          {data.topVehicles.length ? <ol>
            {data.topVehicles.map(car => <li key={car.vehicleId}>
              <Button variant="ghost" onClick={() => onVehicle(car.vehicleId)} aria-label={`${car.registration} · ${kilometers(car.kilometers)}`}>
                <span><strong>{car.registration}</strong><small>{car.make} {car.model}</small></span>
                <span>{kilometers(car.kilometers)}</span><ArrowRight size={15} aria-hidden="true"/>
              </Button>
              <div className="fleet-rank-track" aria-hidden="true"><span style={{ width: `${100 * car.kilometers / data.topVehicles[0]!.kilometers}%` }} /></div>
            </li>)}
          </ol> : <p className="dashboard-empty">Még nincs mérhető futásteljesítmény.</p>}
        </section>
        <section id="fleet-service-queue" tabIndex={-1} className="access-panel fleet-rank" aria-labelledby="fleet-queue-title">
          <div className="dashboard-section-heading"><h3 id="fleet-queue-title">Szervizre váró járművek</h3><span>{serviceQueue.length} jármű</span></div>
          {serviceQueue.length ? <ul>{serviceQueue.slice(0, visibleService).map(({ vehicle }) => <li key={vehicle.id}>
            <Button variant="ghost" onClick={() => onVehicle(vehicle.id)} aria-label={`${vehicle.registration} · szerviz`}>
              <span><strong>{vehicle.registration}</strong><small>{serviceDeadlines.get(vehicle.id)}</small></span><ArrowRight size={15} aria-hidden="true"/>
            </Button>
          </li>)}</ul> : <p className="dashboard-empty">Nincs szervizre váró jármű.</p>}
          {serviceQueue.length > visibleService && <div className="dashboard-more"><Button variant="outline"
            onClick={() => setVisibleService(count => count + 5)}>További járművek ({serviceQueue.length - visibleService})</Button></div>}
        </section>
        <section className="access-panel dashboard-deadlines" aria-labelledby="dashboard-deadlines-heading">
          <div className="dashboard-section-heading"><h3 id="dashboard-deadlines-heading">Határidők <span>({deadlines.length})</span></h3><span>Lejárt és következő 30 nap</span></div>
          {deadlines.length ? <ul>{deadlines.slice(0, visibleDeadlines).map(item => {
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
          {deadlines.length > visibleDeadlines && <div className="dashboard-more"><Button variant="outline"
            onClick={() => setVisibleDeadlines(count => count + 6)}>További határidők ({deadlines.length - visibleDeadlines})</Button></div>}
        </section>
      </div>
      {sites.length > 0 && <details className="access-panel dashboard-sites">
        <summary>Járművek telephelyenként <span>({sites.length})</span></summary>
        <dl>{sites.map(([name, count]) => <div key={name}><dt>{name}</dt><dd>{count}</dd></div>)}</dl>
      </details>}
    </>}
  </div>
}

function MileageChart({ months }: { months: DashboardOverview['monthlyMileage'] }) {
  const maximum = Math.max(1, ...months.map(x => x.kilometers ?? 0))
  const total = months.reduce((sum, x) => sum + (x.kilometers ?? 0), 0)
  return <section className="access-panel fleet-mileage" aria-labelledby="fleet-mileage-title">
    <div className="dashboard-section-heading"><h3 id="fleet-mileage-title">Havi futásteljesítmény</h3>
      <span>{months.some(x => x.kilometers !== null) ? kilometers(total) : 'Nincs mérhető adat'}</span></div>
    <ul className="fleet-mileage-chart" aria-label="Havi kilométerek az elmúlt hat hónapban">
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
    <p className="fleet-mileage-note">A két rögzített óraállás különbsége a későbbi rögzítés hónapjához kerül.</p>
  </section>
}
