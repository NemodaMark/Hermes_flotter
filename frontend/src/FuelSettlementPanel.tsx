import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session, Tenant } from './api'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Disclosure } from './ui/Disclosure'
import { Badge } from './ui/Badge'
import { QueryMessage, ReasonDialog } from './FleetFields'
import { dateText, moneyText } from './fleetApi'
import { localMileageDate } from './mileageApi'
import { settlementApi, saveSettlementFile } from './settlementApi'
import type { SettlementCalculation, SettlementDraft, SettlementLine, SettlementOptions, SettlementReport, SettlementRules } from './settlementApi'
import { FuelSettlementImport } from './FuelSettlementImport'
import './settlement.css'

const number = (n: number | null, digits = 2) => n == null ? '—' : n.toLocaleString('hu-HU', { maximumFractionDigits: digits })
const money = (n: number | null) => n == null ? 'Nem számítható' : moneyText(n, 'HUF')
const statuses: Record<string, string> = { Draft: 'Piszkozat', Submitted: 'Beküldve', Approved: 'Jóváhagyva' }
export function FuelSettlementPanel({ tenant, user, initialMonth }: { tenant: Tenant; user: Session; initialMonth?: string }) {
  const client = useQueryClient()
  const [month, setMonth] = useState(() => initialMonth ?? (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` })())
  const [userId, setUser] = useState(user.id)
  const [importOpen, setImport] = useState(false)
  const options = useQuery({ queryKey: ['settlements', tenant.id, userId, month, 'options'], queryFn: ({ signal }) => settlementApi.options(tenant.id, userId, month, signal), retry: false })
  const report = useQuery({ queryKey: ['settlements', tenant.id, userId, month], queryFn: ({ signal }) => settlementApi.read(tenant.id, userId, month, signal), retry: false })
  const refresh = async () => { await client.invalidateQueries({ queryKey: ['settlements', tenant.id] }) }
  return <section className="settlement-panel" aria-label="Üzemanyag-elszámolás">
    <div className="mileage-toolbar">
      <label className="org-field"><span>Elszámolási hónap</span><input type="month" min="1900-01" max={localMileageDate().slice(0, 7)} value={month.slice(0, 7)} onChange={e => { if (e.target.value) setMonth(e.target.value + '-01') }} /></label>
      {options.data && options.data.people.length > 1 && <label className="org-field"><span>Elszámoló felhasználó</span><Select value={userId} onChange={e => setUser(e.target.value)}>{options.data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></label>}
    </div>
    <QueryMessage pending={report.isPending || options.isPending} error={report.error ?? options.error} retry={() => { void report.refetch(); void options.refetch() }} />
    {tenant.permissions.includes('vehicles.settlements.manage') && <Button type="button" className="secondary-button" onClick={() => setImport(x => !x)} aria-expanded={importOpen}>Excel / ZIP próbaimport</Button>}
    {importOpen && <FuelSettlementImport tenant={tenant} onImported={row => { setUser(row.userId); setMonth(row.month); setImport(false); void refresh() }} />}
    {report.data && options.data && <SettlementEditor key={`${tenant.id}:${userId}:${month}:${report.data.version}`} tenant={tenant} user={user} report={report.data} options={options.data} onChanged={refresh} />}
  </section>
}

function DecimalField({ label, value, onChange, disabled = false, digits = 3 }: { label: string; value: number | null; onChange: (n: number | null) => void; disabled?: boolean; digits?: number }) {
  return <label className="org-field"><span>{label}</span><input type="number" inputMode="decimal" min="0" max="100000000" step={10 ** -digits} value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} /></label>
}
function RulesFields({ rules, setRules, disabled }: { rules: SettlementRules; setRules: (r: SettlementRules) => void; disabled: boolean }) {
  return <div className="org-form-grid">
    <DecimalField label="Ingyenes magánkeret (km/hó)" value={rules.freeKm} onChange={n => setRules({ ...rules, freeKm: n ?? 0 })} disabled={disabled} />
    <DecimalField label="I. fizetős díjsáv hossza (km)" value={rules.firstBandKm} onChange={n => setRules({ ...rules, firstBandKm: n ?? 0 })} disabled={disabled} />
    <DecimalField label="I. díjsáv (Ft/km)" value={rules.firstRate} onChange={n => setRules({ ...rules, firstRate: n ?? 0 })} disabled={disabled} digits={4} />
    <DecimalField label="II. díjsáv (Ft/km)" value={rules.secondRate} onChange={n => setRules({ ...rules, secondRate: n ?? 0 })} disabled={disabled} digits={4} />
  </div>
}
function SettlementEditor({ tenant, user, report, options, onChanged }: { tenant: Tenant; user: Session; report: SettlementReport; options: SettlementOptions; onChanged: () => Promise<void> }) {
  const manage = tenant.permissions.includes('vehicles.settlements.manage')
  const writable = report.status === 'Draft' && (manage || user.id === report.userId && tenant.permissions.includes('vehicles.settlements.record'))
  const [draft, setDraft] = useState<SettlementDraft>(report.data)
  const [calculation, setCalculation] = useState<SettlementCalculation | null>(report.version ? report.calculation : null)
  const [dirty, setDirty] = useState(false)
  const [reopen, setReopen] = useState(false)
  const [historyOpen, setHistory] = useState(false)
  const history = useQuery({ queryKey: ['settlements', tenant.id, report.userId, report.month, 'history'], queryFn: () => settlementApi.history(tenant.id, report.userId, report.month), enabled: historyOpen, retry: false })
  const operation = useMutation({ mutationKey: ['settlements', tenant.id], mutationFn: async (action: string) => {
    if (action === 'preview') { setCalculation(await settlementApi.preview(tenant.id, report.userId, report.month, draft)); return }
    if (action === 'save') await settlementApi.save(tenant.id, report.userId, report.month, draft)
    else if (action === 'export') { saveSettlementFile(await settlementApi.export(tenant.id, report), `uzemanyag-elszamolas-${report.month.slice(0, 7)}.csv`); return }
    else await settlementApi.action(tenant.id, report, action)
    await onChanged()
  } })
  const download = useMutation({ mutationFn: async (vehicle: string) => saveSettlementFile(await settlementApi.source(tenant.id, report, vehicle), `eredeti-elszamolas-${report.month.slice(0, 7)}.xlsx`) })
  function change(next: SettlementDraft) { setDraft(next); setDirty(true); setCalculation(null) }
  function line(index: number, values: Partial<SettlementLine>) { change({ ...draft, lines: draft.lines.map((x, i) => i === index ? { ...x, ...values } : x) }) }
  const vehicles = [...options.vehicles, ...report.vehicles.filter(v => !options.vehicles.some(x => x.id === v.id))]
  const pending = operation.isPending || download.isPending
  return <div className="settlement-editor">
    <div className="mileage-section-heading"><h3>Magánhasználati díj</h3><Badge tone={report.status === 'Approved' ? 'success' : 'neutral'}>{statuses[report.status]}{report.version > 0 ? ` · ${report.version}. verzió` : ''}</Badge></div>
    <Disclosure className="settlement-rules" trigger="Keret és díjsávok">
      <p className="field-hint">Ez az ingyenes magánkeret. A teljes havi futásteljesítmény-keret a Kilométerek fülön marad.</p>
      <RulesFields rules={draft.rules} setRules={rules => change({ ...draft, rules })} disabled={!writable || !manage || pending} />
      {tenant.permissions.includes('settlements.configure') && <SettlementPolicyEditor tenant={tenant} policy={options.policy} month={report.month} onChanged={onChanged} />}
    </Disclosure>
    <form onSubmit={e => { e.preventDefault(); operation.mutate('save') }}>
      {draft.lines.map((row, index) => <fieldset className="settlement-line" key={row.vehicleId} disabled={!writable || pending}>
        <legend>{vehicles.find(v => v.id === row.vehicleId)?.registration ?? row.vehicleId}</legend>
        <div className="org-form-grid">
          <DecimalField label="Nyitó kilométerállás" value={row.startKm} onChange={startKm => line(index, { startKm })} />
          <DecimalField label="Záró kilométerállás" value={row.endKm} onChange={endKm => line(index, { endKm })} />
          <DecimalField label="Ebből magánhasználat (km)" value={row.privateKm} onChange={privateKm => line(index, { privateKm })} />
          <DecimalField label="Havi tankolás (liter)" value={row.liters} onChange={liters => line(index, { liters, useRecordedFuel: false })} disabled={row.useRecordedFuel} />
          <DecimalField label="Havi üzemanyagár (Ft/l)" value={row.unitPrice} onChange={unitPrice => line(index, { unitPrice })} digits={4} />
          <label className="org-field"><span>Üzemanyagár forrása</span><input value={row.priceSource ?? ''} maxLength={200} onChange={e => line(index, { priceSource: e.target.value })} /></label>
        </div>
        <label className="checkbox-label"><input type="checkbox" checked={row.useRecordedFuel ?? false} onChange={e => line(index, { useRecordedFuel: e.target.checked })} />Literek átvétele a HERMES havi tankolásaiból</label>
        {!report.sources.some(s => s.vehicleId === row.vehicleId) && <Button type="button" className="text-button" onClick={() => change({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}>Sor eltávolítása</Button>}
      </fieldset>)}
      {writable && <label className="org-field"><span>Jármű hozzáadása</span><Select value="" disabled={pending || draft.lines.length >= 20} onChange={e => {
        if (e.target.value) change({ ...draft, lines: [...draft.lines, { vehicleId: e.target.value, startKm: null, endKm: null, liters: null, privateKm: null, unitPrice: null }] })
      }}><option value="">Válassz járművet</option>{options.vehicles.filter(v => !draft.lines.some(l => l.vehicleId === v.id)).map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}</Select></label>}
      {manage && <Disclosure className="settlement-agreement" trigger="Egyedi megállapodás"><div className="org-form-grid">
        <DecimalField label="Megállapodás szerinti havi összeg (Ft)" value={draft.agreedAmount} onChange={agreedAmount => change({ ...draft, agreedAmount })} disabled={!writable || pending} digits={2} />
        <label className="org-field"><span>Megállapodás indoka</span><textarea maxLength={500} rows={2} value={draft.agreementReason ?? ''} disabled={!writable || pending} required={draft.agreedAmount != null} onChange={e => change({ ...draft, agreementReason: e.target.value })} /></label>
      </div></Disclosure>}
      {writable && report.version > 0 && <label className="org-field"><span>Módosítás indoka</span><textarea rows={2} maxLength={500} required value={draft.reason ?? ''} disabled={pending} onChange={e => change({ ...draft, reason: e.target.value })} /></label>}
      {writable && <div className="dialog-actions"><Button type="button" className="secondary-button" disabled={pending || !draft.lines.length} onClick={() => operation.mutate('preview')}>Számítás ellenőrzése</Button><Button className="primary-button" disabled={pending || !draft.lines.length}>Piszkozat mentése</Button></div>}
    </form>
    {operation.error && <p role="alert" className="form-error">{operation.error.message}</p>}
    {download.error && <p role="alert" className="form-error">{download.error.message}</p>}
    {calculation && <SettlementBreakdown calculation={calculation} vehicles={vehicles} />}
    {report.sources.map(source => <div key={source.vehicleId} className="settlement-source"><strong>Excel: {source.sheet} · {money(source.originalAmount)}</strong><span>{source.fileName}</span>
      {manage && <Button type="button" className="text-button" disabled={download.isPending} onClick={() => download.mutate(source.vehicleId)}>Eredeti Excel letöltése</Button>}</div>)}
    <div className="dialog-actions">
      {writable && report.version > 0 && <Button className="primary-button" disabled={pending || dirty || report.calculation.issues.length > 0} onClick={() => operation.mutate('submit')}>Beküldés jóváhagyásra</Button>}
      {report.status === 'Submitted' && tenant.permissions.includes('vehicles.settlements.approve') && <Button className="primary-button" disabled={pending} onClick={() => operation.mutate('approve')}>Elszámolás jóváhagyása</Button>}
      {report.status !== 'Draft' && manage && <Button className="secondary-button" onClick={() => setReopen(true)} disabled={pending}>Újranyitás javításhoz</Button>}
      {report.status === 'Approved' && <Button className="secondary-button" disabled={pending} onClick={() => operation.mutate('export')}>CSV a bérszámfejtéshez</Button>}
    </div>
    {report.updatedBy && <p className="field-hint">Módosította: {report.updatedBy} · {report.updatedAt && new Date(report.updatedAt).toLocaleString('hu-HU')}{report.approvedBy && ` · Jóváhagyta: ${report.approvedBy}`}</p>}
    {report.version > 0 && <><Button className="text-button" onClick={() => setHistory(x => !x)} aria-expanded={historyOpen}>Módosítási előzmények</Button>{historyOpen && <>
      <QueryMessage pending={history.isPending} error={history.error} />
      <ul className="mileage-entries">{history.data?.map(row => <li key={row.version}><span>{row.version}. verzió · {statuses[row.status]} · {row.actor} · {dateText(row.createdAt)}</span><span>{money(row.report.calculation.amount)}{row.reason && ` · ${row.reason}`}</span></li>)}</ul>
    </>}</>}
    {reopen && <ReasonDialog title="Elszámolás újranyitása" onClose={() => setReopen(false)} onSave={async reason => { await settlementApi.action(tenant.id, report, 'reopen', reason); await onChanged() }} />}
  </div>
}

function SettlementBreakdown({ calculation, vehicles }: { calculation: SettlementCalculation; vehicles: SettlementOptions['vehicles'] }) {
  return <section aria-label="Elszámolás levezetése" className="settlement-breakdown">
    <h3>Számítás</h3>
    {calculation.issues.length > 0 && <ul className="notice error" role="status">{calculation.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {calculation.lines.map(row => <Disclosure key={row.vehicleId} className="settlement-result" trigger={`${vehicles.find(v => v.id === row.vehicleId)?.registration ?? row.vehicleId} · ${money(row.amount)}`}>
      <dl className="settlement-values">{[
        ['Havi futás', `${number(row.totalKm)} km`], ['Fogyasztás', `${number(row.consumption, 4)} l/100 km`], ['Ingyenes magánhasználat', `${number(row.freeKm)} km`],
        ['Fizetős magánhasználat', `${number(row.paidKm)} km`], ['I. díjsáv', `${number(row.firstBandKm)} km · ${money(row.firstAmount)}`],
        ['II. díjsáv', `${number(row.secondBandKm)} km · ${money(row.secondAmount)}`], ['Üzemanyagköltség', money(row.fuelAmount)],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </Disclosure>)}
    <dl className="mileage-totals"><div><dt>Számított havi díj</dt><dd>{money(calculation.standardAmount)}</dd></div><div><dt>Elszámolandó összeg</dt><dd>{money(calculation.amount)}</dd></div></dl>
  </section>
}

function SettlementPolicyEditor({ tenant, policy, month, onChanged }: { tenant: Tenant; policy: SettlementOptions['policy']; month: string; onChanged: () => Promise<void> }) {
  const [rules, setRules] = useState(policy.rules)
  const save = useMutation({ mutationFn: () => settlementApi.policy(tenant.id, month, policy.month === month ? policy.version : 0, rules), onSuccess: onChanged })
  return <Disclosure className="settlement-company-policy" trigger="Céges alapértékek beállítása">
    <p className="field-hint">Érvényesség kezdete: {month.slice(0, 7)}. A már mentett elszámolások szabályai megmaradnak.</p>
    <RulesFields rules={rules} setRules={setRules} disabled={save.isPending} />
    {save.error && <p role="alert" className="form-error">{save.error.message}</p>}
    <Button className="secondary-button" disabled={save.isPending} onClick={() => save.mutate()}>Céges szabályok mentése</Button>
  </Disclosure>
}
