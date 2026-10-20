import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import type { Tenant } from './api'
import { AddressFields, MetadataLine, TextField } from './OrganizationForms'
import { blankAddress } from './organizationApi'
import { PageButtons } from './CompaniesPage'
import { fleetApi } from './fleetApi'
import type { Partner, PartnerInput } from './fleetApi'
import { FleetAudit, NotesField, QueryMessage, ReasonDialog, SelectField } from './FleetFields'
import './fleet.css'

export function PartnersPage({ tenant }: { tenant: Tenant }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const [kind, setKind] = useState('all')
  const [archived, setArchived] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const can = (code: string) => tenant.permissions.includes(code)
  const rows = useQuery({ queryKey: ['fleet-management', tenant.id, 'partners', page, search, kind, archived],
    queryFn: ({ signal }) => fleetApi.partners(tenant.id, page, search, kind, archived, signal), enabled: can('partners.read') && selected === null, retry: false })
  if (selected !== null) return <PartnerWorkspace key={selected} tenant={tenant} id={selected === 'new' ? null : selected} onBack={() => setSelected(null)} />
  return <section className="access-panel" aria-label="Partnerek kezelése">
    <div className="org-toolbar"><div><h2>Lízingbeadók és szervizek</h2><p>{tenant.name}</p></div><div className="member-actions">
      {can('partners.read') && <button className="icon-button" aria-label="Partnerlista frissítése" onClick={() => void rows.refetch()} disabled={rows.isFetching}><RefreshCw size={17} /></button>}
      {can('partners.create') && <button className="primary-button" onClick={() => setSelected('new')}><Plus size={17} />Új partner</button>}
    </div></div>
    {!can('partners.read') ? <p className="notice">Nincs jogosultságod a partnerlista megtekintéséhez.</p> : <>
      <form className="access-search system-user-search fleet-partner-search" onSubmit={e => { e.preventDefault(); setSearch(draft.trim()); setPage(1) }}>
        <input className="system-search" aria-label="Partner keresése" placeholder="Partner neve vagy település" value={draft} maxLength={100} onChange={e => setDraft(e.target.value)} />
        <SelectField label="Kategória" value={kind} options={{ all: 'Minden partner', lessor: 'Lízingbeadó', service: 'Szerviz' }} onChange={x => { setKind(x); setPage(1) }} />
        <label className="org-checkbox"><input type="checkbox" checked={archived} onChange={e => { setArchived(e.target.checked); setPage(1) }} />Archiváltak is</label>
        <button className="secondary-button">Keresés</button>
      </form>
      <QueryMessage pending={rows.isPending} error={rows.error} retry={() => void rows.refetch()} />
      {rows.data && <><div className="table-scroll"><table className="org-table"><thead><tr><th>Partner</th><th>Kategória</th><th>Elérhetőség</th><th>Állapot</th><th>Művelet</th></tr></thead><tbody>
        {rows.data.items.map(p => <tr key={p.id}><td><strong>{p.data.name}</strong><span className="member-email">{p.data.address.city}</span></td><td>{[p.data.isLessor && 'Lízingbeadó', p.data.isService && 'Szerviz'].filter(Boolean).join(' · ')}</td>
          <td>{p.data.email ?? '–'}<span className="member-email">{p.data.phone}</span></td><td>{p.isArchived ? 'Archivált' : 'Aktív'}</td>
          <td><button className="secondary-button" aria-label={`Partner megnyitása: ${p.data.name}`} onClick={() => setSelected(p.id)}>Megnyitás</button></td></tr>)}
        {!rows.data.total && <tr><td colSpan={5}>Még nincs ilyen partner. Az Új partner gombbal vehetsz fel lízingbeadót vagy szervizt.</td></tr>}
      </tbody></table></div><PageButtons page={page} total={rows.data.total} pending={rows.isFetching} onPage={setPage} /></>}
    </>}
  </section>
}

