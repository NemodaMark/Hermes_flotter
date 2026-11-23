import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { Tenant } from './api'
import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { settlementApi } from './settlementApi'
import type { LegacySettlement, SettlementReport } from './settlementApi'
import { moneyText } from './fleetApi'

export function FuelSettlementImport({ tenant, onImported }: { tenant: Tenant; onImported: (row: SettlementReport) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [selected, setSelected] = useState<LegacySettlement | null>(null)
  const [user, setUser] = useState(''), [vehicle, setVehicle] = useState(''), [reason, setReason] = useState('')
  const [choices, setChoices] = useState<Awaited<ReturnType<typeof settlementApi.options>> | null>(null)
  const [choiceError, setChoiceError] = useState('')
  function form() { const data = new FormData(); if (file) data.set('file', file); data.set('year', String(year)); return data }
  const preview = useMutation({ mutationFn: () => settlementApi.importPreview(tenant.id, form()) })
  const select = useMutation({ mutationFn: async (row: LegacySettlement) => {
    setSelected(row); setChoices(null); setUser(''); setVehicle(''); setChoiceError('')
    // Managers may select the real canonical account; names from old files are never treated as IDs.
    const people = await settlementApi.options(tenant.id, '', row.month)
    setChoices(people)
  }, onError: e => setChoiceError(e.message) })
  const save = useMutation({ mutationFn: () => {
    const data = form(); data.set('rowId', selected!.id); data.set('userId', user); data.set('vehicleId', vehicle); data.set('reason', reason)
    return settlementApi.importDraft(tenant.id, data)
  }, onSuccess: onImported })
  return <section className="settlement-import" aria-label="Excel-import előnézete">
    <div className="org-form-grid"><label className="org-field"><span>Régi XLSX vagy ZIP</span><input type="file" accept=".xlsx,.zip" onChange={e => { setFile(e.target.files?.[0] ?? null); setSelected(null); preview.reset() }} /></label>
      <label className="org-field"><span>Importálandó év</span><input type="number" min="1900" max="2100" value={year} onChange={e => { setYear(Number(e.target.value)); setSelected(null); preview.reset() }} /></label></div>
    <Button className="secondary-button" disabled={!file || preview.isPending} onClick={() => { setSelected(null); preview.mutate() }}>{preview.isPending ? 'Ellenőrzés…' : 'Fájl ellenőrzése'}</Button>
    {preview.error && <p role="alert" className="form-error">{preview.error.message}</p>}
    {preview.data && <><label className="org-field"><span>Átveendő havi sor ({preview.data.length})</span><Select value={selected?.id ?? ''} onChange={e => { const row = preview.data.find(x => x.id === e.target.value); if (row) select.mutate(row) }}>
      <option value="">Válassz egy forrást</option>{preview.data.map(row => <option key={row.id} value={row.id}>{row.registration} · {row.month.slice(0, 7)} · {row.employee ?? 'Nincs használó'} · {row.fileName.split('/').at(-1)}</option>)}</Select></label>
      {preview.data.length === 0 && <p className="field-hint">Ebben az évben nincs felismerhető, kitöltött havi elszámolás.</p>}</>}
    {choiceError && <p role="alert" className="form-error">{choiceError}</p>}
    {selected && <><p>Excel szerinti díj: {selected.originalAmount == null ? 'Hiányzik' : moneyText(selected.originalAmount, 'HUF')}</p>
      {selected.warnings.length > 0 && <ul className="notice error">{selected.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      {choices && <form onSubmit={e => { e.preventDefault(); save.mutate() }}>
        <div className="org-form-grid"><label className="org-field"><span>HERMES-felhasználó</span><Select value={user} onChange={e => setUser(e.target.value)}><option value="">Válassz felhasználót</option>{choices.people.map(p => <option key={p.id} value={p.id}>{p.name} · @{p.id}</option>)}</Select></label>
          <label className="org-field"><span>HERMES-jármű</span><Select value={vehicle} onChange={e => setVehicle(e.target.value)}><option value="">Válassz járművet</option>{choices.vehicles.map(v => <option key={v.id} value={v.id}>{v.registration}</option>)}</Select></label></div>
        <label className="org-field"><span>Átvétel indoka / egyeztetés</span><textarea value={reason} onChange={e => setReason(e.target.value)} required maxLength={500} rows={2} /></label>
        <p className="field-hint">Piszkozat készül az eredeti Excel megőrzésével. A tankolásokat, az óraállás-előzményt és a jóváhagyott hónapokat nem írja át.</p>
        {save.error && <p role="alert" className="form-error">{save.error.message}</p>}
        <Button className="primary-button" disabled={!user || !vehicle || save.isPending}>Kiválasztott hónap átvétele piszkozatként</Button>
      </form>}</>}
  </section>
}
