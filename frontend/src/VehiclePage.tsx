import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, Ellipsis, Pencil, RefreshCw } from 'lucide-react'
import type { Session, Tenant } from './api'
import type { SaveVehicle, VehicleRecord } from './fleetApi'
import type { StudioSection } from './VehicleStudio'
import { fleetApi, dateText, vehicleStatuses } from './fleetApi'
import { MetadataLine } from './OrganizationForms'
import { QueryMessage, ReasonDialog } from './FleetFields'
import { VehicleFields } from './VehicleFields'
import { VehicleAssignee } from './VehicleMedia'
import { VehicleRecordingActions } from './VehicleActions'
import { ProfileVehicleGarage } from './VehicleGarage'
import { VehicleTaskContent, VehicleReadData } from './VehicleTaskContent'
import { vehicleTaskAllowed } from './vehicleDetailModel'
import { VehicleDetailGroup } from './VehicleDetailGroup'
import { VehicleHistory } from './VehicleHistory'
import { useVehicleDetails } from './useVehicleDetails'
import { dashboardDeadlines, deadlineState } from './dashboardDeadlines'
import { localMileageDate } from './mileageApi'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Disclosure } from './ui/Disclosure'
import { AccessDialog } from './AccessDialog'
import './fleet.css'
import './vehicle-profile.css'

const MileagePanel = lazy(() => import('./MileagePanel').then(m => ({ default: m.MileagePanel })))
const pages = { overview: 'Áttekintés', driving: 'Tankolás és km', usage: 'Használat', service: 'Szerviz és iratok', history: 'Előzmények' }
type VehiclePageKey = keyof typeof pages
function pageFor(section: string): VehiclePageKey {
  if (['fuel', 'driving'].includes(section)) return 'driving'
  if (['site', 'bookings', 'handovers', 'usage'].includes(section)) return 'usage'
  if (['services', 'documents', 'leases', 'service'].includes(section)) return 'service'
  if (['history', 'assignees', 'audit'].includes(section)) return 'history'
  return 'overview'
}

