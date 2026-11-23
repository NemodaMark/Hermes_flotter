import { useId, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { dashboardApi } from './dashboardApi'
import { chartIntervals, chartMetrics, chartModules } from './dashboardModules'
import type { ChartInterval, ChartKind, ChartMetric, DashboardTile } from './dashboardModules'
import { vehicleStatuses } from './fleetApi'
import { QueryMessage } from './FleetFields'
import { Disclosure } from './ui/Disclosure'
import './dashboard-chart.css'

type Point = { month: string; kilometers: number | null }
type Series = { id: string; label: string; values: (number | null)[] }
type Dataset = { labels: string[]; series: Series[]; unit: string }
type ChartScope = { userId: string; tenantId: string; kind: ChartKind; tile: DashboardTile }
const number = new Intl.NumberFormat('hu-HU')
const month = new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'short', timeZone: 'UTC' })
const tones = ['#5187bd', '#d5834b', '#51a28b', '#ad78c0', '#b89832', '#cf7479', '#588f9e', '#9d947e']

function monthKeys(firstMonth: string, months: number) {
  const first = new Date(firstMonth)
  return Array.from({ length: months }, (_, index) => new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + index, 1)).toISOString().slice(0, 10))
}

function mileageDataset(keys: string[], interval: ChartInterval, groups: { id: string; label: string; points: Point[] }[]): Dataset {
  const periods = new Map<string, string[]>()
  for (const key of keys) {
    const year = key.slice(0, 4)
    const quarter = Math.ceil(Number(key.slice(5, 7)) / 3)
    const label = interval === 'year' ? year : interval === 'quarter' ? `${year}. ${quarter}. n.év` : month.format(new Date(key))
    const dates = periods.get(label) ?? []
    dates.push(key)
    periods.set(label, dates)
  }
  return { unit: 'km', labels: [...periods.keys()], series: groups.map(({ id, label, points }) => {
    const values = new Map(points.map(point => [point.month, point.kilometers]))
    return { id, label, values: [...periods.values()].map(keysInPeriod => {
      const measured = keysInPeriod.flatMap(key => values.get(key) ?? [])
      return measured.length ? measured.reduce((sum, value) => sum + value, 0) : null
    }) }
  }) }
}

export function ReportedMileageChart({ userId, tenantId, kind, tile }: ChartScope) {
  const [people, setPeople] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const key = ['dashboard', userId, tenantId, 'reportedMileage', tile.months]
  const totals = useQuery({ queryKey: key, queryFn: ({ signal }) => dashboardApi.mileageChart(tenantId, tile.months, [], signal), retry: false })
  const canSelect = !totals.error && totals.data?.canSelectPeople === true
  const selected = useQuery({ queryKey: [...key, people], enabled: canSelect && people.length > 0,
    queryFn: ({ signal }) => dashboardApi.mileageChart(tenantId, tile.months, people, signal), retry: false })
  const query = canSelect && people.length ? selected : totals
  const data = query.error ? undefined : query.data
  const options = canSelect ? totals.data!.people : []
  const groups = data && (canSelect && people.length ? options.filter(person => people.includes(person.id)).map(person => ({
    id: person.id, label: person.name, points: data.points.filter(point => point.userId === person.id),
  })) : [{ id: '', label: canSelect ? 'Összes munkatárs' : 'Saját km', points: data.points }])
  const dataset = data && groups && mileageDataset(monthKeys(data.firstMonth, data.months), tile.chartInterval ?? 'month', groups)

  return <ChartPanel kind={kind} metric="reportedMileage" tile={tile} dataset={dataset}
    control={canSelect && options.length > 0 && <Disclosure className="chart-people" summaryClassName="chart-people-trigger" label="Személyek szűrése"
      trigger={<><Users size={15} aria-hidden="true" /><span>{people.length ? `${people.length} kiválasztva` : 'Összes munkatárs'}</span></>}>
      <div className="chart-people-options">
        <input type="search" aria-label="Munkatárs keresése" placeholder="Keresés név alapján" value={search} onChange={event => setSearch(event.target.value)} />
        <fieldset aria-label="Munkatársak">
          <label><input type="checkbox" checked={!people.length} onChange={() => setPeople([])} />Összes munkatárs</label>
          {options.filter(person => `${person.name} ${person.id}`.toLocaleLowerCase('hu').includes(search.trim().toLocaleLowerCase('hu'))).map(person =>
            <label key={person.id}><input type="checkbox" checked={people.includes(person.id)} disabled={people.length === 100 && !people.includes(person.id)}
              onChange={event => setPeople(ids => event.target.checked ? [...ids, person.id].sort() : ids.filter(id => id !== person.id))} />{person.name} <small>@{person.id}</small></label>)}
        </fieldset>
      </div>
    </Disclosure>}>
    <QueryMessage pending={query.isPending} error={query.error} retry={() => void query.refetch()} />
  </ChartPanel>
}

export function FleetDataChart({ userId, tenantId, site, kind, tile }: ChartScope & { site: string }) {
  const metric = tile.chartMetric === 'vehicleStatus' ? 'vehicleStatus' : 'fleetMileage'
  const filters = { status: tile.status, search: tile.search.trim(), months: metric === 'fleetMileage' ? tile.months : 6, includeMileage: metric === 'fleetMileage' }
  const key = ['dashboard', userId, tenantId, 'widgets', site, filters]
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => dashboardApi.overview(tenantId, site, signal, filters), retry: false, refetchInterval: 30000 })
  const data = query.error ? undefined : query.data
  let dataset: Dataset | undefined
  if (data) {
    const statuses = Object.entries(vehicleStatuses)
    dataset = metric === 'fleetMileage' ? mileageDataset(data.monthlyMileage.map(point => point.month), tile.chartInterval ?? 'month', [
      { id: '', label: 'Flotta', points: data.monthlyMileage },
    ]) : { unit: 'jármű', labels: statuses.map(([, label]) => label), series: [{ id: '', label: 'Flotta',
      values: statuses.map(([status]) => data.vehicles.filter(({ vehicle }) => vehicle.status === status).length) }] }
  }
  return <ChartPanel kind={kind} metric={metric} tile={tile} dataset={dataset}>
    <QueryMessage pending={query.isPending} error={query.error} retry={() => void query.refetch()} />
  </ChartPanel>
}

