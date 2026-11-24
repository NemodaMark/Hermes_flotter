import { useEffect, useState } from 'react'
import { useIsMutating, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { request } from './api'
import type { Page, Tenant } from './api'
import { AccessDialog } from './AccessDialog'
import { QueryMessage } from './FleetFields'
import { dateText } from './fleetApi'
import { localMileageDate, mileageMonth } from './mileageApi'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import './fleet-events.css'

const endpoint = '/api/v1/vehicles/events'
const repeats = { Once: 'Egyszeri', Day: 'Naponta', Week: 'Hetente', Month: 'Havonta', Year: 'Évente' } as const
const units = { Day: 'nap', Week: 'hét', Month: 'hónap', Year: 'év' } as const
type Repeat = keyof typeof repeats
type Schedule = { vehicleId: string | null; title: string; startsOn: string; repeat: Repeat; every: number;
  endsOn: string | null; notes: string | null; version: number }
type EventRow = Schedule & { id: string; registration: string | null; stoppedOn: string | null; canManage: boolean; occurrences: string[] }
type Target = { id: string; registration: string; make: string; model: string }
type Options = { canScheduleForFleet: boolean; vehicles: Target[]; hasMore: boolean }
const scopeLabel = (event: Pick<EventRow, 'vehicleId' | 'registration'>) => event.vehicleId ? event.registration : 'Minden jármű'

export default function FleetEvents({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const client = useQueryClient()
  const key = ['fleet-events', tenant.id]
  const [month, setMonth] = useState(() => mileageMonth(localMileageDate()))
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<EventRow | 'new' | null>(null)
  const [stopping, setStopping] = useState<EventRow | null>(null)
  const [message, setMessage] = useState('')
  const manage = tenant.permissions.includes('vehicles.events.manage')
  const busy = useIsMutating({ mutationKey: key }) > 0
  const events = useQuery({ queryKey: [...key, 'month', month, page], queryFn: ({ signal }) => request<Page<EventRow>>(`${endpoint}?month=${month}&page=${page}`, { tenantId: tenant.id, signal }), retry: false })
  const stop = useMutation({ mutationKey: key, mutationFn: (row: EventRow) => request<boolean>(`${endpoint}/${row.id}/stop`, { tenantId: tenant.id, body: { version: row.version } }),
    onSuccess: async () => { setStopping(null); setMessage('A jövőbeli előfordulások leállítva.'); await client.invalidateQueries({ queryKey: key }) } })
  const today = localMileageDate()
  const lastPage = events.data ? Math.max(1, Math.ceil(events.data.total / events.data.pageSize)) : 1
  return <AccessDialog title={editing === 'new' ? 'Új esemény' : editing ? 'Esemény szerkesztése' : 'Flottaesemények'} pending={busy}
    onClose={onClose} className="fleet-events-dialog">
    {editing ? <FleetEventForm tenant={tenant} month={month} event={editing === 'new' ? null : editing} onCancel={() => setEditing(null)}
      onSave={async row => {
        if (editing === 'new') { setMonth(mileageMonth(row.startsOn)); setPage(1) }
        setEditing(null); setMessage('Az esemény elmentve.')
        await client.invalidateQueries({ queryKey: key })
      }} /> : <>
      <div className="fleet-events-toolbar">
        <label className="org-field"><span>Események hónapja</span><input type="month" value={month.slice(0, 7)} min="1900-01" max="2100-12" onChange={e => {
          if (!e.target.value || !e.target.validity.valid) return
          setMonth(`${e.target.value}-01`); setPage(1); setStopping(null); setMessage('')
        }} /></label>
        {manage && <Button type="button" className="primary-button" onClick={() => { setEditing('new'); setMessage('') }}><Plus size={17} aria-hidden="true" />Új esemény</Button>}
      </div>
      <QueryMessage pending={events.isPending} error={events.error} retry={() => void events.refetch()} />
      {message && <p role="status" className="notice">{message}</p>}
      {events.data?.items.length === 0 && <p className="notice">Ebben a hónapban nincs ütemezett esemény.</p>}
      {!!events.data?.items.length && <ul className="fleet-events-list">{events.data.items.map(row => <li key={row.id}>
        <div className="fleet-events-item">
          <div><h3>{row.title}</h3>
            <p>{scopeLabel(row)} · {row.every > 1 && row.repeat !== 'Once' ? `Minden ${row.every}. ${units[row.repeat]}` : repeats[row.repeat]}</p>
            {row.notes && <p>{row.notes}</p>}
            <div className="fleet-event-dates">{row.occurrences.map(date => <time dateTime={date} key={date} data-today={date === today}>{dateText(date)}</time>)}</div>
          </div>
          {row.canManage && <div className="fleet-events-actions">
            <Button type="button" variant="secondary" onClick={() => { setEditing(row); setMessage('') }}>Szerkesztés</Button>
            <Button type="button" variant="ghost" onClick={() => { stop.reset(); setStopping(row) }}>Leállítás</Button>
          </div>}
        </div>
        {stopping?.id === row.id && <div role="group" aria-label="Esemény leállítása" className="fleet-event-stop">
          <p>A mai és a későbbi előfordulások kikerülnek a naptárból.</p>
          {stop.error && <p className="form-error" role="alert">{stop.error.message}</p>}
          <div className="fleet-events-actions"><Button type="button" disabled={busy} onClick={() => setStopping(null)}>Mégse</Button>
            <Button type="button" variant="destructive" loading={stop.isPending} onClick={() => stop.mutate(row)}>Esemény leállítása</Button></div>
        </div>}
      </li>)}</ul>}
      {events.data && lastPage > 1 && <div className="fleet-events-toolbar">
        <span>{events.data.page} / {lastPage}. oldal</span>
        <div className="fleet-events-actions">
          <Button type="button" variant="secondary" disabled={events.data.page <= 1} onClick={() => setPage(events.data.page - 1)}>Előző oldal</Button>
          <Button type="button" variant="secondary" disabled={events.data.page >= lastPage} onClick={() => setPage(events.data.page + 1)}>Következő oldal</Button>
        </div>
      </div>}
    </>}
  </AccessDialog>
}

function FleetEventForm({ tenant, month, event, onCancel, onSave }: {
  tenant: Tenant; month: string; event: EventRow | null; onCancel: () => void; onSave: (row: EventRow) => Promise<void>
}) {
  const [vehicle, setVehicle] = useState('')
  const [picked, setPicked] = useState<Target | null>(null)
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [repeat, setRepeat] = useState<Repeat>(event?.repeat ?? 'Once')
  const today = localMileageDate()
  const [startsOn, setStartsOn] = useState(event?.startsOn ?? (mileageMonth(today) === month ? today : month))
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 200)
    return () => window.clearTimeout(timer)
  }, [search])
  const options = useQuery({ queryKey: ['fleet-events', tenant.id, 'targets', term], queryFn: ({ signal }) => request<Options>(
    `${endpoint}/targets?${new URLSearchParams({ search: term })}`, { tenantId: tenant.id, signal }), enabled: !event, retry: false })
  const save = useMutation({ mutationKey: ['fleet-events', tenant.id], mutationFn: (form: FormData) => {
    const schedule: Schedule = { vehicleId: event ? event.vehicleId : vehicle === 'all' ? null : vehicle,
      title: String(form.get('title')), startsOn, repeat, every: repeat === 'Once' ? 1 : Number(form.get('every')),
      endsOn: String(form.get('end') || '') || null, notes: String(form.get('notes') || '') || null, version: event?.version ?? 0 }
    return request<EventRow>(`${endpoint}${event ? `/${event.id}` : ''}`, { tenantId: tenant.id, method: event ? 'PUT' : 'POST', body: schedule })
  }, onSuccess: onSave })
  const targets = options.data?.vehicles ?? []
  return <form className="fleet-event-form" onSubmit={e => { e.preventDefault(); if (event || vehicle) save.mutate(new FormData(e.currentTarget)) }}>
    <fieldset disabled={save.isPending}>
      {event ? <p className="fleet-event-target">{scopeLabel(event)}</p> : <>
        <QueryMessage pending={options.isPending} error={options.error} retry={() => void options.refetch()} />
        {options.data && !targets.length && !options.data.canScheduleForFleet && <p className="field-hint">Nincs kiválasztható jármű.</p>}
        {(options.data?.hasMore || search || term) && <label className="org-field"><span>Jármű keresése rendszám alapján</span>
          <input type="search" value={search} onChange={e => setSearch(e.target.value)} maxLength={200} /></label>}
        <label className="org-field"><span>Érintett jármű</span><Select value={vehicle} required disabled={!options.data} onChange={e => {
          setVehicle(e.target.value); setPicked(targets.find(x => x.id === e.target.value) ?? null)
        }}>
          <option value="">Válassz járművet</option>
          {options.data?.canScheduleForFleet && <option value="all">Minden jármű</option>}
          {(picked && !targets.some(item => item.id === picked.id) ? [picked, ...targets] : targets).map(item =>
            <option key={item.id} value={item.id}>{item.registration} · {item.make} {item.model}</option>)}
        </Select></label>
      </>}
      <label className="org-field"><span>Esemény neve</span><input name="title" required maxLength={120} defaultValue={event?.title} placeholder="Például műszaki vizsga" /></label>
      <div className="org-form-grid">
        <label className="org-field"><span>Első időpont</span><input type="date" value={startsOn} onChange={e => setStartsOn(e.target.value)} required min="1900-01-01" max="2100-12-31" /></label>
        <label className="org-field"><span>Ismétlődés</span><Select value={repeat} onChange={e => setRepeat(e.target.value as Repeat)}>
          {Object.entries(repeats).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </Select></label>
        {repeat !== 'Once' && <>
          <label className="org-field"><span>Időköz ({units[repeat]})</span><input type="number" name="every" inputMode="numeric" min="1" max="999" required defaultValue={event?.every ?? 1} /></label>
          <label className="org-field"><span>Ismétlés vége (opcionális)</span><input type="date" name="end" min={startsOn} max="2100-12-31" defaultValue={event?.endsOn ?? ''} /></label>
        </>}
      </div>
      <label className="org-field"><span>Megjegyzés (opcionális)</span><textarea name="notes" rows={2} maxLength={500} defaultValue={event?.notes ?? ''} /></label>
    </fieldset>
    {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
    <div className="dialog-actions"><Button type="button" variant="secondary" disabled={save.isPending} onClick={onCancel}>Mégse</Button>
      <Button className="primary-button" loading={save.isPending} disabled={!event && (!vehicle || !options.isSuccess)}>Esemény mentése</Button></div>
  </form>
}
