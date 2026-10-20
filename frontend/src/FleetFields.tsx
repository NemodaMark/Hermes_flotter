import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AccessDialog } from './AccessDialog'
import { PageButtons } from './CompaniesPage'
import { OrganizationAuditChanges } from './OrganizationAuditChanges'
import { fleetApi } from './fleetApi'
import { currencies, currencyLabel, withCurrentValue } from './companyOptions'

export function SelectField({ label, value, options, onChange, disabled = false, required = false }: {
  label: string; value: string; options: Record<string, string>; onChange: (value: string) => void; disabled?: boolean; required?: boolean
}) {
  return <label className="org-field"><span>{label}</span><select value={value} onChange={e => onChange(e.target.value)} disabled={disabled} required={required}>
    {Object.entries(options).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
  </select></label>
}
export function NumberField({ label, value, onChange, max = 100000000, step = 1, disabled = false }: {
  label: string; value: number | null; onChange: (value: number | null) => void; max?: number; step?: number; disabled?: boolean
}) {
  return <label className="org-field"><span>{label}</span><input type="number" min={0} max={max} step={step} value={value ?? ''} disabled={disabled}
    onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} /></label>
}
export function DateField({ label, value, onChange, disabled = false, required = false }: {
  label: string; value: string | null; onChange: (value: string | null) => void; disabled?: boolean; required?: boolean
}) {
  return <label className="org-field"><span>{label}</span><input type="date" min="1900-01-01" max="2100-12-31" value={value ?? ''} required={required} disabled={disabled}
    onChange={e => onChange(e.target.value || null)} /></label>
}
export function NotesField({ label = 'Megjegyzés', value, onChange, disabled = false, maxLength = 4000, required = false }: {
  label?: string; value: string | null; onChange: (value: string) => void; disabled?: boolean; maxLength?: number; required?: boolean
}) {
  return <label className="org-field"><span>{label}</span><textarea rows={3} value={value ?? ''} maxLength={maxLength} disabled={disabled} required={required} onChange={e => onChange(e.target.value)} /></label>
}
export function CurrencyField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <SelectField label="Pénznem" value={value} onChange={onChange} options={Object.fromEntries(withCurrentValue(currencies, value).map(x => [x, currencyLabel(x)]))} />
}
export function QueryMessage({ pending, error, retry }: { pending: boolean; error: Error | null; retry?: () => void }) {
  return pending ? <p className="notice" role="status">Betöltés…</p> : error ? <div className="notice error" role="alert"><p>{error.message}</p>{retry && <button className="text-button" onClick={retry}>Újrapróbálom</button>}</div> : null
}
export function ReasonDialog({ title, onClose, onSave }: { title: string; onClose: () => void; onSave: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState('')
  const save = useMutation({ mutationFn: () => onSave(reason), onSuccess: onClose })
  return <AccessDialog title={title} pending={save.isPending} onClose={onClose}><form className="org-form" onSubmit={e => { e.preventDefault(); save.mutate() }}>
    <NotesField label="Indoklás" value={reason} onChange={setReason} required maxLength={500} disabled={save.isPending} />
    {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
    <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={save.isPending}>Mégse</button><button className="primary-button" disabled={save.isPending}>Mentés</button></div>
  </form></AccessDialog>
}
const actionLabels: Record<string, string> = {
  'vehicle.lease_document_uploaded': 'Lízingszerződés fájljának feltöltése', 'vehicle.service_document_uploaded': 'Szervizdokumentum feltöltése',
  'vehicle.lease_document_status_changed': 'Lízingdokumentum visszavonása / visszaállítása', 'vehicle.service_document_status_changed': 'Szervizdokumentum visszavonása / visszaállítása',
  'vehicle.created': 'Jármű felvétele', 'vehicle.updated': 'Járműadatok módosítása', 'vehicle.details_updated': 'Járműadatlap módosítása',
  'vehicle.status_changed': 'Archiválás / visszaállítás', 'vehicle.odometer_recorded': 'Kilométerállás rögzítése', 'site.vehicle_assigned': 'Telephelyváltás',
  'vehicle.lease_created': 'Lízingszerződés felvétele', 'vehicle.lease_updated': 'Lízingszerződés módosítása',
  'vehicle.service_created': 'Szerviz rögzítése', 'vehicle.service_updated': 'Szerviz módosítása', 'vehicle.service_voided': 'Szerviz érvénytelenítése',
  'partner.created': 'Partner felvétele', 'partner.updated': 'Partneradatok módosítása', 'partner.status_changed': 'Partner archiválása / visszaállítása',
}
export function FleetAudit({ tenantId, id, vehicle }: { tenantId: string; id: string; vehicle: boolean }) {
  const [page, setPage] = useState(1)
  const data = useQuery({ queryKey: ['fleet-management', tenantId, id, 'audit', page], queryFn: ({ signal }) => fleetApi.audit(tenantId, id, vehicle, page, signal), retry: false })
  return <><QueryMessage pending={data.isPending} error={data.error} retry={() => void data.refetch()} />{data.data && <>
    <div className="table-scroll"><table className="org-table"><thead><tr><th>Időpont / művelet</th><th>Módosító</th><th>Változás</th></tr></thead><tbody>
      {data.data.items.map(x => <tr key={x.id}><td>{new Date(x.createdAt).toLocaleString('hu-HU')}<span className="member-email">{actionLabels[x.action] ?? x.action}</span></td><td>{x.actorSubject}</td><td><details><summary>Részletek</summary><OrganizationAuditChanges details={x.details} /></details></td></tr>)}
      {!data.data.items.length && <tr><td colSpan={3}>Még nincs naplóbejegyzés.</td></tr>}
    </tbody></table></div><PageButtons page={page} total={data.data.total} pending={data.isFetching} onPage={setPage} />
  </>}</>
}
