import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session, Tenant } from './api'
import { mileageApi, localMileageDate, mileageMonth } from './mileageApi'
import type { MileageEntry, MileageMode, MileageReport, MileageUser } from './mileageApi'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Disclosure } from './ui/Disclosure'
import { Badge } from './ui/Badge'
import { QueryMessage, ReasonDialog } from './FleetFields'
import { dateText } from './fleetApi'
import './mileage.css'

const km = (value: number) => `${value.toLocaleString('hu-HU')} km`
const sourceNames: Record<string, string> = { Fuel: 'Tankolás', Odometer: 'Km-rögzítés', Manual: 'Kézi tétel' }
const FuelSettlementPanel = lazy(() => import('./FuelSettlementPanel').then(m => ({ default: m.FuelSettlementPanel })))
export function MileagePanel(props: { tenant: Tenant; user: Session; initialMonth?: string }) {
  const ledger = props.tenant.permissions.some(p => p === 'mileage.record' || p === 'mileage.manage')
  const settlement = props.tenant.permissions.some(p => p.startsWith('vehicles.settlements.'))
  const [tab, setTab] = useState(ledger ? 'km' : 'settlement')
  return <>
    {ledger && settlement && <div className="mileage-dialog-tabs" role="group" aria-label="Havi elszámolás típusa">
      <Button className="secondary-button" aria-pressed={tab === 'km'} onClick={() => setTab('km')}>Kilométerek</Button>
      <Button className="secondary-button" aria-pressed={tab === 'settlement'} onClick={() => setTab('settlement')}>Magánhasználati díj</Button>
    </div>}
    {tab === 'km' && ledger ? <MileageLedgerPanel {...props} /> : settlement ? <Suspense fallback={<p role="status">Elszámolás betöltése…</p>}><FuelSettlementPanel {...props} /></Suspense> : <p>Nincs elszámolási jogosultságod.</p>}
  </>
}
function MileageLedgerPanel({ tenant, user, initialMonth }: { tenant: Tenant; user: Session; initialMonth?: string }) {
  const client = useQueryClient()
  const [month, setMonth] = useState(initialMonth ?? mileageMonth(localMileageDate()))
  const [userId, setUserId] = useState(user.id)
  const manage = tenant.permissions.includes('mileage.manage')
  const accounts = useQuery({ queryKey: ['mileage', tenant.id, 'accounts'], queryFn: ({ signal }) => mileageApi.users(tenant.id, signal), enabled: manage, retry: false })
  const report = useQuery({ queryKey: ['mileage', tenant.id, userId, month], queryFn: ({ signal }) => mileageApi.read(tenant.id, userId, month, signal), retry: false })
  const [message, setMessage] = useState('')
  const changed = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ['mileage', tenant.id] }), client.invalidateQueries({ queryKey: ['dashboard'] })])
  }
  return <section className="mileage-panel" aria-label="Havi km-elszámolás">
    <div className="mileage-toolbar">
      <label className="org-field"><span>Elszámolási hónap</span><input type="month" value={month.slice(0, 7)} max={localMileageDate().slice(0, 7)} min="1900-01" onChange={e => { if (e.target.value) { setMonth(e.target.value + '-01'); setMessage('') } }} /></label>
      {manage && accounts.data && <label className="org-field"><span>Felhasználó</span><Select value={userId} onChange={e => { setUserId(e.target.value); setMessage('') }}>
        {accounts.data.map(person => <option key={person.userId} value={person.userId}>{person.name}</option>)}
      </Select></label>}
    </div>
    <QueryMessage pending={report.isPending} error={report.error} retry={() => void report.refetch()} />
    {accounts.error && <p className="form-error" role="alert">{accounts.error.message}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {report.data && <MileageMonthEditor key={`${userId}:${month}:${report.data.version}`} tenant={tenant} report={report.data}
      account={manage ? accounts.data?.find(person => person.userId === userId) : undefined} onChanged={changed} onMessage={setMessage} onDue={setMonth} />}
  </section>
}

