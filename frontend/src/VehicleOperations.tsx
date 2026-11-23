import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { request } from './api'
import type { Page, Tenant, Vehicle } from './api'
import { CurrencyField, NotesField, QueryMessage, ReasonDialog } from './FleetFields'
import { dateText, moneyText } from './fleetApi'
import { mediaApi } from './peopleApi'
import { ProtectedImage } from './ProtectedImage'
import { PageButtons } from './CompaniesPage'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Toggle } from './ui/Toggle'
import { AccessDialog } from './AccessDialog'
import { FileInput } from './ui/FileInput'
import { VehicleDetailGroup } from './VehicleDetailGroup'
import { MileageCaptureFields } from './MileageCapture'
import { useMileageCapture } from './useMileageCapture'
import './vehicle-operations.css'

type OperationProps = { tenant: Tenant; car: Vehicle }
type Booking = { id: string; userId: string; name: string; startsOn: string; endsOn: string }
type Calendar = { enabled: boolean; today: string; items: Booking[] }
type FuelEntry = { id: string; fueledOn: string; kilometers: number; liters: number; amount: number; currency: string; hasReceipt: boolean; isVoided: boolean;
  receiptNumber: string | null; isFullTank: boolean; version: number; recordedBy: string | null; updatedBy: string | null; updatedAt: string | null; litersPer100Km: number | null }
type FuelMonth = { items: FuelEntry[]; totals: { currency: string; amount: number; liters: number }[]; litersPer100Km: number | null; measuredKilometers: number }
type Handover = { id: string; previousUserId: string | null; nextUserId: string | null; recordedBy: string; recordedAt: string; kilometers: number; condition: string; notes: string | null; hasPhoto: boolean }
type Appointment = { startsAt: string; notes: string | null }

const path = (id: string) => `/api/v1/vehicles/${id}`
const allows = (p: OperationProps, code: string) => (p.car.permissions ?? p.tenant.permissions).includes(code)
const editable = (p: OperationProps, code: string) => p.car.status !== 'Archived' && allows(p, code)
const localDateTime = (value = new Date()) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const monthStart = () => localDateTime().slice(0, 7) + '-01'
const dateAtUtc = (date: string) => new Date(`${date}T12:00:00Z`)
const isoDate = (date: Date) => date.toISOString().slice(0, 10)
const formatNumber = (value: number) => value.toLocaleString('hu-HU')
const formatTime = (value: string) => new Date(value).toLocaleString('hu-HU')
const fileTypes = 'image/jpeg,image/png'

function payload(data: object, file?: File) {
  if (!file) return data
  const form = new FormData()
  form.append('data', JSON.stringify(data))
  form.append('file', file)
  return form
}

function moveMonth(month: string, offset: number) {
  const date = dateAtUtc(month)
  date.setUTCMonth(date.getUTCMonth() + offset)
  return isoDate(date)
}