function PartnerWorkspace({ tenant, id, onBack }: { tenant: Tenant; id: string | null; onBack: () => void }) {
  const client = useQueryClient()
  const [tab, setTab] = useState('data')
  const [statusOpen, setStatusOpen] = useState(false)
  const partner = useQuery({ queryKey: ['fleet-management', tenant.id, id, 'partner'], queryFn: ({ signal }) => fleetApi.partner(tenant.id, id!, signal), enabled: id !== null, retry: false })
  const can = (code: string) => tenant.permissions.includes(code)
  async function changed() { await client.invalidateQueries({ queryKey: ['fleet-management', tenant.id] }) }
  return <>
    <button className="text-button org-back" onClick={onBack}><ArrowLeft size={16} />Vissza a partnerekhez</button>
    <section className="access-panel" aria-label="Partneradatlap">
      <div className="org-toolbar"><div><h2>{id === null ? 'Új partner' : partner.data?.data.name ?? 'Partner'}</h2>{partner.data && <p>{partner.data.isArchived ? 'Archivált' : 'Aktív'}{partner.data.statusReason ? ` · ${partner.data.statusReason}` : ''}</p>}</div><div className="member-actions">
        {id && <button className="icon-button" aria-label="Partneradatlap frissítése" onClick={() => void partner.refetch()}><RefreshCw size={17} /></button>}
        {partner.data && can('partners.archive') && <button className="secondary-button" onClick={() => setStatusOpen(true)}>{partner.data.isArchived ? 'Visszaállítás' : 'Archiválás'}</button>}
      </div></div>
      {id && can('audit.read') && <div className="access-tabs org-tabs"><button aria-pressed={tab === 'data'} onClick={() => setTab('data')}>Partneradatok</button><button aria-pressed={tab === 'audit'} onClick={() => setTab('audit')}>Módosítási napló</button></div>}
      {id && <QueryMessage pending={partner.isPending} error={partner.error} retry={() => void partner.refetch()} />}
      {(id === null || partner.data) && (tab === 'audit' && id ? <FleetAudit tenantId={tenant.id} id={id} vehicle={false} /> : <PartnerForm key={`${id}:${partner.data?.data.version ?? 0}`} tenantId={tenant.id} partner={partner.data}
        editable={id === null ? can('partners.create') : can('partners.update') && !partner.data?.isArchived}
        onSaved={async () => { await changed(); if (id === null) onBack() }} />)}
    </section>
    {statusOpen && partner.data && <ReasonDialog title={partner.data.isArchived ? 'Partner visszaállítása' : 'Partner archiválása'} onClose={() => setStatusOpen(false)} onSave={async reason => { await fleetApi.partnerStatus(tenant.id, partner.data!, reason); await changed() }} />}
  </>
}
export function PartnerForm({ tenantId, partner, editable, onSaved }: { tenantId: string; partner?: Partner; editable: boolean; onSaved: () => Promise<void> }) {
  const [data, setData] = useState<PartnerInput>(partner?.data ?? { name: '', isLessor: false, isService: true, address: blankAddress(), email: '', phone: '', website: '', notes: '', contacts: [], version: 0 })
  const [saved, setSaved] = useState(false)
  const save = useMutation({ mutationFn: () => fleetApi.savePartner(tenantId, partner?.id ?? null, data), onSuccess: async () => { setSaved(true); await onSaved() } })
  const disabled = !editable || save.isPending
  const text = (key: 'name' | 'email' | 'phone' | 'website', label: string, maxLength = 200, type = 'text', required = false) => <TextField label={label} value={data[key]} onChange={x => setData({ ...data, [key]: x })} maxLength={maxLength} type={type} required={required} disabled={disabled} />
  return <form className="org-form" onSubmit={e => { e.preventDefault(); setSaved(false); save.mutate() }}>
    <fieldset disabled={disabled}><legend>Partneradatok</legend><div className="org-form-grid">{text('name', 'Partner neve', 200, 'text', true)}
      <div className="fleet-partner-categories"><span>Kategória (több is választható)</span><label className="org-checkbox"><input type="checkbox" checked={data.isLessor} onChange={e => setData({ ...data, isLessor: e.target.checked })} />Lízingbeadó / finanszírozó</label>
        <label className="org-checkbox"><input type="checkbox" checked={data.isService} onChange={e => setData({ ...data, isService: e.target.checked })} />Szerviz</label></div>
      {text('email', 'E-mail-cím', 254, 'email')}{text('phone', 'Telefonszám', 40)}{text('website', 'Weboldal', 2048, 'url')}
    </div></fieldset>
    <fieldset disabled={disabled}><legend>Cím</legend><AddressFields value={data.address} onChange={x => setData({ ...data, address: x })} disabled={disabled} /></fieldset>
    <fieldset disabled={disabled}><legend>Kapcsolattartók</legend>
      {data.contacts.map((c, index) => <div className="fleet-contact-row" key={index}><div className="org-form-grid">
        {([['name', 'Név', 120, 'text'], ['position', 'Beosztás', 80, 'text'], ['email', 'E-mail-cím', 254, 'email'], ['phone', 'Telefonszám', 40, 'text']] as const).map(([key, label, maxLength, type]) => <TextField key={key} label={label} value={c[key]} maxLength={maxLength} type={type} required={key === 'name'} disabled={disabled}
          onChange={value => setData({ ...data, contacts: data.contacts.map((old, i) => i === index ? { ...old, [key]: value } : old) })} />)}
      </div>{editable && <button type="button" className="text-button" onClick={() => setData({ ...data, contacts: data.contacts.filter((_, i) => i !== index) })}>Kapcsolattartó eltávolítása</button>}</div>)}
      {!data.contacts.length && !editable && <p className="field-hint">Nincs megadott kapcsolattartó.</p>}
      {editable && <button type="button" className="secondary-button" disabled={disabled || data.contacts.length >= 20} onClick={() => setData({ ...data, contacts: [...data.contacts, { name: '', position: '', email: '', phone: '' }] })}>Kapcsolattartó hozzáadása</button>}
    </fieldset>
    <NotesField value={data.notes} onChange={x => setData({ ...data, notes: x })} disabled={disabled} />
    {save.error && <p className="notice error" role="alert">{save.error.message}</p>}{saved && <p role="status">A partner adatai elmentve.</p>}
    <div className="org-form-footer"><MetadataLine version={data.version} updatedAt={partner?.updatedAt ?? null} updatedBy={partner?.updatedBy ?? null} />{editable && <button className="primary-button" disabled={save.isPending}>Partner mentése</button>}</div>
  </form>
}
