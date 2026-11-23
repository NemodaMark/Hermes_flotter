import { ComboBox } from './ui/Select'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TextField } from './OrganizationForms'
import { categories, dateText, fuels, transmissions, ownerships, vehicleStatuses } from './fleetApi'
import type { SaveVehicle, VehicleSpecification, PartnerOption } from './fleetApi'
import { DateField, NotesField, NumberField, SelectField } from './FleetFields'
import { request } from './api'
import { VehicleFieldSections } from './VehicleFieldSections'
import { bodyNames, vehiclePaint } from './vehicleAppearance'
import './vehicle-layout.css'

const baseMakes = ['Audi', 'BMW', 'Citroën', 'Dacia', 'Fiat', 'Ford', 'Hyundai', 'Kia', 'Mercedes-Benz', 'Nissan', 'Opel', 'Peugeot', 'Renault', 'Škoda', 'Suzuki', 'Toyota', 'Volkswagen', 'Volvo']
const paintChoices = ['Fehér', 'Fekete', 'Szürke', 'Ezüst', 'Kék', 'Világoskék', 'Sötétkék', 'Piros', 'Bordó', 'Zöld', 'Sárga', 'Narancs', 'Barna', 'Bézs', 'Lila']

function VehicleValue({ label, value }: { label: string; value: string | null }) {
  return <div className="org-field"><span>{label}</span><p className="vehicle-read-value">{value || '—'}</p></div>
}