export function VehicleBookingCalendar(p: OperationProps & { userId: string; onChanged: () => Promise<void> }) {
  const [month, setMonth] = useState(monthStart)
  const [startsOn, setStart] = useState('')
  const [endsOn, setEnd] = useState('')
  const [cancel, setCancel] = useState<Booking | null>(null)
  const client = useQueryClient()
  const tenantId = p.tenant.id
  const url = path(p.car.id)
  const key = ['fleet-management', tenantId, p.car.id, 'bookings']
  const canRead = allows(p, 'vehicles.bookings.read')
  const canManage = editable(p, 'vehicles.bookings.manage')
  const canCancelOwn = editable(p, 'vehicles.bookings.create')
  const canBook = p.car.status === 'Active' && canCancelOwn
  const calendar = useQuery({ queryKey: [...key, month], queryFn: ({ signal }) => request<Calendar>(`${url}/bookings?month=${month}`, { tenantId, signal }), enabled: canRead, retry: false })
  const setting = useQuery({ queryKey: [...key, 'setting'], queryFn: ({ signal }) => request<boolean>(`${url}/booking-settings`, { tenantId, signal }), enabled: canManage && !canRead, retry: false })
  const refresh = p.onChanged
  const settings = useMutation({ mutationFn: (enabled: boolean) => request(`${url}/booking-settings`, { tenantId, method: 'PUT', body: { enabled } }), onSuccess: refresh })
  const create = useMutation({ mutationFn: () => request(`${url}/bookings`, { tenantId, body: { startsOn, endsOn } }),
    onSuccess: async () => { setMonth(startsOn.slice(0, 7) + '-01'); setStart(''); setEnd(''); await refresh() },
    onError: () => client.invalidateQueries({ queryKey: key }) })
  const remove = useMutation({ mutationFn: (item: Booking) => request(`${url}/bookings/${item.id}?manage=${canManage}`, { tenantId, method: 'DELETE' }),
    onSuccess: async () => { setCancel(null); await refresh() } })
  const first = dateAtUtc(month)
  const offset = (first.getUTCDay() + 6) % 7
  const count = (dateAtUtc(moveMonth(month, 1)).getTime() - first.getTime()) / 86400000
  const items = calendar.data?.items ?? []
  const enabled = calendar.data?.enabled ?? setting.data
  const today = calendar.data?.today ?? localDateTime().slice(0, 10)
  const maxEnd = startsOn ? isoDate(new Date(dateAtUtc(startsOn).getTime() + 6 * 86400000)) : undefined
  function selectDay(day: string) {
    if (!startsOn || endsOn !== startsOn || day < startsOn || (maxEnd && day > maxEnd)) {
      setStart(day); setEnd(day)
    } else setEnd(day)
  }

  const monthControl = <div className="vehicle-month-control">
    <Button type="button" className="icon-button" aria-label="Előző hónap" onClick={() => setMonth(moveMonth(month, -1))}><ChevronLeft size={18} /></Button>
    <strong aria-live="polite">{first.toLocaleDateString('hu-HU', { year: 'numeric', month: 'long', timeZone: 'UTC' })}</strong>
    <Button type="button" className="icon-button" aria-label="Következő hónap" onClick={() => setMonth(moveMonth(month, 1))}><ChevronRight size={18} /></Button>
  </div>

  return <section className="org-form vehicle-operation" aria-label="Járműfoglalás">
    <div className="vehicle-operation-toolbar"><h3>Foglalási naptár</h3>
      {canManage && enabled !== undefined && <Toggle checked={enabled} disabled={settings.isPending} onChange={value => settings.mutate(value)}>Foglalható</Toggle>}
    </div>
    <QueryMessage pending={canRead ? calendar.isPending : setting.isPending} error={canRead ? calendar.error : setting.error} retry={() => void (canRead ? calendar.refetch() : setting.refetch())} />
    {settings.error && <p role="alert" className="form-error">{settings.error.message}</p>}
    {canRead && <>
      {enabled === false && <p className="fleet-detail-caption">A jármű foglalása ki van kapcsolva.</p>}
      {enabled === false && <VehicleDetailGroup title="Korábbi foglalások hónapja">{monthControl}</VehicleDetailGroup>}
      {enabled && <>{monthControl}
      <div className="vehicle-calendar" aria-label="Napok">
        {['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'].map(day => <span key={day} className="vehicle-calendar-weekday">{day}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={`empty-${i}`} aria-hidden="true" />)}
        {Array.from({ length: count }, (_, i) => {
          const day = month.slice(0, 8) + String(i + 1).padStart(2, '0')
          const booking = items.find(x => x.startsOn <= day && x.endsOn >= day)
          const selected = startsOn <= day && day <= endsOn
          const label = booking ? `${dateText(day)}, foglalt: ${booking.name}` : dateText(day)
          const className = `vehicle-calendar-day${booking ? ' booked' : ''}${selected ? ' selected' : ''}`
          return canBook && enabled && !booking && day >= today
            ? <Button type="button" key={day} className={className} aria-label={label} aria-pressed={selected} onClick={() => selectDay(day)}>{i + 1}</Button>
            : <span key={day} className={className} aria-label={label}><span>{i + 1}</span>{booking && <small>{booking.name}</small>}</span>
        })}
      </div>
      </>}
      {items.length > 0 && <ul className="vehicle-operation-list" aria-label="Havi foglalások">{items.map(item => <li key={item.id}>
        <div><strong>{item.name}</strong><span>{dateText(item.startsOn)} – {dateText(item.endsOn)}</span></div>
        {p.car.status !== 'Archived' && item.endsOn >= today && (canManage || item.userId === p.userId && canCancelOwn) &&
          <Button className="secondary-button" onClick={() => { remove.reset(); setCancel(item) }}>Lemondás</Button>}
      </li>)}</ul>}
      {cancel && <div className="notice" role="group" aria-label="Foglalás lemondása">
        <p>{cancel.name} · {dateText(cancel.startsOn)} – {dateText(cancel.endsOn)}</p>
        <div className="member-actions"><Button className="secondary-button" disabled={remove.isPending} onClick={() => setCancel(null)}>Mégse</Button>
          <Button className="primary-button" disabled={remove.isPending} onClick={() => remove.mutate(cancel)}>Foglalás lemondása</Button></div>
        {remove.error && <p role="alert" className="form-error">{remove.error.message}</p>}
      </div>}
    </>}
    {canBook && enabled && <form className="operation-form" onSubmit={event => { event.preventDefault(); create.mutate() }}>
      <h4>Új foglalás</h4>
      <div className="org-form-grid">
        <label className="org-field"><span>Kezdőnap</span><input type="date" value={startsOn} min={today} required onChange={event => {
          const date = event.target.value
          setStart(date)
          if (!date || endsOn < date || dateAtUtc(endsOn).getTime() - dateAtUtc(date).getTime() > 6 * 86400000) setEnd(date)
        }} /></label>
        <label className="org-field"><span>Utolsó nap</span><input type="date" value={endsOn} min={startsOn || today} max={maxEnd} required onChange={e => setEnd(e.target.value)} /></label>
      </div>
      <p className="fleet-detail-caption">Legfeljebb 7 naptári nap.</p>
      {create.error && <p role="alert" className="form-error">{create.error.message}</p>}
      <Button className="primary-button" disabled={create.isPending || !startsOn || !endsOn}>Foglalás</Button>
    </form>}
  </section>
}

