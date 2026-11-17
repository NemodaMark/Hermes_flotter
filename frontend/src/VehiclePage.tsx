import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { Session, Tenant } from './api'
import { vehicleKey } from './api'
import { MetadataLine } from './OrganizationForms'
import { fleetApi, vehicleStatuses } from './fleetApi'
import type { SaveVehicle, VehicleRecord } from './fleetApi'
import { FleetAudit, QueryMessage, ReasonDialog, SelectField } from './FleetFields'
import { PageButtons } from './CompaniesPage'
import { VehicleContracts } from './VehicleContracts'
import { VehicleDocuments } from './VehicleDocuments'
import { VehiclePhotos, VehicleAssignee } from './VehicleMedia'
import { VehicleFields } from './VehicleFields'
import { VehicleAssignmentHistory } from './VehicleAssignmentHistory'
import { VehicleActions } from './VehicleActions'
import { ProfileVehicleGarage } from './VehicleGarage'
import './fleet.css'

const VehicleBookingCalendar = lazy(() => import('./VehicleOperations').then(module => ({ default: module.VehicleBookingCalendar })))
const VehicleFuel = lazy(() => import('./VehicleOperations').then(module => ({ default: module.VehicleFuel })))
const VehicleHandovers = lazy(() => import('./VehicleOperations').then(module => ({ default: module.VehicleHandovers })))