export function VehiclePage({ user, tenant, id, onBack, initialTab = 'data', showGarage = true }: {
  user: Session; tenant: Tenant; id: string; onBack: () => void; initialTab?: string; showGarage?: boolean
}) {
  const { record, can, changed } = useVehicleDetails(user, tenant, id)
  const [page, setPage] = useState<VehiclePageKey>(() => pageFor(initialTab))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuToggle = useRef<HTMLButtonElement>(null)
  const [editing, setEditing] = useState(false)
  const [draftRecord, setDraftRecord] = useState<VehicleRecord | null>(null)
  const [garage, setGarage] = useState(initialTab === 'garage')
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [message, setMessage] = useState('')
  const car = record.isError ? undefined : record.data?.vehicle
  const mutable = car?.status !== 'Archived'
  const allowed = (section: StudioSection) => !!record.data && vehicleTaskAllowed(section, record.data, tenant)
  const contentProps = record.data ? { user, tenant, record: record.data, onChanged: changed } : null
  const task = (section: StudioSection, showCurrent = true) => contentProps && allowed(section)
    ? <VehicleTaskContent {...contentProps} section={section} showCurrent={showCurrent} /> : null
  const group = (section: StudioSection, title: string) => allowed(section) && <VehicleDetailGroup key={section} title={title} defaultOpen={initialTab === section}>{task(section)}</VehicleDetailGroup>
  const mileage = tenant.permissions.some(code => ['mileage.record', 'mileage.manage'].includes(code) || code.startsWith('vehicles.settlements.'))
  const selectPage = (next: VehiclePageKey) => { setPage(next); if (menuOpen) menuToggle.current?.focus(); setMenuOpen(false) }
  return <>
    <Button className="text-button org-back" onClick={onBack}><ArrowLeft size={16} />Vissza a járművekhez</Button>
    <section className="access-panel vehicle-detail-panel vehicle-workspace" aria-label="Járműadatlap">
      <header className="vehicle-profile-header">
        <div><h2>{car?.registration ?? 'Járműadatlap'}</h2>{car && <p>{car.make} {car.model}</p>}</div>
        {car && !editing && <div className="vehicle-profile-actions">
          <VehicleRecordingActions key={car.id} user={user} tenant={tenant} vehicle={car} />
          {can('vehicles.update') && mutable && <Button variant="outline" onClick={() => { setDraftRecord(record.data!); setEditing(true) }}><Pencil size={16} />Szerkesztés</Button>}
          {showGarage && <Button variant="outline" onClick={() => setGarage(true)}>3D garázs</Button>}
          <Disclosure className="vehicle-more-actions" trigger={<><Ellipsis size={18} /><span>Műveletek</span></>}>
            <div><Button variant="ghost" disabled={record.isFetching} onClick={() => void changed()}><RefreshCw size={16} />Adatok frissítése</Button>
              {can('vehicles.archive') && <Button variant="ghost" className={mutable ? 'danger-text' : ''} onClick={() => setArchiveOpen(true)}>{mutable ? 'Archiválás' : 'Visszaállítás'}</Button>}</div>
          </Disclosure>
        </div>}
        {car && <div className="vehicle-profile-context"><span className={`status status-${car.status.toLowerCase()}`}>{vehicleStatuses[car.status as keyof typeof vehicleStatuses]}</span>
          <span>{car.odometerKm == null ? 'Nincs km-adat' : `${car.odometerKm.toLocaleString('hu-HU')} km`}</span>
          <span>{car.siteName ?? 'Telephely nélkül'}</span><VehicleAssignee tenant={tenant} car={car} onChanged={changed} readOnly />
        </div>}
      </header>
      <QueryMessage pending={record.isPending} error={record.error} retry={() => void record.refetch()} />
      {message && <p className="notice" role="status">{message}</p>}
      {record.data && car && <>
        {car.status === 'Archived' && <p className="notice">Archivált jármű · {record.data.statusReason}. A visszaállítás után szerkeszthető.</p>}
        {editing && can('vehicles.update') && mutable ? <div className="vehicle-editor">
          <h3>Járműadatok szerkesztése</h3>
          <VehicleDataForm tenantId={tenant.id} record={draftRecord ?? record.data} editable onCancel={() => setEditing(false)}
            onSaved={async () => { await changed(); setEditing(false); setMessage('A jármű adatai elmentve.') }} />
        </div> : <div className="vehicle-profile-layout">
          <Button ref={menuToggle} className="vehicle-section-toggle" variant="outline" aria-expanded={menuOpen} aria-controls="vehicle-section-menu" onClick={() => setMenuOpen(value => !value)}>{pages[page]}<span>Menü</span></Button>
          <nav id="vehicle-section-menu" className={`vehicle-section-menu${menuOpen ? ' is-open' : ''}`} aria-label="Járműadatlap részei">
            {Object.entries(pages).map(([key, label]) => <Button key={key} variant="ghost" aria-current={page === key ? 'page' : undefined} onClick={() => selectPage(key as VehiclePageKey)}>{label}</Button>)}
          </nav>
          <div className="vehicle-profile-content" key={page}>
            {page === 'overview' && <>
              <VehicleAttention record={record.data} onOpen={selectPage} />
              <h3>Járműadatok</h3><VehicleReadData tenant={tenant} record={record.data} />
              {group('photos', 'Járműképek')}
            </>}
            {page === 'driving' && <>
              {allowed('fuel') && <VehicleTaskContent {...contentProps!} section="fuel" />}
              <VehicleDetailGroup title="Kilométerrögzítések" defaultOpen={!allowed('fuel')}><VehicleHistory tenantId={tenant.id} id={id} kind="odometer" /></VehicleDetailGroup>
              {mileage && <VehicleDetailGroup title="Saját havi elszámolás és keret"><Suspense fallback={<p role="status">Elszámolás betöltése…</p>}><MileagePanel tenant={tenant} user={user} /></Suspense></VehicleDetailGroup>}
            </>}
            {page === 'usage' && <>
              <h3>Használat és hozzárendelés</h3>
              {(can('vehicles.users.assign') || can('sites.vehicles.assign')) && mutable && task('site', false)}
              {!can('vehicles.users.assign') && !can('sites.vehicles.assign') && <p className="field-hint">A jelenlegi használó és telephely a jármű fejlécében látható.</p>}
              {(record.data.bookingEnabled === true || can('vehicles.bookings.manage')) && group('bookings', 'Foglalás')}
              {group('handovers', 'Átadás-átvétel')}
              <Button variant="link" onClick={() => selectPage('history')}>Korábbi használók és események</Button>
            </>}
            {page === 'service' && <>
              <h3>Határidők</h3><VehicleDeadlines record={record.data} />
              {group('services', 'Szerviz és időpontok')}{group('documents', 'Járműokmányok')}{group('leases', 'Lízingszerződések')}
            </>}
            {page === 'history' && <VehicleRecordHistory {...contentProps!} initial={initialTab} />}
          </div>
        </div>}
      </>}
    </section>
    {garage && car && record.data && showGarage && <AccessDialog title={`${car.registration} · 3D garázs`} pending={false} onClose={() => setGarage(false)} className="vehicle-profile-garage">
      <ProfileVehicleGarage car={car} bodyType={record.data.data.bodyType ?? 'Unknown'} color={record.data.data.color} />
    </AccessDialog>}
    {archiveOpen && car && <ReasonDialog title={mutable ? 'Jármű archiválása' : 'Jármű visszaállítása inaktív állapotba'} onClose={() => setArchiveOpen(false)} onSave={async reason => {
      await fleetApi.vehicleStatus(tenant.id, id, mutable, reason, car.version!); await changed(); setMessage(mutable ? 'A jármű archiválva.' : 'A jármű visszaállítva.')
    }} />}
  </>
}

