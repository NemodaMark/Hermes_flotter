import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TextField } from './OrganizationForms'
import { categories, fuels, transmissions, ownerships, vehicleStatuses } from './fleetApi'
import type { SaveVehicle, VehicleSpecification, PartnerOption } from './fleetApi'
import { DateField, NotesField, NumberField, SelectField } from './FleetFields'
import { request } from './api'

const bodyTypes: Record<string, string> = { Unknown: 'Nincs megadva', Sedan: 'Szedán', Hatchback: 'Ferdehátú', Estate: 'Kombi', Suv: 'SUV / terepjáró', Coupe: 'Kupé', Convertible: 'Kabrió', Minivan: 'Egyterű', Van: 'Furgon', Pickup: 'Pickup', ChassisCab: 'Alvázas', Box: 'Dobozos', Tipper: 'Billencs', Other: 'Egyéb' }
const baseMakes = ['Audi', 'BMW', 'Citroën', 'Dacia', 'Fiat', 'Ford', 'Hyundai', 'Kia', 'Mercedes-Benz', 'Nissan', 'Opel', 'Peugeot', 'Renault', 'Škoda', 'Suzuki', 'Toyota', 'Volkswagen', 'Volvo']
function ComboField({ label, value, options, onChange, disabled }: { label: string; value: string; options: string[]; onChange: (value: string) => void; disabled: boolean }) {
  const id = useId()
  return <label className="org-field"><span>{label}</span><input list={id} value={value} required maxLength={64} disabled={disabled} placeholder="Válassz vagy írj be új értéket" onChange={e => onChange(e.target.value)} autoComplete="off" /><datalist id={id}>{options.map(x => <option key={x} value={x} />)}</datalist></label>
}
export function VehicleFields({ tenantId, data, setData, disabled, serviceOptions = [], preferredServicePartnerName }: {
  tenantId: string; data: SaveVehicle; setData: (data: SaveVehicle) => void; disabled: boolean; serviceOptions?: PartnerOption[]; preferredServicePartnerName?: string | null
}) {
  const [currentYear] = useState(() => new Date().getFullYear())
  const catalog = useQuery({ queryKey: ['vehicle-catalog', tenantId], queryFn: ({ signal }) => request<{ make: string; model: string }[]>('/api/v1/vehicles/catalog', { tenantId, signal }), enabled: !disabled, retry: false })
  const makes = [...new Set([...baseMakes, ...(catalog.data ?? []).map(x => x.make)])].sort((a, b) => a.localeCompare(b, 'hu'))
  const models = [...new Set((catalog.data ?? []).filter(x => x.make.toLocaleLowerCase('hu') === data.make.toLocaleLowerCase('hu')).map(x => x.model))].sort((a, b) => a.localeCompare(b, 'hu'))
  const spec = data.data
  const set = (key: keyof VehicleSpecification, value: string | number | null) => setData({ ...data, data: { ...spec, [key]: value } })
  const num = (key: keyof VehicleSpecification, label: string, max = 100000000, step = 1) => <NumberField label={label} value={spec[key] as number | null} onChange={x => set(key, x)} max={max} step={step} disabled={disabled} />
  const date = (key: keyof VehicleSpecification, label: string) => <DateField label={label} value={spec[key] as string | null} onChange={x => set(key, x)} disabled={disabled} />
  return <>
    <fieldset disabled={disabled}><legend>Azonosítás</legend><div className="org-form-grid">
      <TextField label="Rendszám" value={data.registration} onChange={x => setData({ ...data, registration: x })} required maxLength={16} disabled={disabled} />
      <TextField label="Rendszám országkódja" value={spec.registrationCountry} onChange={x => set('registrationCountry', x)} required maxLength={2} disabled={disabled} />
      <TextField label="Alvázszám (VIN)" value={spec.vin} onChange={x => set('vin', x)} maxLength={17} disabled={disabled} />
      <TextField label="Flottaazonosító" value={spec.fleetNumber} onChange={x => set('fleetNumber', x)} maxLength={40} disabled={disabled} />
      <ComboField label="Gyártó" value={data.make} options={makes} onChange={x => setData({ ...data, make: x })} disabled={disabled} />
      <ComboField label="Modell" value={data.model} options={models} onChange={x => setData({ ...data, model: x })} disabled={disabled} />
    </div></fieldset>
    <fieldset disabled={disabled}><legend>Alapadatok</legend><div className="org-form-grid">
      <SelectField label="Karosszéria" value={spec.bodyType ?? 'Unknown'} options={bodyTypes} onChange={x => set('bodyType', x)} disabled={disabled} />
      <SelectField label="Járműkategória" value={spec.category} options={categories} onChange={x => set('category', x)} disabled={disabled} />
      {num('year', 'Gyártási év', currentYear + 1)}{date('firstRegistration', 'Első forgalomba helyezés')}
      <TextField label="Szín" value={spec.color} onChange={x => set('color', x)} maxLength={40} disabled={disabled} />
      <SelectField label="Állapot" value={data.status} options={data.status === 'Archived' ? vehicleStatuses : { Active: 'Aktív', Maintenance: 'Szervizben', Inactive: 'Inaktív' }} onChange={x => setData({ ...data, status: x })} disabled={disabled} />
      <SelectField label="Tulajdonlás" value={spec.ownership} options={ownerships} onChange={x => set('ownership', x)} disabled={disabled} />
      {date('fleetEntryDate', 'Flottába kerülés')}{date('fleetExitDate', 'Flottából kilépés')}
    </div></fieldset>
    <fieldset disabled={disabled}><legend>Műszaki adatok</legend><div className="org-form-grid">
      <SelectField label="Üzemanyag / hajtás" value={spec.fuelType} options={fuels} onChange={x => set('fuelType', x)} disabled={disabled} />
      <SelectField label="Váltó" value={spec.transmission} options={transmissions} onChange={x => set('transmission', x)} disabled={disabled} />
      {num('powerKw', 'Teljesítmény (kW)', 10000, 0.001)}{num('engineCapacityCc', 'Hengerűrtartalom (cm³)', 100000)}{num('seats', 'Ülések száma', 500)}
      {(['Electric', 'PluginHybrid', 'Hybrid'].includes(spec.fuelType) || spec.batteryKwh !== null) && num('batteryKwh', 'Akkumulátor (kWh)', 10000, 0.001)}
      {num('grossWeightKg', 'Megengedett össztömeg (kg)', 200000)}
      {(['Van', 'Truck', 'Trailer'].includes(spec.category) || spec.payloadKg !== null || spec.cargoVolumeM3 !== null) && <>{num('payloadKg', 'Teherbírás (kg)', 200000)}{num('cargoVolumeM3', 'Raktér (m³)', 1000, 0.001)}</>}
    </div></fieldset>
    <fieldset disabled={disabled}><legend>Határidők és szerviz</legend><div className="org-form-grid">
      {date('inspectionDueDate', 'Műszaki vizsga lejárata')}{date('insuranceDueDate', 'Biztosítás lejárata')}{date('nextServiceDate', 'Következő szerviz dátuma')}{num('nextServiceKm', 'Következő szerviz (km)')}
      <SelectField label="Alapértelmezett szervizpartner" value={spec.preferredServicePartnerId ?? ''} onChange={x => set('preferredServicePartnerId', x || null)} disabled={disabled}
        options={{ '': 'Nincs kijelölve', ...(spec.preferredServicePartnerId ? { [spec.preferredServicePartnerId]: preferredServicePartnerName ?? 'Jelenlegi szervizpartner' } : {}), ...Object.fromEntries((serviceOptions ?? []).map(x => [x.id, x.name])) }} />
    </div></fieldset>
    <NotesField value={spec.notes} onChange={x => set('notes', x)} disabled={disabled} />
  </>
}
