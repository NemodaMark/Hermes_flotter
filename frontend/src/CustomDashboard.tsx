import { useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowRight, ArrowUp, Grip, Pencil, Plus, Settings2, StickyNote, Trash2 } from 'lucide-react'
import { api, vehicleKey } from './api'
import type { Session, Tenant } from './api'
import { dashboardApi } from './dashboardApi'
import { dashboardModules, isDashboardLayout, isOverviewModule, makeTile } from './dashboardModules'
import type { DashboardTile, ModuleKind, OverviewModule } from './dashboardModules'
import { OverviewModuleContent } from './FleetDashboardOverview'
import { AccessDialog } from './AccessDialog'
import { QueryMessage } from './FleetFields'
import { vehicleStatuses } from './fleetApi'
import { personalKey, readPersonal, writePersonal } from './personalStorage'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import './custom-dashboard.css'

type Scope = { user: Session; tenant: Tenant; siteId: string; sites: { id: string; name: string }[]; canUnassigned: boolean }
type DashboardProps = Scope & {
  canOverview: boolean
  canVehicles: boolean
  onVehicle: (id: string) => void
  onMileage?: () => void
  dueMonth?: string | null
}

export function CustomDashboard(props: DashboardProps) {
  const { user, tenant, canOverview, canVehicles, onMileage } = props
  const key = personalKey(user.id, 'dashboard-layout-v1', tenant.id)
  const [saved, setSaved] = useState(() => {
    const defaults: ModuleKind[] = canOverview ? ['metrics', 'mileage', 'ranking', 'service', 'deadlines', 'sites'] : canVehicles ? ['vehicles'] : []
    return readPersonal(key, isDashboardLayout) ?? defaults.map(kind => makeTile(kind, kind))
  })
  const [draft, setDraft] = useState<DashboardTile[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [config, setConfig] = useState<DashboardTile | null>(null)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const drag = useRef<{ id: string; y: number } | null>(null)

  function allowed(kind: ModuleKind) {
    if (isOverviewModule(kind)) return canOverview
    if (kind === 'vehicles') return canVehicles
    if (kind === 'settlement') return Boolean(onMileage)
    return true
  }

  const visible = (draft ?? saved).filter(tile => allowed(tile.kind))
  const catalogue = (Object.keys(dashboardModules) as ModuleKind[]).filter(allowed)

  function move(id: string, targetId: string) {
    if (!draft || id === targetId) return
    const from = draft.findIndex(tile => tile.id === id)
    const to = draft.findIndex(tile => tile.id === targetId)
    if (from < 0 || to < 0) return
    const next = [...draft]
    next.splice(to, 0, next.splice(from, 1)[0]!)
    setDraft(next)
    setAnnouncement(`${dashboardModules[next[to]!.kind]} áthelyezve.`)
  }

  function save() {
    if (!draft) return
    if (!writePersonal(key, draft)) {
      setError('A böngésző nem tudta menteni az elrendezést. A módosításaid továbbra is itt vannak a szerkesztőben.')
      return
    }
    setSaved(draft)
    setDraft(null)
    setError('')
    setAnnouncement('Az egyéni nézet mentve.')
  }

  function targetAt(event: PointerEvent) {
    return document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-dashboard-tile]')?.dataset.dashboardTile ?? null
  }

  function dragStart(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (!event.isPrimary || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { id, y: event.clientY }
    setDropTarget(id)
  }

  function dragMove(event: PointerEvent<HTMLButtonElement>) {
    if (!drag.current) return
    const delta = event.clientY - drag.current.y
    if (delta > 0 && event.clientY > window.innerHeight - 64) window.scrollBy(0, delta)
    if (delta < 0 && event.clientY < 64) window.scrollBy(0, delta)
    drag.current.y = event.clientY
    setDropTarget(targetAt(event))
  }

  function dragEnd(event: PointerEvent<HTMLButtonElement>) {
    const target = targetAt(event)
    if (target && drag.current) move(drag.current.id, target)
    cancelDrag()
  }

  function cancelDrag() {
    drag.current = null
    setDropTarget(null)
  }

  return <section className="custom-dashboard" aria-label="Egyéni dashboard">
    <div className="custom-dashboard-toolbar">
      <h2>Egyéni dashboard</h2>
      <div className="custom-dashboard-actions">
        {draft ? <>
          <Button variant="outline" onClick={() => setAdding(true)}><Plus size={17} />Modul hozzáadása</Button>
          <Button variant="ghost" onClick={() => { setDraft(null); setError('') }}>Mégse</Button>
          <Button variant="default" onClick={save}>Elrendezés mentése</Button>
        </> : <Button variant="outline" onClick={() => setDraft(saved)}><Pencil size={16} />Szerkesztés</Button>}
      </div>
    </div>
    <span className="sr-only" role="status">{announcement}</span>
    {error && <p className="notice error" role="alert">{error}</p>}
    {visible.length === 0 && <div className="access-panel dashboard-empty">
      <p>Még nincsenek modulok az egyéni nézetedben.</p>
      <Button variant="outline" onClick={() => { if (!draft) setDraft(saved); setAdding(true) }}><Plus size={17} />Első modul hozzáadása</Button>
    </div>}
    <div className="custom-dashboard-grid">
      {visible.map((tile, index) => {
        const title = tile.kind === 'note' && tile.title.trim() ? tile.title : dashboardModules[tile.kind]
        return <article key={tile.id} className="custom-dashboard-tile" data-dashboard-tile={tile.id}
          data-wide={tile.wide} data-drop={dropTarget === tile.id} aria-label={title}>
          {draft && <div className="custom-tile-controls">
            <Button className="icon-button custom-tile-grip" aria-label={`${title} mozgatása húzással`} tabIndex={-1}
              onPointerDown={event => dragStart(event, tile.id)} onPointerMove={dragMove}
              onPointerUp={dragEnd} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag} title="Mozgatás húzással"><Grip size={18} /></Button>
            <span className="custom-tile-edit-label">{title}</span>
            <Button className="icon-button" aria-label={`${title} előrébb`} disabled={index === 0} onClick={() => move(tile.id, visible[index - 1]!.id)}><ArrowUp size={16} /></Button>
            <Button className="icon-button" aria-label={`${title} hátrébb`} disabled={index === visible.length - 1} onClick={() => move(tile.id, visible[index + 1]!.id)}><ArrowDown size={16} /></Button>
            <Button className="icon-button" aria-label={`${title} beállításai`} onClick={() => setConfig(tile)}><Settings2 size={16} /></Button>
            <Button className="icon-button" aria-label={`${title} eltávolítása`} onClick={() => setDraft(draft.filter(item => item.id !== tile.id))}><Trash2 size={16} /></Button>
          </div>}
          <DashboardTileContent {...props} tile={tile} />
        </article>
      })}
    </div>
    {adding && draft && <AccessDialog title="Modul hozzáadása" pending={false} onClose={() => setAdding(false)}>
      <div className="custom-module-list">
        {catalogue.map(kind => <Button key={kind} variant="ghost" onClick={() => {
          const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, '0')).join('')
          setAdding(false)
          setConfig(makeTile(kind, id))
        }}>{dashboardModules[kind]}<Plus size={17} aria-hidden="true" /></Button>)}
      </div>
    </AccessDialog>}
    {config && draft && <TileSettings key={config.id} tile={config} sites={props.sites} canUnassigned={props.canUnassigned}
      onClose={() => setConfig(null)} onApply={next => {
        setDraft(draft.some(tile => tile.id === next.id) ? draft.map(tile => tile.id === next.id ? next : tile) : [...draft, next])
        setConfig(null)
      }} />}
  </section>
}