function ChartPanel({ kind, metric, tile, dataset, control, children }: {
  kind: ChartKind; metric: ChartMetric; tile: DashboardTile; dataset?: Dataset; control?: ReactNode; children: ReactNode
}) {
  const heading = useId()
  return <section className="access-panel dashboard-chart" aria-labelledby={heading}>
    <div className="dashboard-section-heading">
      <div><h3 id={heading}>{chartMetrics[metric]}</h3>
        <small>{chartModules[kind]} · {metric === 'vehicleStatus' ? 'Jelenlegi állapot' : `${chartIntervals[tile.chartInterval ?? 'month']} · ${tile.months} hónap`}</small></div>
      {control}
    </div>
    {children}
    {dataset && (dataset.series.some(series => series.values.some(value => value !== null))
      ? <>
        {kind === 'pie' ? <PieChart data={dataset} /> : <AxisChart kind={kind} data={dataset} />}
        <details className="chart-data-details"><summary>Adatok táblázatban</summary>
          <div className="chart-data-scroll" tabIndex={0} role="region" aria-label="Diagramadatok">
            <table><thead><tr><th scope="col">{metric === 'vehicleStatus' ? 'Állapot' : 'Időszak'}</th>
              {dataset.series.map(series => <th key={series.id} scope="col">{series.label} ({dataset.unit})</th>)}</tr></thead>
              <tbody>{dataset.labels.map((label, index) => <tr key={label}><th scope="row">{label}</th>
                {dataset.series.map(series => <td key={series.id}>{series.values[index] == null ? '–' : number.format(series.values[index]!)}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </details>
      </> : <p className="dashboard-empty">Ebben az időszakban nincs megjeleníthető adat.</p>)}
  </section>
}

function AxisChart({ kind, data }: { kind: 'bar' | 'scatter'; data: Dataset }) {
  const maxima = data.labels.map((_, index) => {
    const values = data.series.map(series => series.values[index] ?? 0)
    return kind === 'bar' ? values.reduce((sum, value) => sum + value, 0) : Math.max(...values)
  })
  const peak = Math.max(1, ...maxima)
  const step = 10 ** Math.floor(Math.log10(peak / 4))
  const tick = Math.max(1, Math.ceil(peak / 4 / step) * step)
  const max = tick * 4
  return <>
    <div className="chart-plot-scroll" role="region" aria-label="Diagram" tabIndex={0}>
      <div className="chart-plot" style={{ '--chart-columns': data.labels.length } as CSSProperties}>
        <div className="chart-axis" aria-hidden="true">{[4, 3, 2, 1, 0].map(n => <span key={n}>{number.format(n * tick)}</span>)}</div>
        <div className="chart-columns">{data.labels.map((label, column) => {
          let previous = 0
          return <div key={label} className="chart-column">
            <div className="chart-marks">{data.series.map((series, index) => {
              const value = series.values[column]
              if (value == null) return null
              const base = previous
              previous += value
              return <span key={series.id} className={`chart-mark chart-mark-${kind}`} title={`${label} · ${series.label} · ${number.format(value)} ${data.unit}`}
                style={{ '--mark-color': tones[index % tones.length], '--mark-bottom': `${100 * (kind === 'bar' ? base : value) / max}%`,
                  '--mark-size': `${100 * value / max}%`, '--mark-x': `${(index + 1) / (data.series.length + 1) * 100}%` } as CSSProperties} />
            })}</div>
            <span className="chart-category">{label}</span>
          </div>
        })}</div>
      </div>
    </div>
    <ul className="chart-legend" aria-label="Adatsorok">{data.series.map((series, index) => <li key={series.id}>
      <i style={{ background: tones[index % tones.length] }} />{series.label} · {data.unit}
    </li>)}</ul>
  </>
}

function PieChart({ data }: { data: Dataset }) {
  const perPerson = data.series.some(series => series.id !== '')
  const rows = perPerson ? data.series.map(series => ({ label: series.label, value: series.values.reduce<number>((sum, value) => sum + (value ?? 0), 0) }))
    : data.labels.map((label, index) => ({ label, value: data.series[0]?.values[index] ?? 0 }))
  const positive = rows.filter(row => row.value > 0)
  const total = positive.reduce((sum, row) => sum + row.value, 0)
  if (!total) return <p className="dashboard-empty">Összesen 0 {data.unit}.</p>
  const segments: string[] = []
  let angle = 0
  for (const [index, row] of positive.entries()) {
    const start = angle
    angle += row.value / total * 360
    segments.push(`${tones[index % tones.length]} ${start}deg ${angle}deg`)
  }
  return <div className="chart-pie-layout">
    <div className="chart-pie" aria-hidden="true" style={{ background: `conic-gradient(${segments.join(',')}${segments.length === 1 ? `, ${tones[0]} 360deg` : ''})` }} />
    <ul className="chart-legend chart-pie-legend" aria-label="Megoszlás">{positive.map((row, index) => <li key={index}>
      <i style={{ background: tones[index % tones.length] }} /><span>{row.label}</span><strong>{number.format(row.value)} {data.unit}</strong>
    </li>)}</ul>
  </div>
}
