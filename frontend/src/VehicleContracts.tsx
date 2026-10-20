import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import type { Tenant, Vehicle } from './api'
import { AccessDialog } from './AccessDialog'
import { DialogActions, MetadataLine, TextField } from './OrganizationForms'
import { PageButtons } from './CompaniesPage'
import { fleetApi, dateText, moneyText, frequencies, leaseStatuses } from './fleetApi'
import type { Lease, LeaseInput, Service, ServiceInput } from './fleetApi'
import { VehicleDocuments } from './VehicleDocuments'
import type { DocumentTarget } from './VehicleDocuments'
import { CurrencyField, DateField, NotesField, NumberField, QueryMessage, ReasonDialog, SelectField } from './FleetFields'

export function VehicleContracts({ tenant, car, kind, onChanged }: { tenant: Tenant; car: Vehicle; kind: 'leases' | 'services'; onChanged: (message?: string) => Promise<void> }) {
  const [page, setPage] = useState(1)
  const [includeVoided, setIncludeVoided] = useState(false)
  const [edit, setEdit] = useState<Lease | Service | 'new' | null>(null)
  const [voidItem, setVoidItem] = useState<Service | null>(null)
  const [documentTarget, setDocumentTarget] = useState<DocumentTarget | null>(null)
  const lease = kind === 'leases'
  const can = (code: string) => (car.permissions ?? tenant.permissions).includes(code)
  const read = can(lease ? 'vehicles.leasing.read' : 'vehicles.service.read')
  const manage = can(lease ? 'vehicles.leasing.manage' : 'vehicles.service.manage') && car.status !== 'Archived'
  const leases = useQuery({ queryKey: ['fleet-management', tenant.id, car.id, 'leases', page], queryFn: ({ signal }) => fleetApi.leases(tenant.id, car.id, page, signal), enabled: lease && read, retry: false })
  const services = useQuery({ queryKey: ['fleet-management', tenant.id, car.id, 'services', page, includeVoided], queryFn: ({ signal }) => fleetApi.services(tenant.id, car.id, page, includeVoided, signal), enabled: !lease && read, retry: false })
  const query = lease ? leases : services
  return <>
    <div className="org-section-tools"><div>{!lease && <label className="org-checkbox"><input type="checkbox" checked={includeVoided} onChange={e => { setIncludeVoided(e.target.checked); setPage(1) }} />Érvénytelenített bejegyzések is</label>}</div>
      {manage && <button className="primary-button" onClick={() => setEdit('new')}><Plus size={17} />{lease ? 'Új lízingszerződés' : 'Új szervizbejegyzés'}</button>}
    </div>
    {!read ? <p className="notice">A bejegyzések megtekintéséhez külön jogosultság szükséges.</p> : <>
      <QueryMessage pending={query.isPending} error={query.error} retry={() => void query.refetch()} />
      {query.data && <>
        <div className="fleet-record-list">
          {lease ? leases.data?.items.map(x => <article className="fleet-record" key={x.id}>
            <div className="fleet-record-heading"><div><h3>{x.data.contractNumber}</h3><p className="fleet-detail-caption">{x.partnerName} · {leaseStatuses[x.data.status as keyof typeof leaseStatuses]}</p></div>
              <div className="member-actions"><button className="secondary-button" aria-label={`Dokumentumok: ${x.data.contractNumber}`} onClick={() => setDocumentTarget({ id: x.id, name: x.data.contractNumber, version: x.data.version })}>Dokumentumok</button>
                {manage && <button className="secondary-button" aria-label={`Szerződés szerkesztése: ${x.data.contractNumber}`} onClick={() => setEdit(x)}>Szerkesztés</button>}</div>
            </div><dl><div><dt>Futamidő</dt><dd>{dateText(x.data.startDate)} – {dateText(x.data.endDate)}</dd></div><div><dt>Lízingdíj</dt><dd>{moneyText(x.data.paymentAmount, x.data.currency)} · {frequencies[x.data.billingFrequency as keyof typeof frequencies]}</dd></div>
              <div><dt>Éves / teljes km-keret</dt><dd>{x.data.annualKmLimit?.toLocaleString('hu-HU') ?? '–'} / {x.data.totalKmLimit?.toLocaleString('hu-HU') ?? '–'} km</dd></div></dl>
            {x.data.notes && <p className="fleet-record-note">{x.data.notes}</p>}{x.data.documentUrl && <a href={x.data.documentUrl} target="_blank" rel="noreferrer">Szerződés megnyitása</a>}
            <MetadataLine version={x.data.version} updatedAt={x.updatedAt} updatedBy={x.updatedBy} />
          </article>) : services.data?.items.map(x => <article className="fleet-record" key={x.id}>
            <div className="fleet-record-heading"><div><h3>{dateText(x.data.performedOn)} · {x.partnerName}</h3><p className="fleet-detail-caption">{x.data.workOrderNumber ? `Munkalap: ${x.data.workOrderNumber}` : 'Szervizbejegyzés'}{x.isVoided ? ' · Érvénytelenítve' : ''}</p></div>
              <div className="member-actions"><button className="secondary-button" aria-label={`Dokumentumok: ${x.data.workOrderNumber ?? x.partnerName}`} onClick={() => setDocumentTarget({ id: x.id, name: x.data.workOrderNumber ?? x.partnerName, version: x.data.version, isVoided: x.isVoided })}>Dokumentumok</button>
                {manage && !x.isVoided && <><button className="secondary-button" onClick={() => setEdit(x)}>Szerkesztés</button><button className="secondary-button" onClick={() => setVoidItem(x)}>Érvénytelenítés</button></>}</div>
            </div><p className="fleet-record-note">{x.data.description}</p>
            <dl><div><dt>Kilométerállás a szerviznél</dt><dd>{x.data.kilometers?.toLocaleString('hu-HU') ?? '–'} km</dd></div><div><dt>Költség</dt><dd>{moneyText(x.data.cost, x.data.currency)}</dd></div><div><dt>Következő szerviz</dt><dd>{dateText(x.data.nextServiceDate)} · {x.data.nextServiceKm?.toLocaleString('hu-HU') ?? '–'} km</dd></div></dl>
            {x.data.notes && <p className="fleet-record-note">{x.data.notes}</p>}{x.voidReason && <p className="fleet-record-note">Érvénytelenítés indoka: {x.voidReason}</p>}
            {x.data.documentUrl && <a href={x.data.documentUrl} target="_blank" rel="noreferrer">Munkalap / számla megnyitása</a>}
            <MetadataLine version={x.data.version} updatedAt={x.updatedAt} updatedBy={x.updatedBy} />
          </article>)}
          {!query.data.total && <p className="notice">{lease ? 'Még nincs lízingszerződés ehhez a járműhöz.' : 'Még nincs szervizbejegyzés ehhez a járműhöz.'}</p>}
        </div><PageButtons page={page} total={query.data.total} pending={query.isFetching} onPage={setPage} />
      </>}
    </>}
    {edit && (lease ? <LeaseDialog tenantId={tenant.id} car={car} item={edit === 'new' ? undefined : edit as Lease} onClose={() => setEdit(null)} onSaved={async saved => {
      const isNew = edit === 'new'; setEdit(null); await onChanged('A lízingszerződés elmentve.');
      if (isNew) setDocumentTarget({ id: saved.id, name: saved.data.contractNumber, version: saved.data.version })
    }} />
      : <ServiceDialog tenantId={tenant.id} car={car} item={edit === 'new' ? undefined : edit as Service} onClose={() => setEdit(null)} onSaved={async saved => {
        const isNew = edit === 'new'; setEdit(null); await onChanged('A szervizbejegyzés elmentve.');
        if (isNew) setDocumentTarget({ id: saved.id, name: saved.data.workOrderNumber ?? saved.partnerName, version: saved.data.version })
      }} />)}
    {documentTarget && <VehicleDocuments tenantId={tenant.id} vehicleId={car.id} registration={car.registration} kind={kind} target={documentTarget} canRead={read} canManage={manage} onClose={() => setDocumentTarget(null)} onChanged={onChanged} />}
    {voidItem && <ReasonDialog title="Szervizbejegyzés érvénytelenítése" onClose={() => setVoidItem(null)} onSave={async reason => { await fleetApi.voidService(tenant.id, car.id, voidItem, reason); await onChanged('A szervizbejegyzés érvénytelenítve, az előzmény megmaradt.') }} />}
  </>
}
export function LeaseDialog({ tenantId, car, item, onClose, onSaved }: { tenantId: string; car: Vehicle; item?: Lease; onClose: () => void; onSaved: (saved: Lease) => Promise<void> }) {
  const [data, setData] = useState<LeaseInput>(item?.data ?? { partnerId: '', contractNumber: '', startDate: '', endDate: '', paymentAmount: null, currency: 'HUF', billingFrequency: 'Monthly', annualKmLimit: null, totalKmLimit: null, status: 'Active', documentUrl: '', notes: '', version: 0 })
  const partners = useQuery({ queryKey: ['fleet-management', tenantId, car.id, 'leasing-options'], queryFn: ({ signal }) => fleetApi.partnerOptions(tenantId, car.id, 'leasing', signal), retry: false })
  const save = useMutation({ mutationFn: () => fleetApi.saveLease(tenantId, car.id, item?.id ?? null, data), onSuccess: async saved => { await onSaved(saved); onClose() } })
  return <AccessDialog title={item ? 'Lízingszerződés szerkesztése' : 'Új lízingszerződés'} pending={save.isPending} onClose={onClose}>
    <form className="org-form" onSubmit={e => { e.preventDefault(); save.mutate() }}><p className="access-description">{car.registration}</p>
      <QueryMessage pending={partners.isPending} error={partners.error} retry={() => void partners.refetch()} />
      {partners.data && !partners.data.length && !item && <p className="notice">Előbb vegyél fel egy lízingbeadót a Partnerek menüpontban.</p>}
      <fieldset disabled={save.isPending}><div className="org-form-grid">
        <SelectField label="Lízingbeadó / finanszírozó" value={data.partnerId} onChange={x => setData({ ...data, partnerId: x })} required
          options={{ '': 'Válassz partnert', ...(item ? { [item.data.partnerId]: item.partnerName } : {}), ...Object.fromEntries((partners.data ?? []).map(x => [x.id, x.name])) }} />
        <TextField label="Szerződésszám" value={data.contractNumber} onChange={x => setData({ ...data, contractNumber: x })} required maxLength={100} />
        <DateField label="Szerződés kezdete" value={data.startDate} onChange={x => setData({ ...data, startDate: x ?? '' })} required />
        <DateField label="Szerződés vége" value={data.endDate} onChange={x => setData({ ...data, endDate: x ?? '' })} required />
        <NumberField label="Lízingdíj" value={data.paymentAmount} max={1000000000000} step={0.01} onChange={x => setData({ ...data, paymentAmount: x })} />
        <CurrencyField value={data.currency} onChange={x => setData({ ...data, currency: x })} />
        <SelectField label="Fizetési gyakoriság" value={data.billingFrequency} options={frequencies} onChange={x => setData({ ...data, billingFrequency: x })} />
        <SelectField label="Szerződés állapota" value={data.status} options={leaseStatuses} onChange={x => setData({ ...data, status: x })} />
        <NumberField label="Éves kilométerkeret" value={data.annualKmLimit} onChange={x => setData({ ...data, annualKmLimit: x })} />
        <NumberField label="Teljes kilométerkeret" value={data.totalKmLimit} onChange={x => setData({ ...data, totalKmLimit: x })} />
        <TextField label="Szerződés webcíme" value={data.documentUrl} type="url" maxLength={2048} onChange={x => setData({ ...data, documentUrl: x })} />
      </div></fieldset>
      <p className="field-hint">Aktív szerződéshez az adatlapon válassz lízingelt vagy bérelt tulajdonlást. Az aktív szerződések időszakai nem fedhetik egymást.</p>
      <p className="field-hint">Mentés után a Dokumentumok ablakban fájlokat is csatolhatsz.</p>
      <NotesField value={data.notes} onChange={x => setData({ ...data, notes: x })} disabled={save.isPending} />
      {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
      <DialogActions pending={save.isPending} onClose={onClose} submitDisabled={partners.isPending || partners.isError} />
    </form>
  </AccessDialog>
}
export function ServiceDialog({ tenantId, car, item, onClose, onSaved }: { tenantId: string; car: Vehicle; item?: Service; onClose: () => void; onSaved: (saved: Service) => Promise<void> }) {
  const [today] = useState(() => new Date().toLocaleDateString('sv-SE'))
  const [data, setData] = useState<ServiceInput>(item?.data ?? { partnerId: '', performedOn: today, kilometers: car.odometerKm ?? null, description: '', workOrderNumber: '', cost: null, currency: 'HUF', nextServiceDate: null, nextServiceKm: null, documentUrl: '', notes: '', version: 0 })
  const partners = useQuery({ queryKey: ['fleet-management', tenantId, car.id, 'service-options'], queryFn: ({ signal }) => fleetApi.partnerOptions(tenantId, car.id, 'service', signal), retry: false })
  const save = useMutation({ mutationFn: () => fleetApi.saveService(tenantId, car.id, item?.id ?? null, data), onSuccess: async saved => { await onSaved(saved); onClose() } })
  return <AccessDialog title={item ? 'Szervizbejegyzés szerkesztése' : 'Új szervizbejegyzés'} pending={save.isPending} onClose={onClose}>
    <form className="org-form" onSubmit={e => { e.preventDefault(); save.mutate() }}><p className="access-description">{car.registration}</p>
      <QueryMessage pending={partners.isPending} error={partners.error} retry={() => void partners.refetch()} />
      {partners.data && !partners.data.length && !item && <p className="notice">Előbb vegyél fel egy szervizt a Partnerek menüpontban.</p>}
      <fieldset disabled={save.isPending}><div className="org-form-grid">
        <SelectField label="Szervizpartner" value={data.partnerId} onChange={x => setData({ ...data, partnerId: x })} required
          options={{ '': 'Válassz szervizt', ...(item ? { [item.data.partnerId]: item.partnerName } : {}), ...Object.fromEntries((partners.data ?? []).map(x => [x.id, x.name])) }} />
        <DateField label="Szerviz dátuma" value={data.performedOn} onChange={x => setData({ ...data, performedOn: x ?? '' })} required />
        <NumberField label="Kilométerállás a szerviznél" value={data.kilometers} onChange={x => setData({ ...data, kilometers: x })} />
        <TextField label="Munkalapszám" value={data.workOrderNumber} maxLength={100} onChange={x => setData({ ...data, workOrderNumber: x })} />
        <NumberField label="Szervizköltség" value={data.cost} max={1000000000000} step={0.01} onChange={x => setData({ ...data, cost: x })} />
        <CurrencyField value={data.currency} onChange={x => setData({ ...data, currency: x })} />
        <DateField label="Következő szerviz dátuma" value={data.nextServiceDate} onChange={x => setData({ ...data, nextServiceDate: x })} />
        <NumberField label="Következő szerviz (km)" value={data.nextServiceKm} onChange={x => setData({ ...data, nextServiceKm: x })} />
        <TextField label="Munkalap / számla webcíme" value={data.documentUrl} type="url" maxLength={2048} onChange={x => setData({ ...data, documentUrl: x })} />
      </div></fieldset>
      <NotesField label="Elvégzett munka" value={data.description} onChange={x => setData({ ...data, description: x })} maxLength={2000} required disabled={save.isPending} />
      <NotesField value={data.notes} onChange={x => setData({ ...data, notes: x })} disabled={save.isPending} />
      <p className="field-hint">A szerviznél feljegyzett kilométerállás és következő időpont a bejegyzés része. A jármű aktuális km-állását és szervizhatáridejét külön módosíthatod.</p>
      <p className="field-hint">Mentés után a Dokumentumok ablakban fájlokat is csatolhatsz.</p>
      {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
      <DialogActions pending={save.isPending} onClose={onClose} submitDisabled={partners.isPending || partners.isError} />
    </form>
  </AccessDialog>
}