function DashboardTileContent({ tile, ...props }: DashboardProps & { tile: DashboardTile }) {
  if (tile.kind === 'note') return <section className="access-panel custom-note">
    <div className="dashboard-section-heading"><h3><StickyNote size={17} aria-hidden="true" />{tile.title.trim() || 'Jegyzet'}</h3></div>
    <p>{tile.note.trim() || 'Üres jegyzet.'}</p>
  </section>

  if (tile.kind === 'settlement') return <section className="access-panel custom-settlement">
    <div className="dashboard-section-heading"><h3>Havi km-elszámolás</h3></div>
    <Button variant="outline" onClick={props.onMileage}>{props.dueMonth ? `Lezárandó hónap · ${props.dueMonth.slice(0, 7)}` : 'Elszámolás megnyitása'}<ArrowRight size={16} /></Button>
  </section>

  const site = tile.site === 'workspace' ? props.siteId : tile.site
  const siteName = site === 'all' ? 'Összes telephely' : site === 'none' ? 'Telephely nélkül' : props.sites.find(item => item.id === site)?.name
  if (!siteName || (site === 'none' && !props.canUnassigned)) {
    return <div className="access-panel dashboard-empty" role="status">A modul telephelye nem érhető el.</div>
  }

  const activeFilters = [
    tile.site !== 'workspace' ? siteName : null,
    tile.status === 'all' ? null : vehicleStatuses[tile.status as keyof typeof vehicleStatuses],
    tile.search.trim() || null,
  ].filter(Boolean)
  return <>
    {activeFilters.length > 0 && <p className="custom-tile-filter-summary">{activeFilters.join(' · ')}</p>}
    {tile.kind === 'vehicles' ? <VehicleListTile key={JSON.stringify([site, tile.status, tile.search, tile.limit])} {...props} tile={tile} site={site} />
      : <OverviewTile key={JSON.stringify([site, tile.status, tile.search, tile.limit, tile.deadlineType, tile.deadlineTiming])} {...props} tile={tile} kind={tile.kind} site={site} />}
  </>
}