function VehicleAttention({ record, onOpen }: { record: VehicleRecord; onOpen: (page: VehiclePageKey) => void }) {
  const deadlines = dashboardDeadlines([{ vehicle: record.vehicle, ...record.data, bodyType: record.data.bodyType ?? 'Unknown', isAssignedToMe: false }], localMileageDate())
  if (!deadlines.length) return null
  return <section className="vehicle-overview-attention" aria-label="Aktuális teendők"><h3>Aktuális teendők</h3>
    {deadlines.map(item => { const state = deadlineState(item); return <Button key={item.kind} variant="ghost" onClick={() => onOpen('service')}>
      <CalendarClock size={17} /><span>{item.label}</span><span className={`status status-${state.tone === 'danger' ? 'maintenance' : 'inactive'}`}>{state.label}</span>
    </Button> })}
  </section>
}
function VehicleDeadlines({ record }: { record: VehicleRecord }) {
  const data = record.data
  return <dl className="vehicle-deadline-values">
    <div><dt>Műszaki vizsga</dt><dd>{dateText(data.inspectionDueDate)}</dd></div><div><dt>Biztosítás</dt><dd>{dateText(data.insuranceDueDate)}</dd></div>
    <div><dt>Következő szerviz</dt><dd>{dateText(data.nextServiceDate)}</dd></div><div><dt>Következő szerviz (km)</dt><dd>{data.nextServiceKm?.toLocaleString('hu-HU') ?? '—'}</dd></div>
  </dl>
}
function VehicleRecordHistory(props: { user: Session; tenant: Tenant; record: VehicleRecord; onChanged: () => Promise<void>; initial: string }) {
  const { record, tenant } = props
  const [kind, setKind] = useState(['assignees', 'audit'].includes(props.initial) ? props.initial : 'history')
  const audit = vehicleTaskAllowed('audit', record, tenant)
  const active = kind === 'audit' && !audit ? 'history' : kind
  return <>
    <label className="vehicle-history-filter"><span>Előzmény típusa</span><Select value={active} onChange={event => setKind(event.target.value)}>
      <option value="history">Kilométerállások</option><option value="assignees">Használók</option><option value="registrations">Rendszámok</option>
      {audit && <option value="audit">Módosítási napló</option>}
    </Select></label>
    {active === 'registrations' ? <VehicleHistory key={active} tenantId={tenant.id} id={record.vehicle.id} kind="registrations" />
      : <VehicleTaskContent key={active} {...props} section={active as StudioSection} />}
  </>
}

export function VehicleDataForm({ tenantId, record, editable, onSaved, onCancel }: { tenantId: string; record: VehicleRecord; editable: boolean; onSaved: () => Promise<void>; onCancel?: () => void }) {
  const initial: SaveVehicle = { registration: record.vehicle.registration, make: record.vehicle.make, model: record.vehicle.model, status: record.vehicle.status, version: record.vehicle.version!, data: record.data }
  const [data, setData] = useState<SaveVehicle>(initial)
  const dirty = JSON.stringify(data) !== JSON.stringify(initial)
  useEffect(() => {
    if (!editable || !dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, editable])
  const save = useMutation({ mutationFn: () => fleetApi.saveVehicle(tenantId, record.vehicle.id, data), onSuccess: onSaved })
  const options = useQuery({ queryKey: ['fleet-management', tenantId, record.vehicle.id, 'preferred-options'], queryFn: ({ signal }) => fleetApi.partnerOptions(tenantId, record.vehicle.id, 'preferred-service', signal), enabled: editable, retry: false })
  return <form className="org-form vehicle-data-form" aria-label="Járműadatok szerkesztése" onSubmit={e => { e.preventDefault(); if (editable && dirty) save.mutate() }}>
    <VehicleFields tenantId={tenantId} data={data} setData={setData} disabled={!editable || save.isPending} readOnly={!editable}
      serviceOptions={options.data ?? []} preferredServicePartnerName={record.preferredServicePartnerName} />
    {options.error && <p className="form-error" role="alert">{options.error.message}</p>}
    {save.error && <p className="notice error" role="alert">{save.error.message}</p>}
    <div className="org-form-footer"><div>{dirty && <p className="vehicle-draft-status" role="status">Nem mentett módosítások</p>}<MetadataLine version={data.version} updatedAt={record.updatedAt} updatedBy={record.updatedBy} /></div>{editable && <div className="member-actions">
      {onCancel && <Button type="button" variant="outline" disabled={save.isPending} onClick={() => { if (!dirty || window.confirm('Elveted a nem mentett járműadatokat?')) onCancel() }}>Mégse</Button>}
      <Button type="button" className="secondary-button" disabled={save.isPending || !dirty} onClick={() => { setData(initial); save.reset() }}>Módosítások elvetése</Button><Button className="primary-button" disabled={save.isPending || !dirty}>{save.isPending ? 'Mentés…' : 'Járműadatok mentése'}</Button></div>}</div>
  </form>
}
