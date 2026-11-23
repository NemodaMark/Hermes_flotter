import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Pencil, Plus, RotateCcw, StickyNote } from 'lucide-react'
import { api, vehicleKey } from './api'
import type { Session, Tenant } from './api'
import { dashboardApi } from './dashboardApi'
import { dashboardModules, dashboardSize, isOverviewModule, makeTile, overviewModules, readDashboardLayout } from './dashboardModules'
import type { DashboardTile, ModuleKind, OverviewModule } from './dashboardModules'
import { DashboardGrid } from './DashboardGrid'
import type { DashboardDrag, DashboardDrop } from './DashboardGrid'
import { FleetDashboardOverview, OverviewModuleContent } from './FleetDashboardOverview'
import { AccessDialog } from './AccessDialog'
import { QueryMessage } from './FleetFields'
import { vehicleStatuses } from './fleetApi'
import { personalKey, removePersonal, writePersonal } from './personalStorage'
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

export function DashboardOverview({ viewSwitch, quickActions, onFleet, ...props }: DashboardProps & {
  viewSwitch: ReactNode; quickActions: ReactNode; onFleet: (status?: string) => void
}) {
  const { user, tenant, siteId, canOverview, canVehicles, onVehicle, onMileage } = props
  const key = personalKey(user.id, 'dashboard-layout-v1', tenant.id)
  const paletteId = useId()
  const [saved, setSaved] = useState(() => readDashboardLayout(key))
  const [draft, setDraft] = useState<DashboardTile[] | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [adding, setAdding] = useState(false)
  const [config, setConfig] = useState<DashboardTile | null>(null)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')

  function allowed(kind: ModuleKind) {
    if (isOverviewModule(kind)) return canOverview
    if (kind === 'vehicles') return canVehicles
    if (kind === 'settlement') return Boolean(onMileage)
    return true
  }

  const defaults: ModuleKind[] = canOverview ? (Object.keys(overviewModules) as OverviewModule[]) : canVehicles ? ['vehicles'] : []
  const layout = saved ?? defaults.map(kind => makeTile(kind, kind))
  const visible = (draft ?? layout).filter(tile => allowed(tile.kind))
  const showDefaultOverview = !draft && saved === undefined && canOverview
  const catalogue = (Object.keys(dashboardModules) as ModuleKind[]).filter(allowed)

  function newTile(kind: ModuleKind) {
    const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, '0')).join('')
    return makeTile(kind, id)
  }

  function drop(source: DashboardDrag, target: DashboardDrop) {
    if (!draft) return
    const tile = 'kind' in source ? newTile(source.kind) : draft.find(item => item.id === source.id)
    if (!tile || (target !== 'end' && target.id === tile.id)) return
    const next = draft.filter(item => item.id !== tile.id)
    const at = target === 'end' ? next.length : next.findIndex(item => item.id === target.id) + Number(target.after)
    next.splice(at, 0, tile)
    setDraft(next)
    setAnnouncement(`${dashboardModules[tile.kind]} ${'kind' in source ? 'hozzáadva' : 'áthelyezve'}.`)
  }

  function stopEditing() {
    setDraft(null)
    setAdding(false)
    setError('')
  }

  function save() {
    if (!draft) return
    if (!writePersonal(key, draft)) {
      setError('A böngésző nem tudta menteni az elrendezést. A módosításaid továbbra is itt vannak a szerkesztőben.')
      return
    }
    setSaved(draft)
    stopEditing()
    setAnnouncement('Az egyéni nézet mentve.')
  }

  function reset() {
    setConfirmReset(false)
    if (!removePersonal(key)) {
      setError('A böngésző nem tudta visszaállítani az alapelrendezést.')
      return
    }
    setSaved(undefined)
    setError('')
    setAnnouncement('Az alapelrendezés visszaállítva.')
  }

  return <div className="dashboard-overview">
    <div className="dashboard-heading">
      {viewSwitch}
      <div className="dashboard-heading-actions">
        {draft ? <>
          <Button variant="outline" aria-expanded={adding} aria-controls={adding ? paletteId : undefined}
            onClick={() => setAdding(open => !open)}><Plus size={17} aria-hidden="true" />Modul hozzáadása</Button>
          <Button variant="ghost" onClick={stopEditing}>Mégse</Button>
          <Button variant="default" onClick={save}>Elrendezés mentése</Button>
        </> : <>
          {quickActions}
          <Button variant="outline" aria-label="Elrendezés szerkesztése" onClick={() => setDraft(layout)}><Pencil size={16} aria-hidden="true" />Szerkesztés</Button>
          {saved !== undefined && <Button variant="outline" aria-label="Alapelrendezés visszaállítása" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={16} aria-hidden="true" />Alap visszaállítása
          </Button>}
        </>}
      </div>
    </div>
    <span className="sr-only" role="status">{announcement}</span>
    {error && <p className="notice error" role="alert">{error}</p>}
    {showDefaultOverview ? <FleetDashboardOverview userId={user.id} tenantId={tenant.id} siteId={siteId} onFleet={onFleet} onVehicle={onVehicle} />
      : !draft && visible.length === 0 ? <div className="access-panel dashboard-empty">
        <p>Még nincsenek modulok az áttekintődben.</p>
        <Button variant="outline" onClick={() => { setDraft(layout); setAdding(true) }}><Plus size={17} />Első modul hozzáadása</Button>
      </div>
      : <DashboardGrid tiles={visible} paletteId={paletteId} editor={draft ? {
        catalogue: adding ? catalogue : null,
        onChoose: kind => setConfig(newTile(kind)),
        onDrop: drop,
        onResize: (id, size) => {
          setDraft(draft.map(tile => tile.id === id ? { ...tile, ...size } : tile))
          setAnnouncement('A modul mérete módosítva.')
        },
        onSettings: setConfig,
        onRemove: id => setDraft(draft.filter(tile => tile.id !== id)),
      } : undefined}>{tile => <DashboardTileContent {...props} tile={tile} />}</DashboardGrid>}
    {confirmReset && <AccessDialog title="Alapelrendezés visszaállítása" pending={false} onClose={() => setConfirmReset(false)}>
      <p>Az egyéni elrendezés, a szűrők és az áttekintőben mentett jegyzetek törlődnek.</p>
      <div className="dialog-actions">
        <Button type="button" variant="outline" data-autofocus onClick={() => setConfirmReset(false)}>Mégse</Button>
        <Button type="button" variant="destructive" onClick={reset}>Visszaállítás</Button>
      </div>
    </AccessDialog>}
    {config && draft && <TileSettings key={config.id} tile={config} sites={props.sites} canUnassigned={props.canUnassigned}
      onClose={() => setConfig(null)} onApply={next => {
        setDraft(draft.some(tile => tile.id === next.id) ? draft.map(tile => tile.id === next.id ? next : tile) : [...draft, next])
        setConfig(null)
      }} />}
  </div>
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
      <div className="custom-tile-dimensions">
        <label className="org-field"><span>Szélesség (oszlop)</span><input type="number" min={dashboardSize.minColumns} max={dashboardSize.columns}
          required value={value.columns || ''} onChange={e => change({ columns: Number(e.target.value) })} /></label>
        <label className="org-field"><span>Magasság (px)</span><input type="number" min={dashboardSize.minHeight} max={dashboardSize.maxHeight}
          placeholder="Automatikus" value={value.height ?? ''} onChange={e => change({ height: e.target.value === '' ? null : Number(e.target.value) })} /></label>
      </div>
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