function OverviewTile({ user, tenant, tile, kind, site, onVehicle }: Scope & {
  tile: DashboardTile; kind: OverviewModule; site: string; onVehicle: (id: string) => void
}) {
  const includeMileage = kind === 'mileage' || kind === 'ranking'
  const filters = { status: tile.status, search: tile.search.trim(), months: includeMileage ? tile.months : 6, includeMileage }
  const key = ['dashboard', user.id, tenant.id, 'widgets', site, filters]
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => dashboardApi.overview(tenant.id, site, signal, filters), retry: false, refetchInterval: 30000 })
  return <>
    <QueryMessage pending={query.isPending} error={query.error} retry={() => void query.refetch()} />
    {!query.error && query.data && <OverviewModuleContent kind={kind} data={query.data}
      limit={tile.limit} deadlineType={tile.deadlineType} deadlineTiming={tile.deadlineTiming} onVehicle={onVehicle} />}
  </>
}

function VehicleListTile({ user, tenant, tile, site, onVehicle }: Scope & {
  tile: DashboardTile; site: string; onVehicle: (id: string) => void
}) {
  const [page, setPage] = useState(1)
  const filters = { page, pageSize: tile.limit, search: tile.search.trim(), status: tile.status, siteId: site }
  const query = useQuery({ queryKey: [...vehicleKey(user.id, tenant.id), 'widget', filters],
    queryFn: ({ signal }) => api.searchVehicles(tenant.id, filters, signal), retry: false, refetchInterval: 30000 })
  const result = query.error ? undefined : query.data
  return <section className="access-panel fleet-rank" aria-label="Járműlista">
    <div className="dashboard-section-heading"><h3>Járműlista</h3>{result && <span>{result.total} jármű</span>}</div>
    <QueryMessage pending={query.isPending} error={query.error} retry={() => void query.refetch()} />
    {result && (result.items.length ? <ul>{result.items.map(car => <li key={car.id}>
      <Button variant="ghost" onClick={() => onVehicle(car.id)}>
        <span><strong>{car.registration}</strong><small>{car.make} {car.model}</small></span><ArrowRight size={15} aria-hidden="true" />
      </Button>
    </li>)}</ul> : <p className="dashboard-empty">Nincs a szűrésnek megfelelő jármű.</p>)}
    {result && result.total > result.pageSize && <div className="dashboard-more custom-list-pagination">
      <Button variant="outline" disabled={result.page === 1 || query.isFetching} onClick={() => setPage(result.page - 1)}>Előző</Button>
      <span>{result.page} / {Math.ceil(result.total / result.pageSize)}</span>
      <Button variant="outline" disabled={result.page * result.pageSize >= result.total || query.isFetching} onClick={() => setPage(result.page + 1)}>Következő</Button>
    </div>}
  </section>
}