export function VehicleFields({ tenantId, data, setData, disabled, readOnly = false, serviceOptions = [], preferredServicePartnerName }: {
  tenantId: string; data: SaveVehicle; setData: (data: SaveVehicle) => void; disabled: boolean; readOnly?: boolean
  serviceOptions?: PartnerOption[]; preferredServicePartnerName?: string | null
}) {
  const [currentYear] = useState(() => new Date().getFullYear())
  const catalog = useQuery({ queryKey: ['vehicle-catalog', tenantId], queryFn: ({ signal }) => request<{ make: string; model: string }[]>('/api/v1/vehicles/catalog', { tenantId, signal }), enabled: !disabled, retry: false })
  const makes = [...new Set([...baseMakes, ...(catalog.data ?? []).map(x => x.make)])].sort((a, b) => a.localeCompare(b, 'hu'))
  const models = [...new Set((catalog.data ?? []).filter(x => x.make.toLocaleLowerCase('hu') === data.make.toLocaleLowerCase('hu')).map(x => x.model))].sort((a, b) => a.localeCompare(b, 'hu'))
  const spec = data.data
  const paint = vehiclePaint(spec.color)
  const bodyType = spec.bodyType && Object.hasOwn(bodyNames, spec.bodyType) ? spec.bodyType : 'Unknown'
  const set = (key: keyof VehicleSpecification, value: string | number | null) => setData({ ...data, data: { ...spec, [key]: value } })
  const text = (label: string, value: string | null, onChange: (value: string) => void, maxLength: number, required = false) =>
    readOnly ? <VehicleValue label={label} value={value} /> : <TextField label={label} value={value} onChange={onChange} required={required} maxLength={maxLength} disabled={disabled} />
  const num = (key: keyof VehicleSpecification, label: string, max = 100000000, step = 1) => readOnly
    ? <VehicleValue label={label} value={spec[key] == null ? null : (spec[key] as number).toLocaleString('hu-HU')} />
    : <NumberField label={label} value={spec[key] as number | null} onChange={x => set(key, x)} max={max} step={step} disabled={disabled} />
  const date = (key: keyof VehicleSpecification, label: string) => readOnly ? <VehicleValue label={label} value={dateText(spec[key] as string | null)} />
    : <DateField label={label} value={spec[key] as string | null} onChange={x => set(key, x)} disabled={disabled} />
  const choice = (label: string, value: string, options: Record<string, string>, onChange: (value: string) => void) =>
    readOnly ? <VehicleValue label={label} value={options[value] ?? value} />
      : <SelectField label={label} value={value} options={options} onChange={onChange} disabled={disabled} />
  const catalogChoice = (label: string, value: string, options: string[], onChange: (value: string) => void) =>
    readOnly ? <VehicleValue label={label} value={value} />
      : <label className="org-field"><span>{label}</span><ComboBox label={label} value={value} options={options} onChange={onChange} disabled={disabled} /></label>
  return <VehicleFieldSections readOnly={readOnly}>{{
    basic: <fieldset disabled={disabled}><legend>Alapadatok</legend><div className="org-form-grid">
      {!readOnly && text('Rendszám', data.registration, x => setData({ ...data, registration: x }), 16, true)}
      {!readOnly && text('Rendszám országkódja', spec.registrationCountry, x => set('registrationCountry', x), 2, true)}
      {text('Alvázszám (VIN)', spec.vin, x => set('vin', x), 17)}
      {!readOnly && catalogChoice('Gyártó', data.make, makes, x => setData({ ...data, make: x }))}
      {!readOnly && catalogChoice('Modell', data.model, models, x => setData({ ...data, model: x }))}
      {text('Flottaazonosító', spec.fleetNumber, x => set('fleetNumber', x), 40)}
      {choice('Karosszéria', bodyType, bodyNames, x => set('bodyType', x))}
      {choice('Járműkategória', spec.category, categories, x => set('category', x))}
      {readOnly && choice('Üzemanyag / hajtás', spec.fuelType, fuels, x => set('fuelType', x))}
      {num('year', 'Gyártási év', currentYear + 1)}
      {readOnly ? <VehicleValue label="Szín" value={spec.color} /> : <div className="org-field">
        <span>Szín</span>
        <div className="vehicle-color-field">
          <ComboBox label="Szín" value={spec.color ?? ''} options={paintChoices} onChange={x => set('color', x || null)}
            disabled={disabled} required={false} maxLength={40} placeholder="Színnév vagy #HEX" />
          <input type="color" aria-label="Egyéni szín kiválasztása" title="Egyéni szín kiválasztása" disabled={disabled}
            value={paint.hex} onChange={event => set('color', event.target.value)} />
        </div>
        <small className="field-hint">{spec.color && !paint.matched
          ? 'A 3D előnézethez válassz színmintát, vagy adj meg HEX-kódot.'
          : 'Válassz egy színt a listából vagy a színmintára kattintva.'}</small>
      </div>}
      {readOnly && spec.notes && <div className="vehicle-wide-field"><VehicleValue label="Megjegyzés" value={spec.notes} /></div>}
    </div></fieldset>,
    technical: <fieldset disabled={disabled}><legend>Műszaki adatok</legend><div className="org-form-grid">
      {!readOnly && choice('Üzemanyag / hajtás', spec.fuelType, fuels, x => set('fuelType', x))}
      {choice('Váltó', spec.transmission, transmissions, x => set('transmission', x))}
      {num('powerKw', 'Teljesítmény (kW)', 10000, 0.001)}{num('engineCapacityCc', 'Hengerűrtartalom (cm³)', 100000)}{num('seats', 'Ülések száma', 500)}
      {(['Electric', 'PluginHybrid', 'Hybrid'].includes(spec.fuelType) || spec.batteryKwh !== null) && num('batteryKwh', 'Akkumulátor (kWh)', 10000, 0.001)}
      {num('grossWeightKg', 'Megengedett össztömeg (kg)', 200000)}
      {(['Van', 'Truck', 'Trailer'].includes(spec.category) || spec.payloadKg !== null || spec.cargoVolumeM3 !== null) && <>{num('payloadKg', 'Teherbírás (kg)', 200000)}{num('cargoVolumeM3', 'Raktér (m³)', 1000, 0.001)}</>}
    </div></fieldset>,
    operation: <fieldset disabled={disabled}><legend>Üzemeltetés</legend><div className="org-form-grid">
      {readOnly && <VehicleValue label="Rendszám országkódja" value={spec.registrationCountry} />}
      {choice('Állapot', data.status, data.status === 'Archived' ? vehicleStatuses : { Active: 'Aktív', Maintenance: 'Szervizben', Inactive: 'Inaktív' }, x => setData({ ...data, status: x }))}
      {choice('Tulajdonlás', spec.ownership, ownerships, x => set('ownership', x))}
      {date('firstRegistration', 'Első forgalomba helyezés')}{date('fleetEntryDate', 'Flottába kerülés')}{date('fleetExitDate', 'Flottából kilépés')}
      {!readOnly && <div className="vehicle-wide-field"><NotesField value={spec.notes} onChange={x => set('notes', x)} disabled={disabled} /></div>}
    </div></fieldset>,
    deadlines: <fieldset disabled={disabled}><legend>Határidők és szerviz</legend><div className="org-form-grid">
      {date('inspectionDueDate', 'Műszaki vizsga lejárata')}{date('insuranceDueDate', 'Biztosítás lejárata')}{date('nextServiceDate', 'Következő szerviz dátuma')}{num('nextServiceKm', 'Következő szerviz (km)')}
      {choice('Alapértelmezett szervizpartner', spec.preferredServicePartnerId ?? '',
        { '': 'Nincs kijelölve', ...(spec.preferredServicePartnerId ? { [spec.preferredServicePartnerId]: preferredServicePartnerName ?? 'Jelenlegi szervizpartner' } : {}), ...Object.fromEntries(serviceOptions.map(x => [x.id, x.name])) }, x => set('preferredServicePartnerId', x || null))}
    </div></fieldset>,
  }}</VehicleFieldSections>
}
