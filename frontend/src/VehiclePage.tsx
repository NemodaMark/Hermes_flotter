import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import type { Session, Tenant } from './api'
import { vehicleKey } from './api'
import { MetadataLine, TextField } from './OrganizationForms'
import { fleetApi, categories, fuels, transmissions, ownerships, vehicleStatuses } from './fleetApi'
import type { SaveVehicle, VehicleRecord, VehicleSpecification } from './fleetApi'
import { DateField, FleetAudit, NotesField, NumberField, QueryMessage, ReasonDialog, SelectField } from './FleetFields'
import { PageButtons } from './CompaniesPage'
import { VehicleContracts } from './VehicleContracts'
import { VehicleDocuments } from './VehicleDocuments'
import './fleet.css'

export function VehiclePage({ user, tenant, id, onBack }: { user: Session; tenant: Tenant; id: string; onBack: () => void }) {
  const client = useQueryClient()
  const [tab, setTab] = useState('data')
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
      client.invalidateQueries({ queryKey: ['system-audit'] }),
    ])
  }
  const tabs = [['data', 'Adatlap'], ['site', 'Telephely'],
    ...(can('vehicles.documents.read') || can('vehicles.documents.manage') ? [['documents', 'Dokumentumok']] : []),
    ...(can('vehicles.leasing.read') || can('vehicles.leasing.manage') ? [['leases', 'Lízing']] : []),
    ...(can('vehicles.service.read') || can('vehicles.service.manage') ? [['services', 'Szerviz']] : []),
    ['history', 'Rendszám és kilométerelőzmények'], ...(can('audit.read') ? [['audit', 'Módosítási napló']] : [])]
  return <>
    <button className="text-button org-back" onClick={onBack}><ArrowLeft size={16} />Vissza a járművekhez</button>
    <section className="access-panel" aria-label="Járműadatlap">
      <div className="org-toolbar"><div><h2>{car?.registration ?? 'Járműadatlap'}</h2>{car && <p>{car.make} {car.model} · {vehicleStatuses[car.status as keyof typeof vehicleStatuses]} · {car.siteName ?? 'Telephely nélkül'}</p>}</div>
        <div className="member-actions"><button className="icon-button" aria-label="Járműadatlap frissítése" disabled={record.isFetching} onClick={() => void changed()}><RefreshCw size={17} /></button>
          {car && can('vehicles.archive') && <button className="secondary-button" onClick={() => setArchiveOpen(true)}>{car.status === 'Archived' ? 'Visszaállítás' : 'Archiválás'}</button>}
        </div>
      </div>
      <QueryMessage pending={record.isPending} error={record.error} retry={() => void record.refetch()} />
      {record.data && <>
        <div className="access-tabs org-tabs fleet-detail-tabs" aria-label="Járműadatlap részei">{tabs.map(([key, label]) => <button key={key} aria-pressed={tab === key} onClick={() => { setTab(key); setMessage('') }}>{label}</button>)}</div>
        {message && <p className="notice" role="status">{message}</p>}
        {car?.status === 'Archived' && <p className="notice">Archivált jármű · {record.data.statusReason}. A visszaállítás után szerkeszthető.</p>}
        {tab === 'data' && <VehicleDataForm key={car!.version} tenantId={tenant.id} record={record.data} editable={can('vehicles.update') && car?.status !== 'Archived'} onSaved={() => changed('A jármű adatai elmentve.')} />}
        {tab === 'site' && <VehicleSite key={car!.version} tenantId={tenant.id} record={record.data} editable={can('sites.vehicles.assign') && car?.status !== 'Archived'} onSaved={() => changed('A telephely-hozzárendelés elmentve.')} />}
        {(tab === 'leases' || tab === 'services') && <VehicleContracts key={tab} tenant={tenant} car={car!} kind={tab} onChanged={changed} />}
        {tab === 'documents' && (can('vehicles.documents.read') || can('vehicles.documents.manage')) && <VehicleDocuments tenantId={tenant.id} vehicleId={id} registration={car!.registration} kind="vehicle" target={{ id, name: 'Járműokmányok', version: car!.version! }} canRead={can('vehicles.documents.read')} canManage={can('vehicles.documents.manage') && car?.status !== 'Archived'} embedded onChanged={changed} onClose={() => setTab('data')} />}
        {tab === 'history' && <VehicleHistory tenantId={tenant.id} id={id} />}
        {tab === 'audit' && can('audit.read') && <FleetAudit tenantId={tenant.id} id={id} vehicle />}
      </>}
    </section>
    {archiveOpen && car && <ReasonDialog title={car.status === 'Archived' ? 'Jármű visszaállítása inaktív állapotba' : 'Jármű archiválása'} onClose={() => setArchiveOpen(false)} onSave={async reason => { await fleetApi.vehicleStatus(tenant.id, id, car.status !== 'Archived', reason, car.version!); await changed('A jármű állapota megváltozott.') }} />}
  </>
}