const deadlineTypes = {
  all: 'Minden határidő', inspection: 'Műszaki vizsga', insurance: 'Biztosítás',
  service: 'Következő szerviz', 'service-km': 'Szerviz kilométerhatára', appointment: 'Szervizidőpont',
}

function TileSettings({ tile, sites, canUnassigned, onClose, onApply }: {
  tile: DashboardTile; sites: Scope['sites']; canUnassigned: boolean
  onClose: () => void; onApply: (tile: DashboardTile) => void
}) {
  const [value, setValue] = useState(tile)
  const change = (values: Partial<DashboardTile>) => setValue({ ...value, ...values })
  const isData = tile.kind !== 'note' && tile.kind !== 'settlement'
  const hasPeriod = tile.kind === 'mileage' || tile.kind === 'ranking'
  const hasLimit = tile.kind === 'vehicles' || tile.kind === 'service' || tile.kind === 'ranking' || tile.kind === 'deadlines'
  return <AccessDialog title={`${dashboardModules[tile.kind]} · Beállítások`} pending={false} onClose={onClose}>
    <form className="custom-tile-form" onSubmit={event => { event.preventDefault(); onApply(value) }}>
      {tile.kind === 'note' && <>
        <label className="org-field"><span>Cím</span><input value={value.title} onChange={e => change({ title: e.target.value })} data-autofocus /></label>
        <label className="org-field"><span>Jegyzet</span><textarea rows={6} value={value.note} onChange={e => change({ note: e.target.value })} /></label>
      </>}
      <label className="org-field"><span>Szélesség</span><Select value={value.wide ? 'full' : 'half'} onChange={e => change({ wide: e.target.value === 'full' })}>
        <option value="half">Fél szélesség</option><option value="full">Teljes szélesség</option>
      </Select></label>
      {isData && <>
        <label className="org-field"><span>Telephely</span><Select value={value.site} onChange={e => change({ site: e.target.value })}>
          <option value="workspace">A kiválasztott munkaterület</option><option value="all">Összes telephely</option>
          {canUnassigned && <option value="none">Telephely nélkül</option>}
          {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          {!['workspace', 'all', ...(canUnassigned ? ['none'] : [])].includes(value.site) && !sites.some(site => site.id === value.site) && <option value={value.site}>Nem elérhető telephely</option>}
        </Select></label>
        <label className="org-field"><span>Járműállapot</span><Select value={value.status} onChange={e => change({ status: e.target.value })}>
          <option value="all">Minden állapot</option>
          {Object.entries(vehicleStatuses).map(([status, label]) => <option key={status} value={status}>{label}</option>)}
        </Select></label>
        <label className="org-field"><span>Rendszám, gyártó vagy modell</span><input maxLength={200} value={value.search} onChange={e => change({ search: e.target.value })} /></label>
      </>}
      {hasPeriod && <label className="org-field"><span>Időszak</span><Select value={String(value.months)} onChange={e => change({ months: Number(e.target.value) })}>
        {[1, 3, 6, 12].map(months => <option key={months} value={months}>{months} hónap</option>)}
      </Select></label>}
      {hasLimit && <label className="org-field"><span>Megjelenített sorok</span><Select value={String(value.limit)} onChange={e => change({ limit: Number(e.target.value) })}>
        {(tile.kind === 'ranking' ? [3, 5] : [3, 5, 6, 10, 20]).map(limit => <option key={limit} value={limit}>{limit}</option>)}
      </Select></label>}
      {tile.kind === 'deadlines' && <>
        <label className="org-field"><span>Határidő típusa</span><Select value={value.deadlineType} onChange={e => change({ deadlineType: e.target.value as DashboardTile['deadlineType'] })}>
          {Object.entries(deadlineTypes).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select></label>
        <label className="org-field"><span>Esedékesség</span><Select value={value.deadlineTiming} onChange={e => change({ deadlineTiming: e.target.value as DashboardTile['deadlineTiming'] })}>
          <option value="all">Összes</option><option value="overdue">Lejárt</option><option value="upcoming">Közelgő</option>
        </Select></label>
      </>}
      <div className="dialog-actions"><Button type="button" variant="outline" onClick={onClose}>Mégse</Button><Button variant="default">Alkalmazás</Button></div>
    </form>
  </AccessDialog>
}