function MileageMonthEditor({ tenant, report, account, onChanged, onMessage, onDue }: {
  tenant: Tenant; report: MileageReport; account?: MileageUser; onChanged: () => Promise<void>; onMessage: (text: string) => void; onDue: (month: string) => void
}) {
  const [entry, setEntry] = useState<MileageEntry | 'new' | null>(null)
  const [voidEntry, setVoidEntry] = useState<MileageEntry | null>(null)
  const [correctMonth, setCorrectMonth] = useState(false)
  const mode = useMutation({ mutationKey: ['mileage', tenant.id], mutationFn: (mode: MileageMode) => mileageApi.mode(tenant.id, report, mode), onSuccess: onChanged })
  return <>
    {report.dueMonth && <div className="mileage-due" role="status"><span>Lezárandó hónap: {report.dueMonth.slice(0, 7)}</span>
      {report.dueMonth !== report.month && <Button type="button" className="secondary-button" onClick={() => onDue(report.dueMonth!)}>Megnyitás</Button>}
    </div>}
    <div className="mileage-mode"><label className="org-field"><span>Rögzítés módja</span><Select value={report.mode} disabled={mode.isPending || report.submittedAt !== null} onChange={e => mode.mutate(e.target.value as MileageMode)}>
      <option value="Entries">Tételenként, automatikus összesítéssel</option><option value="Monthly">Havonta egy összesítővel</option>
    </Select></label><Badge tone={report.submittedAt ? 'success' : 'neutral'} dot={false}>{report.submittedAt ? 'Lezárva' : 'Piszkozat'}</Badge></div>
    {mode.error && <p role="alert" className="form-error">{mode.error.message}</p>}
    <dl className="mileage-totals">
      <div><dt>Teljes futásteljesítmény</dt><dd>{km(report.totalKm)}</dd></div>
      <div><dt>Ebből magánhasználat</dt><dd>{km(report.privateKm)}</dd></div>
      <div><dt>Céges használat</dt><dd>{km(report.totalKm - report.privateKm)}</dd></div>
      <div><dt>Havi teljes km-keret</dt><dd>{report.monthlyLimitKm == null ? 'Nincs beállítva' : km(report.monthlyLimitKm)}</dd></div>
    </dl>
    {report.monthlyLimitKm != null && report.totalKm > report.monthlyLimitKm && <p className="notice error" role="status">Kerettúllépés: {km(report.totalKm - report.monthlyLimitKm)}. A teljes megtett távolságot számold el.</p>}
    {account && <Disclosure className="mileage-limit" trigger="Személyes havi km-keret beállítása"><MileageLimitForm tenant={tenant} account={account} onChanged={onChanged} /></Disclosure>}
    {report.mode === 'Entries' && <>
      <div className="mileage-section-heading"><h3>Havi tételek</h3><Button type="button" className="secondary-button" onClick={() => setEntry('new')}>Km-tétel hozzáadása</Button></div>
      {report.entries.length === 0 ? <p className="field-hint">Még nincs elszámolt tétel ebben a hónapban.</p> : <ul className="mileage-entries">{report.entries.map(row => <li key={row.id}>
        <div><strong>{dateText(row.occurredOn)} · {km(row.totalKm)}</strong><span>{sourceNames[row.source] ?? row.source} · magánhasználat: {km(row.privateKm)}{row.isVoided ? ' · Érvénytelenítve' : ''}</span>
          <small>{row.updatedBy ? `Módosította: ${row.updatedBy}` : `Rögzítette: ${row.recordedBy}`}</small></div>
        {!row.isVoided && <div className="member-actions"><Button type="button" className="secondary-button" onClick={() => setEntry(row)}>Módosítás</Button><Button type="button" className="text-button" onClick={() => setVoidEntry(row)}>Érvénytelenítés</Button></div>}
      </li>)}</ul>}
    </>}
    {report.mode === 'Monthly' && report.entries.some(row => !row.isVoided) && <p className="field-hint">A korábbi részletes tételek megmaradtak; ebben a módban kizárólag a havi összesítő számít.</p>}
    {report.submittedAt && !correctMonth ? <div className="mileage-submitted"><span>Lezárva: {new Date(report.submittedAt).toLocaleString('hu-HU')} · {report.updatedBy}</span>
      <Button type="button" className="secondary-button" onClick={() => setCorrectMonth(true)}>Elszámolás javítása</Button>
    </div> : <MileageClosingForm tenant={tenant} report={report} onChanged={onChanged} onMessage={onMessage} onCancel={report.submittedAt ? () => setCorrectMonth(false) : undefined} />}
    {entry && <MileageEntryEditor tenant={tenant} report={report} item={entry === 'new' ? null : entry} onClose={() => setEntry(null)} onChanged={onChanged} />}
    {voidEntry && <ReasonDialog title="Km-tétel érvénytelenítése" onClose={() => setVoidEntry(null)} onSave={async reason => {
      await mileageApi.entry(tenant.id, report, voidEntry, { occurredOn: voidEntry.occurredOn, totalKm: voidEntry.totalKm, privateKm: voidEntry.privateKm, reason }, true)
      await onChanged()
    }} />}
  </>
}

function MileageLimitForm({ tenant, account, onChanged }: { tenant: Tenant; account: MileageUser; onChanged: () => Promise<void> }) {
  const [limit, setLimit] = useState(account.monthlyLimitKm?.toString() ?? '')
  const save = useMutation({ mutationKey: ['mileage', tenant.id], mutationFn: () => mileageApi.limit(tenant.id, account, limit === '' ? null : Number(limit)), onSuccess: onChanged })
  return <form className="mileage-limit-form" onSubmit={e => { e.preventDefault(); save.mutate() }}>
    <label className="org-field"><span>Havi teljes futásteljesítmény-keret (km)</span><input type="number" inputMode="numeric" min="0" max="100000000" step="1" value={limit} disabled={save.isPending} onChange={e => setLimit(e.target.value)} /></label>
    <p className="field-hint">A keret a céges és a magánhasználatot együtt tartalmazza. A lezárt hónapok megőrzik a korábbi keretet.</p>
    {save.error && <p role="alert" className="form-error">{save.error.message}</p>}
    <Button className="primary-button" loading={save.isPending}>Km-keret mentése</Button>
  </form>
}

