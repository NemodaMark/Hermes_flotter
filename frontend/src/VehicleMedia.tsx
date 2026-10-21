import { Button } from './ui/Button'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Trash2, UserRound } from 'lucide-react'
import type { Tenant, Vehicle } from './api'
import { mediaApi } from './peopleApi'
import type { Photos } from './peopleApi'
import { ProtectedImage } from './ProtectedImage'
import { QueryMessage } from './FleetFields'
import './profiles.css'

export function VehiclePhotos({ tenant, car, onChanged }: { tenant: Tenant; car: Vehicle; onChanged: () => Promise<void> }) {
  const client = useQueryClient()
  const key = ['vehicle-photos', tenant.id, car.id]
  const data = useQuery({ queryKey: key, queryFn: ({ signal }) => mediaApi.photos(tenant.id, car.id, signal), retry: false })
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState('')
  const canEdit = (car.permissions ?? tenant.permissions).includes('vehicles.update') && car.status !== 'Archived'
  const save = useMutation({ mutationFn: async (remove?: string) => {
    let result: Photos = data.data!
    if (remove) result = await mediaApi.remove(tenant.id, car.id, remove, result.vehicleVersion)
    else for (const file of files) {
      result = await mediaApi.upload(tenant.id, car.id, file, result.vehicleVersion)
      client.setQueryData(key, result); setFiles(current => current.slice(1))
    }
    client.setQueryData(key, result)
    await onChanged()
  } })
  return <section className="vehicle-gallery" aria-label="Járműképek">
    <div className="org-section-tools"><h3>Járműképek <span className="field-hint">{data.data?.items.length ?? 0}/5</span></h3>
      {canEdit && <label className="secondary-button photo-file-button"><Camera size={16} />Képek hozzáadása<input type="file" multiple accept="image/jpeg,image/png" aria-label="Járműképek hozzáadása" disabled={save.isPending || !data.data || data.data.items.length >= 5} onChange={e => {
        const next = Array.from(e.target.files ?? [])
        if (next.length + files.length + (data.data?.items.length ?? 0) > 5) setError('Járművenként legfeljebb öt képet válassz.')
        else if (next.some(f => f.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(f.type))) setError('JPG vagy PNG tölthető fel, képenként legfeljebb 5 MB mérettel.')
        else { setFiles(current => [...current, ...next]); setError('') }
        e.target.value = ''
      }} /></label>}
    </div>
    <QueryMessage pending={data.isPending} error={data.error} retry={() => void data.refetch()} />
    {!!data.data?.items.length && <div className="vehicle-photo-grid">{data.data.items.map(photo => <figure key={photo.id}><ProtectedImage path={mediaApi.photoPath(car.id, photo.id)} tenantId={tenant.id} revision={photo.sha256} alt={`${car.registration} – ${photo.slot}. kép`} className="vehicle-photo" fallback="Kép betöltése…" /><figcaption>{photo.slot}. kép{canEdit && <Button className="icon-button danger-text" aria-label={`${photo.slot}. járműkép törlése`} disabled={save.isPending} onClick={() => save.mutate(photo.id)}><Trash2 size={16} /></Button>}</figcaption></figure>)}</div>}
    {data.data && !data.data.items.length && <p className="field-hint">Még nincs feltöltött járműkép.</p>}
    {!!files.length && <div><p>{files.length} kép vár feltöltésre: {files.map(f => f.name).join(', ')}</p><div className="member-actions"><Button className="primary-button" disabled={save.isPending} onClick={() => save.mutate(undefined)}>{save.isPending ? 'Feltöltés…' : 'Képek feltöltése'}</Button><Button className="secondary-button" disabled={save.isPending} onClick={() => setFiles([])}>Mégse</Button></div></div>}
    {(error || save.error) && <p className="form-error" role="alert">{error || save.error?.message}</p>}
  </section>
}

export function VehicleAssignee({ tenant, car, onChanged, readOnly = false }: { tenant: Tenant; car: Vehicle; onChanged: () => Promise<void>; readOnly?: boolean }) {
  const [selection, setSelection] = useState<string | null>(null)
  const canAssign = !readOnly && (car.permissions ?? tenant.permissions).includes('vehicles.users.assign') && car.status !== 'Archived'
  const current = useQuery({ queryKey: ['vehicle-assignee', tenant.id, car.id], queryFn: ({ signal }) => mediaApi.assignee(tenant.id, car.id, signal), retry: false })
  const options = useQuery({ queryKey: ['vehicle-assignee-options', tenant.id, car.id], queryFn: ({ signal }) => mediaApi.assigneeOptions(tenant.id, car.id, signal), enabled: canAssign, retry: false })
  const selected = selection ?? current.data?.current?.userId ?? ''
  const save = useMutation({ mutationFn: () => mediaApi.assign(tenant.id, car.id, selected || null, car.version!), onSuccess: async () => { setSelection(null); await onChanged() } })
  return <section className={`vehicle-assignee${readOnly ? ' vehicle-current-user' : ''}`} aria-label={readOnly ? 'Jelenlegi használó' : 'Jármű használója'}><UserRound size={19} aria-hidden="true" /><span>Jelenlegi használó: {current.isPending ? 'Betöltés…' : current.data?.current ? <a href={`#/profile/${encodeURIComponent(current.data.current.userId)}`}>{current.data.current.displayName}</a> : current.isError ? 'Nem tölthető be' : 'Nincs kijelölve'}</span>
    {canAssign && <form onSubmit={e => { e.preventDefault(); save.mutate() }}><select aria-label="Jármű használója" value={selected} disabled={save.isPending || !options.data} onChange={e => setSelection(e.target.value)}><option value="">Nincs kijelölve</option>{current.data?.current && !options.data?.some(p => p.id === current.data.current?.userId) && <option value={current.data.current.userId}>{current.data.current.displayName}</option>}{options.data?.map(p => <option key={p.id} value={p.id}>{p.displayName} (@{p.id})</option>)}</select><Button className="secondary-button" disabled={save.isPending || !current.data || selected === (current.data.current?.userId ?? '')}>Hozzárendelés mentése</Button></form>}
    {(current.error || options.error || save.error) && <p className="form-error" role="alert">{current.error?.message ?? options.error?.message ?? save.error?.message}</p>}
  </section>
}