export function VehiclePage({ user, tenant, id, onBack, initialTab = 'data', showGarage = true, embedded = false }: {
  user: Session; tenant: Tenant; id: string; onBack: () => void; initialTab?: string; showGarage?: boolean; embedded?: boolean
}) {
  const client = useQueryClient()
  const [tab, setTab] = useState(initialTab)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [message, setMessage] = useState('')
  const record = useQuery({ queryKey: ['fleet-management', tenant.id, id, 'vehicle'], queryFn: ({ signal }) => fleetApi.vehicle(tenant.id, id, signal), retry: false })
  const car = record.data?.vehicle
  const can = (code: string) => (car?.permissions ?? tenant.permissions).includes(code)
  async function changed(message = '') {
    setMessage(message)
    await Promise.all([
      client.invalidateQueries({ queryKey: ['fleet-management', tenant.id] }),
      client.invalidateQueries({ queryKey: vehicleKey(user.id, tenant.id) }),
      client.invalidateQueries({ queryKey: ['organization'] }),
      client.invalidateQueries({ queryKey: ['vehicle-photos', tenant.id, id] }),
      client.invalidateQueries({ queryKey: ['vehicle-assignee', tenant.id, id] }),
      client.invalidateQueries({ queryKey: ['vehicle-assignee-history', tenant.id, id] }),
      client.invalidateQueries({ queryKey: ['person-profile'] }),
      client.invalidateQueries({ queryKey: ['vehicle-catalog', tenant.id] }),
      client.invalidateQueries({ queryKey: ['system-audit'] }),
      client.invalidateQueries({ queryKey: ['dashboard'] }),
    ])
  }
  const tabs = [['data', 'Adatlap'], ...(showGarage ? [['garage', '3D garázs']] : []),
    ['site', 'Telephely és használó'], ['photos', 'Képek'], ['assignees', 'Használati előzmények'],
    ...(can('vehicles.bookings.read') || can('vehicles.bookings.manage') ? [['bookings', 'Foglalások']] : []),
    ...(can('vehicles.fuel.read') || can('vehicles.fuel.manage') ? [['fuel', 'Tankolások']] : []),
    ['handovers', 'Átadás-átvétel'],
    ...(can('vehicles.documents.read') || can('vehicles.documents.manage') ? [['documents', 'Dokumentumok']] : []),
    ...(can('vehicles.leasing.read') || can('vehicles.leasing.manage') ? [['leases', 'Lízing']] : []),
    ...(can('vehicles.service.read') || can('vehicles.service.manage') ? [['services', 'Szerviz']] : []),
    ['history', 'Rendszám és kilométerelőzmények'], ...(can('audit.read') ? [['audit', 'Módosítási napló']] : [])]
  const activeTab = tabs.some(([key]) => key === tab) ? tab : 'data'
  return <>
    {!embedded && <Button className="text-button org-back" onClick={onBack}><ArrowLeft size={16} />Vissza a járművekhez</Button>}
    <section className="access-panel vehicle-detail-panel" aria-label="Járműadatlap">
      <div className="org-toolbar vehicle-detail-header"><div>{!embedded && <h2>{car?.registration ?? 'Járműadatlap'}</h2>}{car && <p>{car.make} {car.model}</p>}</div>
        <div className="member-actions"><Button className="icon-button" aria-label="Járműadatlap frissítése" disabled={record.isFetching} onClick={() => void changed()}><RefreshCw size={17} /></Button>
          {car && <VehicleActions user={user} tenant={tenant} vehicle={car} allowEditing={false} />}
          {car && can('vehicles.archive') && <Button className="secondary-button" onClick={() => setArchiveOpen(true)}>{car.status === 'Archived' ? 'Visszaállítás' : 'Archiválás'}</Button>}
        </div>
        {car && <div className="vehicle-detail-meta"><span className={`status status-${car.status.toLowerCase()}`}>{vehicleStatuses[car.status as keyof typeof vehicleStatuses]}</span><span>{car.siteName ?? 'Telephely nélkül'}</span><span>{car.odometerKm == null ? 'Nincs km-adat' : `${car.odometerKm.toLocaleString('hu-HU')} km`}</span></div>}
      </div>
      <QueryMessage pending={record.isPending} error={record.error} retry={() => void record.refetch()} />
      {record.data && <>
        <VehicleAssignee tenant={tenant} car={car!} onChanged={changed} readOnly />
        <div className="vehicle-detail-navigation">
          <nav aria-label="Járműadatlap részei">{tabs.map(([key, label]) => <Button key={key} aria-current={activeTab === key ? 'page' : undefined} onClick={() => { setTab(key); setMessage('') }}>{label}</Button>)}</nav>
          <label className="org-field vehicle-detail-picker"><span>Járműadatlap részei</span><Select value={activeTab} onChange={event => { setTab(event.target.value); setMessage('') }}>{tabs.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
        </div>
        {message && <p className="notice" role="status">{message}</p>}
        {car?.status === 'Archived' && <p className="notice">Archivált jármű · {record.data.statusReason}. A visszaállítás után szerkeszthető.</p>}
        <div hidden={activeTab !== 'data'}><VehicleDataForm key={car!.version} tenantId={tenant.id} record={record.data} editable={can('vehicles.update') && car?.status !== 'Archived'} onSaved={() => changed('A jármű adatai elmentve.')} /></div>
        {activeTab === 'site' && <><VehicleAssignee tenant={tenant} car={car!} onChanged={changed} /><VehicleSite key={car!.version} tenantId={tenant.id} record={record.data} editable={can('sites.vehicles.assign') && car?.status !== 'Archived'} onSaved={() => changed('A telephely-hozzárendelés elmentve.')} /></>}
        {activeTab === 'photos' && <VehiclePhotos tenant={tenant} car={car!} onChanged={changed} />}
        {(activeTab === 'leases' || activeTab === 'services') && <VehicleContracts key={activeTab} tenant={tenant} car={car!} kind={activeTab} onChanged={changed} />}
        {activeTab === 'documents' && (can('vehicles.documents.read') || can('vehicles.documents.manage')) && <VehicleDocuments tenantId={tenant.id} vehicleId={id} registration={car!.registration} kind="vehicle" target={{ id, name: 'Járműokmányok', version: car!.version! }} canRead={can('vehicles.documents.read')} canManage={can('vehicles.documents.manage') && car?.status !== 'Archived'} embedded onChanged={changed} onClose={() => setTab('data')} />}
        {activeTab === 'history' && <VehicleHistory tenantId={tenant.id} id={id} />}
        {activeTab === 'assignees' && <VehicleAssignmentHistory tenantId={tenant.id} id={id} />}
        <Suspense fallback={<p className="notice" role="status">Betöltés…</p>}>
          {activeTab === 'garage' && <ProfileVehicleGarage key={car!.id} car={car!}
            bodyType={record.data.data.bodyType ?? 'Unknown'} color={record.data.data.color} />}
          {activeTab === 'bookings' && <VehicleBookingCalendar tenant={tenant} car={car!} userId={user.id} onChanged={changed} />}
          {activeTab === 'fuel' && <VehicleFuel tenant={tenant} car={car!} />}
          {activeTab === 'handovers' && <VehicleHandovers tenant={tenant} car={car!} onChanged={() => changed('Az átadás elmentve.')} />}
        </Suspense>
        {activeTab === 'audit' && can('audit.read') && <FleetAudit tenantId={tenant.id} id={id} vehicle />}
      </>}
    </section>
    {archiveOpen && car && <ReasonDialog title={car.status === 'Archived' ? 'Jármű visszaállítása inaktív állapotba' : 'Jármű archiválása'} onClose={() => setArchiveOpen(false)} onSave={async reason => { await fleetApi.vehicleStatus(tenant.id, id, car.status !== 'Archived', reason, car.version!); await changed('A jármű állapota megváltozott.') }} />}
  </>
}

export function VehicleDataForm({ tenantId, record, editable, onSaved }: { tenantId: string; record: VehicleRecord; editable: boolean; onSaved: () => Promise<void> }) {
  const initial: SaveVehicle = { registration: record.vehicle.registration, make: record.vehicle.make, model: record.vehicle.model, status: record.vehicle.status, version: record.vehicle.version!, data: record.data }
  const [data, setData] = useState<SaveVehicle>(initial)
  const dirty = JSON.stringify(data) !== JSON.stringify(initial)
  const save = useMutation({ mutationFn: () => fleetApi.saveVehicle(tenantId, record.vehicle.id, data), onSuccess: onSaved })
  const options = useQuery({ queryKey: ['fleet-management', tenantId, record.vehicle.id, 'preferred-options'], queryFn: ({ signal }) => fleetApi.partnerOptions(tenantId, record.vehicle.id, 'preferred-service', signal), enabled: editable, retry: false })
  return <form className="org-form vehicle-data-form" aria-label="Járműadatok szerkesztése" onSubmit={e => { e.preventDefault(); if (editable && dirty) save.mutate() }}>
    <VehicleFields tenantId={tenantId} data={data} setData={setData} disabled={!editable || save.isPending} serviceOptions={options.data ?? []} preferredServicePartnerName={record.preferredServicePartnerName} />
    {options.error && <p className="form-error" role="alert">{options.error.message}</p>}
    {save.error && <p className="notice error" role="alert">{save.error.message}</p>}
    <div className="org-form-footer"><div>{dirty && <p className="vehicle-draft-status" role="status">Nem mentett módosítások</p>}<MetadataLine version={data.version} updatedAt={record.updatedAt} updatedBy={record.updatedBy} /></div>{editable && <div className="member-actions"><Button type="button" className="secondary-button" disabled={save.isPending || !dirty} onClick={() => { setData(initial); save.reset() }}>Módosítások elvetése</Button><Button className="primary-button" disabled={save.isPending || !dirty}>{save.isPending ? 'Mentés…' : 'Járműadatok mentése'}</Button></div>}</div>
  </form>
}
function VehicleSite({ tenantId, record, editable, onSaved }: { tenantId: string; record: VehicleRecord; editable: boolean; onSaved: () => Promise<void> }) {
  const [siteId, setSiteId] = useState(record.vehicle.siteId ?? '')
  const options = useQuery({ queryKey: ['fleet-management', tenantId, record.vehicle.id, 'site-options'], queryFn: ({ signal }) => fleetApi.siteOptions(tenantId, record.vehicle.id, signal), enabled: editable, retry: false })
  const save = useMutation({ mutationFn: () => fleetApi.assignSite(tenantId, record.vehicle.id, siteId || null, record.vehicle.version!), onSuccess: onSaved })
  return <form className="org-form" onSubmit={e => { e.preventDefault(); save.mutate() }}>
    <p className="fleet-detail-caption">Jelenlegi telephely: {record.vehicle.siteName ?? 'Nincs kijelölve'}</p>
    {editable && <><QueryMessage pending={options.isPending} error={options.error} retry={() => void options.refetch()} />{options.data && <>
      <div className="org-form-grid"><SelectField label="Új telephely" value={siteId} onChange={setSiteId} disabled={save.isPending} required={!options.data.canUnassign}
        options={{ ...(options.data.canUnassign ? { '': 'Telephely nélkül' } : !siteId ? { '': 'Válassz telephelyet' } : {}), ...(record.vehicle.siteId ? { [record.vehicle.siteId]: record.vehicle.siteName ?? 'Jelenlegi telephely' } : {}), ...Object.fromEntries(options.data.sites.map(x => [x.id, `${x.name} (${x.code})`])) }} /></div>
      {save.error && <p className="notice error" role="alert">{save.error.message}</p>}<div className="dialog-actions"><Button className="primary-button" disabled={save.isPending || siteId === (record.vehicle.siteId ?? '')}>Telephely mentése</Button></div>
    </>}</>}
  </form>
}
function VehicleHistory({ tenantId, id }: { tenantId: string; id: string }) {
  const [regPage, setRegPage] = useState(1)
  const [odoPage, setOdoPage] = useState(1)
  const regs = useQuery({ queryKey: ['fleet-management', tenantId, id, 'registrations', regPage], queryFn: ({ signal }) => fleetApi.registrations(tenantId, id, regPage, signal), retry: false })
  const odo = useQuery({ queryKey: ['fleet-management', tenantId, id, 'odometer', odoPage], queryFn: ({ signal }) => fleetApi.odometer(tenantId, id, odoPage, signal), retry: false })
  return <>
    <div className="org-section-tools"><h3>Rendszámelőzmények</h3></div><QueryMessage pending={regs.isPending} error={regs.error} retry={() => void regs.refetch()} />
    {regs.data && <><div className="table-scroll"><table className="org-table responsive-list"><thead><tr><th>Rendszám</th><th>Ország</th><th>Rögzítés</th><th>Rögzítette</th></tr></thead><tbody>{regs.data.items.map(x => <tr key={x.id}><td><strong>{x.registration}</strong></td><td data-label="Ország">{x.countryCode}</td><td data-label="Rögzítés">{new Date(x.recordedAt).toLocaleString('hu-HU')}</td><td data-label="Rögzítette">{x.recordedBy === 'system:migration' ? 'Korábbi járműadat átvétele' : x.recordedBy}</td></tr>)}</tbody></table></div><PageButtons page={regPage} total={regs.data.total} pending={regs.isFetching} onPage={setRegPage} /></>}
    <div className="org-section-tools"><h3>Kilométerelőzmények</h3></div><QueryMessage pending={odo.isPending} error={odo.error} retry={() => void odo.refetch()} />
    {odo.data && <><div className="table-scroll"><table className="org-table responsive-list"><thead><tr><th>Kilométerállás</th><th>Rögzítés</th><th>Rögzítette</th></tr></thead><tbody>{odo.data.items.map(x => <tr key={x.id}><td>{x.kilometers.toLocaleString('hu-HU')} km</td><td data-label="Rögzítés">{new Date(x.recordedAt).toLocaleString('hu-HU')}</td><td data-label="Rögzítette">{x.recordedBy}</td></tr>)}{!odo.data.total && <tr><td colSpan={3}>Még nincs rögzített kilométerállás.</td></tr>}</tbody></table></div><PageButtons page={odoPage} total={odo.data.total} pending={odo.isFetching} onPage={setOdoPage} /></>}
  </>
}