export function VehicleDataForm({ tenantId, record, editable, onSaved }: { tenantId: string; record: VehicleRecord; editable: boolean; onSaved: () => Promise<void> }) {
  const [data, setData] = useState<SaveVehicle>({ registration: record.vehicle.registration, make: record.vehicle.make, model: record.vehicle.model,
    status: record.vehicle.status, version: record.vehicle.version!, data: record.data })
  const [currentYear] = useState(() => new Date().getFullYear())
  const save = useMutation({ mutationFn: () => fleetApi.saveVehicle(tenantId, record.vehicle.id, data), onSuccess: onSaved })
  const disabled = !editable || save.isPending
  const options = useQuery({ queryKey: ['fleet-management', tenantId, record.vehicle.id, 'preferred-options'], queryFn: ({ signal }) => fleetApi.partnerOptions(tenantId, record.vehicle.id, 'preferred-service', signal), enabled: editable, retry: false })
  const spec = data.data
  const set = (key: keyof VehicleSpecification, value: string | number | null) => setData({ ...data, data: { ...spec, [key]: value } })
  const num = (key: keyof VehicleSpecification, label: string, max = 100000000, step = 1) => <NumberField label={label} value={spec[key] as number | null} onChange={x => set(key, x)} max={max} step={step} disabled={disabled} />
  const date = (key: keyof VehicleSpecification, label: string) => <DateField label={label} value={spec[key] as string | null} onChange={x => set(key, x)} disabled={disabled} />
  return <form className="org-form" onSubmit={e => { e.preventDefault(); save.mutate() }}>
    <fieldset disabled={disabled}><legend>Azonosítás</legend><div className="org-form-grid">
      <TextField label="Rendszám" value={data.registration} onChange={x => setData({ ...data, registration: x })} required maxLength={16} disabled={disabled} />
      <TextField label="Rendszám országkódja" value={spec.registrationCountry} onChange={x => set('registrationCountry', x)} required maxLength={2} disabled={disabled} />
      <TextField label="Alvázszám (VIN)" value={spec.vin} onChange={x => set('vin', x)} maxLength={17} disabled={disabled} />
      <TextField label="Flottaazonosító" value={spec.fleetNumber} onChange={x => set('fleetNumber', x)} maxLength={40} disabled={disabled} />
      <TextField label="Gyártó" value={data.make} onChange={x => setData({ ...data, make: x })} required maxLength={64} disabled={disabled} />
      <TextField label="Modell" value={data.model} onChange={x => setData({ ...data, model: x })} required maxLength={64} disabled={disabled} />
    </div></fieldset>
    <fieldset disabled={disabled}><legend>Alapadatok</legend><div className="org-form-grid">
      <SelectField label="Járműkategória" value={spec.category} options={categories} onChange={x => set('category', x)} disabled={disabled} />
      {num('year', 'Gyártási év', currentYear + 1)}{date('firstRegistration', 'Első forgalomba helyezés')}
      <TextField label="Szín" value={spec.color} onChange={x => set('color', x)} maxLength={40} disabled={disabled} />
      <SelectField label="Állapot" value={data.status} options={data.status === 'Archived' ? vehicleStatuses : { Active: 'Aktív', Maintenance: 'Szervizben', Inactive: 'Inaktív' }} onChange={x => setData({ ...data, status: x })} disabled={disabled} />
      <SelectField label="Tulajdonlás" value={spec.ownership} options={ownerships} onChange={x => set('ownership', x)} disabled={disabled} />
      {date('fleetEntryDate', 'Flottába kerülés')}{date('fleetExitDate', 'Flottából kilépés')}
    </div></fieldset>
    <fieldset disabled={disabled}><legend>Műszaki adatok</legend><div className="org-form-grid">
      <SelectField label="Üzemanyag / hajtás" value={spec.fuelType} options={fuels} onChange={x => set('fuelType', x)} disabled={disabled} />
      <SelectField label="Váltó" value={spec.transmission} options={transmissions} onChange={x => set('transmission', x)} disabled={disabled} />
      {num('powerKw', 'Teljesítmény (kW)', 10000, 0.001)}{num('engineCapacityCc', 'Hengerűrtartalom (cm³)', 100000)}{num('seats', 'Ülések száma', 500)}
      {(['Electric', 'PluginHybrid', 'Hybrid'].includes(spec.fuelType) || spec.batteryKwh !== null) && num('batteryKwh', 'Akkumulátor (kWh)', 10000, 0.001)}
      {num('grossWeightKg', 'Megengedett össztömeg (kg)', 200000)}
      {(['Van', 'Truck', 'Trailer'].includes(spec.category) || spec.payloadKg !== null || spec.cargoVolumeM3 !== null) && <>{num('payloadKg', 'Teherbírás (kg)', 200000)}{num('cargoVolumeM3', 'Raktér (m³)', 1000, 0.001)}</>}
    </div></fieldset>
    <fieldset disabled={disabled}><legend>Határidők és szerviz</legend><div className="org-form-grid">
      {date('inspectionDueDate', 'Műszaki vizsga lejárata')}{date('insuranceDueDate', 'Biztosítás lejárata')}{date('nextServiceDate', 'Következő szerviz dátuma')}{num('nextServiceKm', 'Következő szerviz (km)')}
      <SelectField label="Alapértelmezett szervizpartner" value={spec.preferredServicePartnerId ?? ''} onChange={x => set('preferredServicePartnerId', x || null)} disabled={disabled || options.isPending}
        options={{ '': 'Nincs kijelölve', ...(spec.preferredServicePartnerId ? { [spec.preferredServicePartnerId]: record.preferredServicePartnerName ?? 'Jelenlegi szervizpartner' } : {}), ...Object.fromEntries((options.data ?? []).map(x => [x.id, x.name])) }} />
    </div>{options.isError && <p className="form-error" role="alert">{options.error.message}</p>}</fieldset>
    <NotesField value={spec.notes} onChange={x => set('notes', x)} disabled={disabled} />
    {save.error && <p className="notice error" role="alert">{save.error.message}</p>}
    <div className="org-form-footer"><MetadataLine version={data.version} updatedAt={record.updatedAt} updatedBy={record.updatedBy} />{editable && <button className="primary-button" disabled={save.isPending}>Járműadatok mentése</button>}</div>
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
      {save.error && <p className="notice error" role="alert">{save.error.message}</p>}<div className="dialog-actions"><button className="primary-button" disabled={save.isPending || siteId === (record.vehicle.siteId ?? '')}>Telephely mentése</button></div>
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
    {regs.data && <><div className="table-scroll"><table className="org-table"><thead><tr><th>Rendszám</th><th>Ország</th><th>Rögzítés</th><th>Rögzítette</th></tr></thead><tbody>{regs.data.items.map(x => <tr key={x.id}><td><strong>{x.registration}</strong></td><td>{x.countryCode}</td><td>{new Date(x.recordedAt).toLocaleString('hu-HU')}</td><td>{x.recordedBy === 'system:migration' ? 'Korábbi járműadat átvétele' : x.recordedBy}</td></tr>)}</tbody></table></div><PageButtons page={regPage} total={regs.data.total} pending={regs.isFetching} onPage={setRegPage} /></>}
    <div className="org-section-tools"><h3>Kilométerelőzmények</h3></div><QueryMessage pending={odo.isPending} error={odo.error} retry={() => void odo.refetch()} />
    {odo.data && <><div className="table-scroll"><table className="org-table"><thead><tr><th>Kilométerállás</th><th>Rögzítés</th><th>Rögzítette</th></tr></thead><tbody>{odo.data.items.map(x => <tr key={x.id}><td>{x.kilometers.toLocaleString('hu-HU')} km</td><td>{new Date(x.recordedAt).toLocaleString('hu-HU')}</td><td>{x.recordedBy}</td></tr>)}{!odo.data.total && <tr><td colSpan={3}>Még nincs rögzített kilométerállás.</td></tr>}</tbody></table></div><PageButtons page={odoPage} total={odo.data.total} pending={odo.isFetching} onPage={setOdoPage} /></>}
  </>
}
