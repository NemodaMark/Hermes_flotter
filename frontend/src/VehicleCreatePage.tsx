import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Camera, X } from 'lucide-react'
import { api, vehicleKey } from './api'
import type { Session, Tenant, Vehicle } from './api'
import { VehicleFields } from './VehicleFields'
import type { SaveVehicle, VehicleSpecification } from './fleetApi'
import { mediaApi } from './peopleApi'
import { QueryMessage, NumberField } from './FleetFields'
import './profiles.css'

const emptySpecification: VehicleSpecification = { registrationCountry: 'HU', vin: null, fleetNumber: null, category: 'Unknown', bodyType: 'Unknown', year: null, firstRegistration: null, color: null, fuelType: 'Unknown', powerKw: null, engineCapacityCc: null, transmission: 'Unknown', seats: null, grossWeightKg: null, payloadKg: null, cargoVolumeM3: null, batteryKwh: null, ownership: 'Unknown', fleetEntryDate: null, fleetExitDate: null, inspectionDueDate: null, insuranceDueDate: null, nextServiceDate: null, nextServiceKm: null, preferredServicePartnerId: null, notes: null }
function LocalPhoto({ file }: { file: File }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    const source = URL.createObjectURL(file)
    // The browser owns this resource; replace it and release it when the file changes.
    // oxlint-disable-next-line react/set-state-in-effect
    setUrl(source)
    return () => URL.revokeObjectURL(source)
  }, [file])
  return url ? <img className="vehicle-photo-preview" src={url} alt={file.name} /> : null
}
export function VehicleCreatePage({ user, tenant, onBack, onCreated, onBusyChange }: { user: Session; tenant: Tenant; onBack: () => void; onCreated: (car: Vehicle) => void; onBusyChange?: (busy: boolean) => void }) {
  const client = useQueryClient()
  const [data, setData] = useState<SaveVehicle>({ registration: '', make: '', model: '', status: 'Active', version: 1, data: emptySpecification })
  const [site, setSite] = useState(''), [km, setKm] = useState<number | null>(null)
  const [files, setFiles] = useState<File[]>([]), [fileError, setFileError] = useState('')
  const [created, setCreated] = useState<Vehicle | null>(null)
  const options = useQuery({ queryKey: ['vehicle-create-options', tenant.id], queryFn: ({ signal }) => api.vehicleCreationOptions(tenant.id, signal), retry: false })
  const save = useMutation({ mutationFn: async () => {
    let car = created
    if (!car) { car = await api.createVehicle(tenant.id, { registration: data.registration, make: data.make, model: data.model, siteId: site || null, data: data.data, status: data.status, odometerKm: km }); setCreated(car) }
    for (const file of files) {
      const result = await mediaApi.upload(tenant.id, car.id, file, car.version!)
      car = { ...car, version: result.vehicleVersion }; setCreated(car); setFiles(current => current.slice(1))
    }
    await Promise.all([client.invalidateQueries({ queryKey: vehicleKey(user.id, tenant.id) }), client.invalidateQueries({ queryKey: ['vehicle-catalog', tenant.id] })])
    return car
  }, onSuccess: car => onCreated(car) })
  useEffect(() => { onBusyChange?.(save.isPending); return () => onBusyChange?.(false) }, [onBusyChange, save.isPending])
  const disabled = save.isPending || !!created
  return <div className="vehicle-create-page">
    <button className="text-button org-back" onClick={() => created ? onCreated(created) : onBack()} disabled={save.isPending}><ArrowLeft size={16} />{created ? 'A létrehozott jármű megnyitása' : 'Vissza a járművekhez'}</button>
    <section className="access-panel" aria-label="Új jármű adatlapja"><div className="org-toolbar"><h2>Új jármű</h2></div>
      <QueryMessage pending={options.isPending} error={options.error} retry={() => void options.refetch()} />
      <form className="org-form" onSubmit={e => { e.preventDefault(); save.mutate() }}>
        <VehicleFields tenantId={tenant.id} data={data} setData={setData} disabled={disabled} serviceOptions={options.data?.servicePartners ?? []} />
        <fieldset disabled={disabled}><legend>Telephely és kilométerállás</legend><div className="org-form-grid"><label className="org-field"><span>Telephely</span><select aria-label="Telephely" value={site} required={!options.data?.canCreateUnassigned} onChange={e => setSite(e.target.value)}><option value="">{options.data?.canCreateUnassigned ? 'Nincs telephelyhez rendelve' : 'Válassz telephelyet'}</option>{options.data?.sites.map(s => <option key={s.id} value={s.id}>{s.name} ({s.code})</option>)}</select></label><NumberField label="Kezdő kilométerállás" value={km} onChange={setKm} disabled={disabled} /></div></fieldset>
        <fieldset disabled={save.isPending}><legend>Járműképek</legend><p className="field-hint">Nem kötelező · legfeljebb 5 kép · JPG vagy PNG · képenként legfeljebb 5 MB</p>
          <label className="secondary-button photo-file-button"><Camera size={16} />Képek kiválasztása<input aria-label="Járműképek kiválasztása" type="file" multiple accept="image/jpeg,image/png" disabled={!!created} onChange={e => {
            const selected = Array.from(e.target.files ?? [])
            if (files.length + selected.length > 5) setFileError('Legfeljebb öt képet válassz.')
            else if (selected.some(f => f.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(f.type))) setFileError('JPG- vagy PNG-képet válassz, képenként legfeljebb 5 MB mérettel.')
            else { setFiles(current => [...current, ...selected]); setFileError('') }
            e.target.value = ''
          }} /></label>
          <div className="vehicle-photo-grid">{files.map((file, index) => <figure key={`${file.name}:${file.lastModified}:${index}`}><LocalPhoto file={file} /><figcaption>{file.name}<button type="button" className="icon-button" aria-label={`Kép eltávolítása: ${file.name}`} onClick={() => setFiles(current => current.filter((_, i) => i !== index))}><X size={16} /></button></figcaption></figure>)}</div>
          {fileError && <p className="form-error" role="alert">{fileError}</p>}
        </fieldset>
        {created && save.error && <p className="notice">A jármű már létrejött. A még fel nem töltött képeket újrapróbálhatod; újabb jármű nem készül.</p>}
        {save.error && <p className="form-error" role="alert">{save.error.message}</p>}
        <div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => created ? onCreated(created) : onBack()} disabled={save.isPending}>{created ? 'Tovább az adatlapra' : 'Mégse'}</button><button className="primary-button" disabled={save.isPending || !options.data}>{save.isPending ? 'Mentés…' : created ? 'Képfeltöltés újrapróbálása' : 'Jármű létrehozása'}</button></div>
      </form>
    </section>
  </div>
}