export function VehicleFuelDialog(p: OperationProps & { userId: string; item?: FuelEntry; cinematic?: boolean; onSaved: (row: FuelEntry) => void; onClose: () => void }) {
  const [pending, setPending] = useState(false)
  return <AccessDialog title={p.item ? 'Tankolás módosítása' : 'Tankolás rögzítése'} pending={pending} onClose={p.onClose} className={`recording-dialog fuel-record-dialog${p.cinematic ? ' garage-operation-dialog' : ''}`}>
    <p className="access-description">{p.car.registration} · {p.tenant.name}</p>
    <VehicleFuelForm {...p} onPendingChange={setPending} />
  </AccessDialog>
}

export function VehicleFuelForm(p: OperationProps & { userId: string; item?: FuelEntry; onSaved: (row: FuelEntry) => void; onPendingChange?: (pending: boolean) => void }) {
  const client = useQueryClient()
  const { onPendingChange } = p
  const [currency, setCurrency] = useState(p.item?.currency ?? 'HUF')
  const [date, setDate] = useState(p.item?.fueledOn ?? localDateTime().slice(0, 10))
  const capture = useMileageCapture(p.tenant, p.userId, date, !p.item)
  const save = useMutation({ mutationFn: (form: FormData) => {
    const data = {
      fueledOn: String(form.get('date')), kilometers: Number(form.get('km')), liters: Number(form.get('liters')),
      amount: Number(form.get('amount')), currency, receiptNumber: String(form.get('receiptNumber')), isFullTank: form.get('fullTank') === 'on',
      usage: capture.usage(),
    }
    return p.item ? request<FuelEntry>(`${path(p.car.id)}/fuel/${p.item.id}`, { tenantId: p.tenant.id, method: 'PUT', body: { data, version: p.item.version, reason: String(form.get('reason')) } })
      : request<FuelEntry>(`${path(p.car.id)}/fuel`, { tenantId: p.tenant.id, body: payload(data, uploadedFile(form)) })
  }, onSuccess: async row => {
    await Promise.all([client.invalidateQueries({ queryKey: ['fleet-management', p.tenant.id, p.car.id] }), client.invalidateQueries({ queryKey: ['mileage', p.tenant.id] }), client.invalidateQueries({ queryKey: ['dashboard'] })])
    p.onSaved(row)
  } })
  useEffect(() => { onPendingChange?.(save.isPending) }, [onPendingChange, save.isPending])
  if (!editable(p, 'vehicles.fuel.manage')) return null
  return <form className="operation-form" aria-label={p.item ? 'Tankolás módosítása' : 'Tankolás rögzítése'} onSubmit={e => { e.preventDefault(); if (capture.ready) save.mutate(new FormData(e.currentTarget)) }}>
    <fieldset disabled={save.isPending}>
      <legend className="sr-only">Tankolás adatai</legend>
      <div className="org-form-grid">
        <label className="org-field"><span>Bizonylatszám</span><input name="receiptNumber" defaultValue={p.item?.receiptNumber ?? ''} maxLength={100} required data-autofocus /></label>
        <label className="org-field"><span>Tankolás napja</span><input name="date" type="date" value={date} onChange={e => setDate(e.target.value)} max={localDateTime().slice(0, 10)} required /></label>
        <label className="org-field"><span>Kilométerállás</span><input name="km" type="number" inputMode="numeric" defaultValue={p.item?.kilometers ?? p.car.odometerKm ?? ''} min={0} max={100000000} required /></label>
        <label className="org-field"><span>Liter</span><input name="liters" type="number" inputMode="decimal" defaultValue={p.item?.liters} step="0.001" min="0.001" max="999999" required /></label>
        <label className="org-field"><span>Összeg</span><input name="amount" type="number" inputMode="decimal" defaultValue={p.item?.amount} step="0.01" min="0" max="999999999999.99" required /></label>
        <CurrencyField value={currency} onChange={setCurrency} />
        {!p.item && <FileInput label="Nyugtafotó (JPG, PNG)" name="file" accept={fileTypes} />}
      </div>
      <label className="checkbox-label"><input type="checkbox" name="fullTank" defaultChecked={p.item?.isFullTank ?? false} />Teletankoltam</label>
      <MileageCaptureFields capture={capture} />
      {p.item && <p className="field-hint">A megtett utat és a magánhasználatot a havi km-elszámolásban külön javíthatod. Az eredeti bizonylat megmarad.</p>}
      {p.item && <label className="org-field"><span>Módosítás indoka</span><textarea name="reason" rows={2} maxLength={500} required /></label>}
    </fieldset>
    {save.error && <p role="alert" className="form-error">{save.error.message}</p>}
    <div className="dialog-actions"><Button className="primary-button" disabled={!capture.ready} loading={save.isPending}>Tankolás mentése</Button></div>
  </form>
}