function MileageClosingForm({ tenant, report, onChanged, onMessage, onCancel }: { tenant: Tenant; report: MileageReport; onChanged: () => Promise<void>; onMessage: (text: string) => void; onCancel?: () => void }) {
  const [total, setTotal] = useState(String(report.totalKm)), [personal, setPersonal] = useState(String(report.privateKm))
  const save = useMutation({ mutationKey: ['mileage', tenant.id], mutationFn: (input: { form: FormData; submit: boolean }) => mileageApi.save(tenant.id, report, {
    totalKm: report.mode === 'Monthly' ? Number(total) : null, privateKm: report.mode === 'Monthly' ? Number(personal) : null,
    submit: input.submit, confirmNoUsage: input.form.get('noUsage') === 'on', reason: String(input.form.get('reason') ?? ''),
  }), onSuccess: async row => { onMessage(row.submittedAt ? 'A havi elszámolás lezárva.' : 'A piszkozat elmentve; a hónapot még le kell zárnod.'); await onChanged() } })
  return <form className="mileage-closing" aria-label="Havi elszámolás lezárása" onSubmit={e => {
    e.preventDefault()
    save.mutate({ form: new FormData(e.currentTarget), submit: (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') !== 'draft' })
  }}>
    {report.mode === 'Monthly' && <div className="org-form-grid">
      <label className="org-field"><span>Teljes havi kilométer</span><input type="number" inputMode="numeric" min="0" max="100000000" step="1" required value={total} disabled={save.isPending} onChange={e => setTotal(e.target.value)} /></label>
      <label className="org-field"><span>Ebből magánhasználat (km)</span><input type="number" inputMode="numeric" min="0" max={Number(total)} step="1" required value={personal} disabled={save.isPending} onChange={e => setPersonal(e.target.value)} /></label>
    </div>}
    {(report.mode === 'Entries' ? report.totalKm === 0 : Number(total) === 0) && <label className="checkbox-label"><input type="checkbox" name="noUsage" disabled={save.isPending} />Ebben a hónapban nem volt elszámolandó használatom.</label>}
    {report.submittedAt && <label className="org-field"><span>Javítás indoka</span><textarea name="reason" rows={2} required maxLength={500} disabled={save.isPending} /></label>}
    {save.error && <p role="alert" className="form-error">{save.error.message}</p>}
    <div className="dialog-actions">{onCancel && <Button type="button" className="secondary-button" disabled={save.isPending} onClick={onCancel}>Mégse</Button>}
      <Button className="secondary-button" name="action" value="draft" disabled={save.isPending}>Piszkozat mentése</Button><Button className="primary-button" name="action" value="submit" loading={save.isPending}>Hónap lezárása</Button></div>
  </form>
}

function MileageEntryEditor({ tenant, report, item, onClose, onChanged }: { tenant: Tenant; report: MileageReport; item: MileageEntry | null; onClose: () => void; onChanged: () => Promise<void> }) {
  const [year, month] = report.month.split('-').map(Number)
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
  const [total, setTotal] = useState(item?.totalKm.toString() ?? ''), [personal, setPersonal] = useState(item?.privateKm.toString() ?? '0')
  const save = useMutation({ mutationKey: ['mileage', tenant.id], mutationFn: (form: FormData) => mileageApi.entry(tenant.id, report, item, {
    occurredOn: String(form.get('date')), totalKm: Number(total), privateKm: Number(personal), reason: String(form.get('reason') ?? ''),
  }), onSuccess: async () => { onClose(); await onChanged() } })
  return <form className="mileage-entry-editor" aria-label={item ? 'Km-tétel módosítása' : 'Új km-tétel'} onSubmit={e => { e.preventDefault(); save.mutate(new FormData(e.currentTarget)) }}>
    <h3>{item ? 'Km-tétel módosítása' : 'Új km-tétel'}</h3><div className="org-form-grid">
      <label className="org-field"><span>Tétel napja</span><input type="date" name="date" min={report.month} max={localMileageDate() < lastDay ? localMileageDate() : lastDay} defaultValue={item?.occurredOn ?? report.month} required disabled={save.isPending} /></label>
      <label className="org-field"><span>Megtett távolság (km)</span><input type="number" inputMode="numeric" min="0" max="100000000" step="1" value={total} onChange={e => setTotal(e.target.value)} required disabled={save.isPending} /></label>
      <label className="org-field"><span>Magánhasználat (km)</span><input type="number" inputMode="numeric" min="0" max={Number(total)} step="1" value={personal} onChange={e => setPersonal(e.target.value)} required disabled={save.isPending} /></label>
    </div>
    {(item || report.submittedAt) && <label className="org-field"><span>Módosítás indoka</span><textarea name="reason" rows={2} required maxLength={500} disabled={save.isPending} /></label>}
    {save.error && <p role="alert" className="form-error">{save.error.message}</p>}
    <div className="dialog-actions"><Button type="button" className="secondary-button" onClick={onClose} disabled={save.isPending}>Mégse</Button><Button className="primary-button" loading={save.isPending}>Km-tétel mentése</Button></div>
  </form>
}