export function VehicleFuel(p: OperationProps & { userId: string; showCreate?: boolean }) {
  const tenantId = p.tenant.id
  const url = path(p.car.id)
  const client = useQueryClient()
  const [month, setMonth] = useState(monthStart)
  const [open, setOpen] = useState(false)
  const [voidItem, setVoidItem] = useState<FuelEntry | null>(null)
  const [editItem, setEditItem] = useState<FuelEntry | null>(null)
  const [image, setImage] = useState('')
  const key = ['fleet-management', tenantId, p.car.id, 'fuel']
  const read = allows(p, 'vehicles.fuel.read')
  const manage = editable(p, 'vehicles.fuel.manage')
  const data = useQuery({ queryKey: [...key, month], queryFn: ({ signal }) => request<FuelMonth>(`${url}/fuel?month=${month}`, { tenantId, signal }), enabled: read, retry: false })
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const exportMonth = useMutation({ mutationFn: async () => {
    const blob = await request<Blob>(`${url}/fuel/export?month=${month}`, { tenantId, responseType: 'blob' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `tankolas-${month.slice(0, 7)}.csv`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(href), 1000)
  } })
  return <section className="org-form vehicle-operation" aria-label="Tankolás">
    <div className="vehicle-operation-toolbar"><h3>Tankolások</h3>
      <div className="member-actions">
        {read && <input className="operation-month-input" aria-label="Elszámolás hónapja" type="month" min="1900-01" max="2100-12" value={month.slice(0, 7)} onChange={e => { if (e.target.value) setMonth(e.target.value + '-01') }} />}
        {read && <Button className="secondary-button" disabled={exportMonth.isPending || !data.data?.totals.length} onClick={() => exportMonth.mutate()}><Download size={15} />CSV</Button>}
        {manage && p.showCreate !== false && <Button className="primary-button" onClick={() => setOpen(!open)}>{open ? 'Mégse' : 'Tankolás rögzítése'}</Button>}
      </div>
    </div>
    {exportMonth.error && <p role="alert" className="form-error">{exportMonth.error.message}</p>}
    {manage && open && <VehicleFuelForm {...p} onSaved={row => { setMonth(row.fueledOn.slice(0, 7) + '-01'); setOpen(false) }} />}
    {editItem && <VehicleFuelDialog {...p} item={editItem} onClose={() => setEditItem(null)} onSaved={row => { setMonth(row.fueledOn.slice(0, 7) + '-01'); setEditItem(null) }} />}
    {read && <>
      <QueryMessage pending={data.isPending} error={data.error} retry={() => void data.refetch()} />
      {data.data?.totals.length ? <p className="fleet-detail-caption">Havi összesen · {data.data.totals.map(x => `${formatNumber(x.liters)} l · ${moneyText(x.amount, x.currency)}`).join(' / ')}</p> : null}
      {data.data && (data.data.litersPer100Km != null ? <p className="fleet-detail-caption"><strong>{formatNumber(data.data.litersPer100Km)} l/100 km</strong> · {formatNumber(data.data.measuredKilometers)} km, teletankok közötti mérés</p>
        : <p className="field-hint">Átlagfogyasztáshoz két teletankos rögzítés és növekvő kilométerállás szükséges.</p>)}
      {data.data && (data.data.items.length ? <ul className="vehicle-operation-list">{data.data.items.map(row => <li key={row.id}>
        <div><strong>{dateText(row.fueledOn)} · {moneyText(row.amount, row.currency)}</strong><span>{formatNumber(row.kilometers)} km · {formatNumber(row.liters)} l{row.isVoided ? ' · Érvénytelenítve' : ''}</span>
          {row.receiptNumber && <span>Bizonylat: {row.receiptNumber}</span>}
          {row.litersPer100Km != null && <span>{formatNumber(row.litersPer100Km)} l/100 km</span>}
          {(row.updatedBy || row.recordedBy) && <small>{row.updatedBy ? `Módosította: ${row.updatedBy}` : `Rögzítette: ${row.recordedBy}`}</small>}
          {image === row.id && <ProtectedImage path={`${url}/fuel/${row.id}/receipt`} tenantId={tenantId} revision={row.id} alt="Tankolási nyugta" className="operation-image" />}</div>
        <div className="member-actions">{row.hasReceipt && <Button className="secondary-button" onClick={() => setImage(image === row.id ? '' : row.id)}>Nyugta</Button>}
          {manage && !row.isVoided && <><Button className="secondary-button" onClick={() => setEditItem(row)}>Módosítás</Button><Button className="secondary-button" onClick={() => setVoidItem(row)}>Érvénytelenítés</Button></>}</div>
      </li>)}</ul> : <p className="notice">Ebben a hónapban nincs tankolás.</p>)}
    </>}
    {voidItem && <ReasonDialog title="Tankolás érvénytelenítése" onClose={() => setVoidItem(null)} onSave={async reason => {
      await request(`${url}/fuel/${voidItem.id}/void`, { tenantId, body: { reason } }); await refresh()
    }} />}
  </section>
}

function uploadedFile(form: FormData) {
  const file = form.get('file')
  return file instanceof File && file.size > 0 ? file : undefined
}

export function VehicleHandovers(p: OperationProps & { onChanged: () => Promise<void> }) {
  const tenantId = p.tenant.id
  const url = path(p.car.id)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [image, setImage] = useState('')
  const [userId, setUserId] = useState('')
  const manage = editable(p, 'vehicles.users.assign') && allows(p, 'vehicles.odometer.create')
  const rows = useQuery({ queryKey: ['fleet-management', tenantId, p.car.id, 'handovers', page], queryFn: ({ signal }) => request<Page<Handover>>(`${url}/handovers?page=${page}`, { tenantId, signal }), retry: false })
  const options = useQuery({ queryKey: ['handover-options', tenantId, p.car.id], queryFn: ({ signal }) => mediaApi.assigneeOptions(tenantId, p.car.id, signal), enabled: open && manage, retry: false })
  const save = useMutation({ mutationFn: (form: FormData) => request(`${url}/handovers`, { tenantId, body: payload({
    userId: userId || null, kilometers: Number(form.get('km')), condition: String(form.get('condition')), notes: String(form.get('notes')), version: p.car.version,
  }, uploadedFile(form)) }), onSuccess: async () => { setOpen(false); setUserId(''); setPage(1); await p.onChanged() } })
  return <section className="org-form vehicle-operation" aria-label="Átadás-átvétel">
    <div className="vehicle-operation-toolbar"><h3>Átadás-átvétel</h3>
      {manage && <Button className="primary-button" onClick={() => { save.reset(); setOpen(!open) }}>{open ? 'Mégse' : 'Átadás rögzítése'}</Button>}</div>
    {manage && open && <form className="operation-form" onSubmit={e => { e.preventDefault(); save.mutate(new FormData(e.currentTarget)) }}>
      <QueryMessage pending={options.isPending} error={options.error} retry={() => void options.refetch()} />
      <div className="org-form-grid">
        <label className="org-field"><span>Átvevő</span><Select value={userId} disabled={options.isPending} onChange={e => setUserId(e.target.value)}>
          <option value="">Visszavétel a flottába</option>{options.data?.map(person => <option value={person.id} key={person.id}>{person.displayName ?? person.id}</option>)}
        </Select></label>
        <label className="org-field"><span>Kilométerállás</span><input name="km" type="number" min={p.car.odometerKm ?? 0} max={100000000} defaultValue={p.car.odometerKm ?? ''} required /></label>
        <label className="org-field"><span>Állapot</span><input name="condition" required maxLength={200} /></label>
        <label className="org-field"><span>Állapotfotó (JPG, PNG)</span><input name="file" type="file" accept={fileTypes} /></label>
        <label className="org-field org-span-2"><span>Megjegyzés</span><textarea name="notes" maxLength={1000} rows={2} /></label>
      </div>
      {save.error && <p role="alert" className="form-error">{save.error.message}</p>}
      <Button className="primary-button" disabled={save.isPending || options.isPending}>Átadás mentése</Button>
    </form>}
    <QueryMessage pending={rows.isPending} error={rows.error} retry={() => void rows.refetch()} />
    {rows.data && <>{rows.data.items.length ? <ul className="vehicle-operation-list">{rows.data.items.map(row => <li key={row.id}>
      <div><strong>{row.previousUserId ?? 'Flotta'} → {row.nextUserId ?? 'Flotta'}</strong>
        <span>{formatTime(row.recordedAt)} · {formatNumber(row.kilometers)} km · Rögzítette: {row.recordedBy}</span>
        <span>{row.condition}</span>{row.notes && <span>{row.notes}</span>}
        {image === row.id && <ProtectedImage path={`${url}/handovers/${row.id}/photo`} tenantId={tenantId} revision={row.id} alt="Átadáskori állapotfotó" className="operation-image" />}</div>
      {row.hasPhoto && <Button className="secondary-button" onClick={() => setImage(image === row.id ? '' : row.id)}>Fotó</Button>}
    </li>)}</ul> : <p className="notice">Még nincs átadási jegyzőkönyv.</p>}
    {rows.data.total > 0 && <PageButtons page={page} total={rows.data.total} pending={rows.isFetching} onPage={setPage} />}</>}
  </section>
}

export function VehicleAppointment(p: OperationProps) {
  const tenantId = p.tenant.id
  const url = `${path(p.car.id)}/service-appointment`
  const client = useQueryClient()
  const [draft, setDraft] = useState<{ startsAt: string; notes: string } | null>(null)
  const read = allows(p, 'vehicles.service.read')
  const manage = editable(p, 'vehicles.service.manage')
  const key = ['fleet-management', tenantId, p.car.id, 'service-appointment']
  const data = useQuery({ queryKey: key, queryFn: ({ signal }) => request<{ appointment: Appointment | null }>(url, { tenantId, signal }), enabled: read, retry: false })
  const save = useMutation({ mutationFn: (value?: typeof draft) => request(url, {
    tenantId, method: value ? 'PUT' : 'DELETE',
    body: value ? { startsAt: new Date(value.startsAt).toISOString(), notes: value.notes } : undefined,
  }), onSuccess: async () => { setDraft(null); await client.invalidateQueries({ queryKey: key }) } })
  const appointment = data.data?.appointment
  return <section className="org-form vehicle-operation vehicle-appointment" aria-label="Egyeztetett szervizidőpont">
    <div className="vehicle-operation-toolbar"><h3>Egyeztetett időpont</h3>
      {manage && !draft && <Button className="secondary-button" onClick={() => {
        save.reset(); setDraft({ startsAt: appointment ? localDateTime(new Date(appointment.startsAt)) : '', notes: appointment?.notes ?? '' })
      }}>{appointment ? 'Időpont módosítása' : 'Időpont rögzítése'}</Button>}</div>
    {read && <QueryMessage pending={data.isPending} error={data.error} retry={() => void data.refetch()} />}
    {!draft && (appointment ? <div className="operation-appointment-detail"><strong>{formatTime(appointment.startsAt)}</strong>
      {appointment.notes && <span>{appointment.notes}</span>}{manage && <Button className="secondary-button" disabled={save.isPending} onClick={() => save.mutate(null)}>Időpont törlése</Button>}</div>
      : data.data && <p className="fleet-detail-caption">Nincs egyeztetett időpont.</p>)}
    {draft && <form className="operation-form" onSubmit={e => { e.preventDefault(); save.mutate(draft) }}>
      <div className="org-form-grid"><label className="org-field"><span>Időpont (az eszköz időzónájában)</span>
        <input type="datetime-local" value={draft.startsAt} onChange={e => setDraft({ ...draft, startsAt: e.target.value })} required /></label>
      <NotesField label="Megjegyzés" value={draft.notes} onChange={notes => setDraft({ ...draft, notes: notes ?? '' })} maxLength={500} /></div>
      <div className="member-actions"><Button type="button" className="secondary-button" disabled={save.isPending} onClick={() => setDraft(null)}>Mégse</Button>
        <Button className="primary-button" disabled={save.isPending}>Időpont mentése</Button></div>
    </form>}
    {save.error && <p role="alert" className="form-error">{save.error.message}</p>}
  </section>
}
