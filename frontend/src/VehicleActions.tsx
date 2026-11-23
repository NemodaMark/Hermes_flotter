import { Button } from './ui/Button'
import { lazy, Suspense, useState } from 'react'
import { Fuel, Gauge } from 'lucide-react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, vehicleKey } from './api'
import type { Session, Tenant, Vehicle } from './api'
import { AccessDialog } from './AccessDialog'
import { MileageCaptureFields } from './MileageCapture'
import { useMileageCapture } from './useMileageCapture'
import { localMileageDate } from './mileageApi'
import './vehicle-recording.css'

const VehicleFuelDialog = lazy(() => import('./VehicleOperations').then(module => ({ default: module.VehicleFuelDialog })))
const MileagePanel = lazy(() => import('./MileagePanel').then(module => ({ default: module.MileagePanel })))
type VehicleActionProps = { user: Session; tenant: Tenant; vehicle: Vehicle }
export type VehicleRecordingMode = 'fuel' | 'odometer'

function useVehicleActionRefresh({ user, tenant, vehicle }: VehicleActionProps) {
  const client = useQueryClient()
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: vehicleKey(user.id, tenant.id) }),
      client.invalidateQueries({ queryKey: ['dashboard'] }),
      client.invalidateQueries({ queryKey: ['fleet-management', tenant.id, vehicle.id] }),
      client.invalidateQueries({ queryKey: ['mileage', tenant.id] }),
    ])
  }
}

export function VehicleRecordingActions(props: VehicleActionProps & {
  onModeChange?: (mode: VehicleRecordingMode | null) => void
  mode?: VehicleRecordingMode | null
}) {
  const { tenant, vehicle, onModeChange, mode: controlledMode } = props
  const refresh = useVehicleActionRefresh(props)
  const [localMode, setMode] = useState<VehicleRecordingMode | null>(null)
  const mode = controlledMode === undefined ? localMode : controlledMode
  const [message, setMessage] = useState('')
  const allowed = (code: string) => vehicle.status !== 'Archived' && (vehicle.permissions ?? tenant.permissions).includes(code)
  const fuel = allowed('vehicles.fuel.manage'), odometer = allowed('vehicles.odometer.create')
  function select(next: VehicleRecordingMode | null) {
    setMode(next)
    if (next) setMessage('')
    onModeChange?.(next)
  }
  if (!fuel && !odometer) return null
  return <div className="vehicle-recording-actions" role="group" aria-label="Gyors rögzítés">
    {fuel && <Button type="button" className="primary-button" aria-label={`Tankolás rögzítése: ${vehicle.registration}`} onClick={() => select('fuel')}>
      <Fuel size={19} aria-hidden="true" /><span>Tankolás</span>
    </Button>}
    {odometer && <Button type="button" className="primary-button" aria-label={`Kilométerállás: ${vehicle.registration}`} onClick={() => select('odometer')}>
      <Gauge size={19} aria-hidden="true" /><span>Km rögzítése</span>
    </Button>}
    {message && <span className="vehicle-recording-feedback" role="status">{message}</span>}
    {mode === 'odometer' && odometer && <VehicleActionDialog key={`${vehicle.id}:${vehicle.version}:odometer`} user={props.user} tenant={tenant} vehicle={vehicle}
      cinematic={!!onModeChange}
      mode="odometer" onClose={() => select(null)} onChanged={async () => { await refresh(); setMessage('Kilométerállás elmentve.') }} />}
    {mode === 'fuel' && fuel && <Suspense fallback={<p role="status">Tankolási űrlap betöltése…</p>}>
      <VehicleFuelDialog tenant={tenant} car={vehicle} userId={props.user.id} cinematic={!!onModeChange} onClose={() => select(null)} onSaved={() => { select(null); setMessage('Tankolás elmentve.') }} />
    </Suspense>}
  </div>
}

export function VehicleActions({
  user,
  tenant,
  vehicle,
  allowEditing = true,
}: {
  user: Session
  tenant: Tenant
  vehicle: Vehicle
  allowEditing?: boolean
}) {
  const refresh = useVehicleActionRefresh({ user, tenant, vehicle })
  const [mode, setMode] = useState<'edit' | 'odometer' | null>(null)
  return (
    <div className="member-actions">
      {allowEditing && vehicle.status !== 'Archived' && (vehicle.permissions ?? tenant.permissions).includes('vehicles.update') && (
        <Button
          className="secondary-button"
          aria-label={`Jármű szerkesztése: ${vehicle.registration}`}
          onClick={() => setMode('edit')}
        >
          Szerkesztés
        </Button>
      )}
      {vehicle.status !== 'Archived' && (vehicle.permissions ?? tenant.permissions).includes('vehicles.odometer.create') && (
        <Button
          className="secondary-button"
          aria-label={`Kilométerállás: ${vehicle.registration}`}
          onClick={() => setMode('odometer')}
        >
          Km rögzítése
        </Button>
      )}
      {mode && (
        <VehicleActionDialog
          key={`${vehicle.id}:${vehicle.version}:${mode}`}
          user={user}
          tenant={tenant}
          vehicle={vehicle}
          mode={mode}
          onClose={() => setMode(null)}
          onChanged={refresh}
        />
      )}
    </div>
  )
}

function VehicleActionDialog({
  cinematic = false,
  user,
  tenant,
  vehicle,
  mode,
  onClose,
  onChanged,
}: {
  cinematic?: boolean
  user: Session
  tenant: Tenant
  vehicle: Vehicle
  mode: 'edit' | 'odometer'
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [registration, setRegistration] = useState(vehicle.registration)
  const [make, setMake] = useState(vehicle.make)
  const [model, setModel] = useState(vehicle.model)
  const [kilometers, setKilometers] = useState(vehicle.odometerKm?.toString() ?? '')
  const [monthly, setMonthly] = useState(false)
  const mileagePending = useIsMutating({ mutationKey: ['mileage', tenant.id] }) > 0
  const capture = useMileageCapture(tenant, user.id, localMileageDate(), mode === 'odometer')
  const save = useMutation({
    mutationFn: () =>
      mode === 'edit'
        ? api.updateVehicle(tenant.id, vehicle, { registration, make, model })
        : api.recordOdometer(tenant.id, vehicle, Number(kilometers), capture.usage()),
  })
  return (
    <AccessDialog
      title={mode === 'edit' ? 'Járműadatok szerkesztése' : 'Kilométerállás rögzítése'}
      pending={save.isPending || mileagePending}
      onClose={onClose}
      className={`recording-dialog ${monthly ? 'mileage-dialog' : cinematic ? 'garage-operation-dialog' : ''}`}
    >
      {mode === 'odometer' && capture.allowed && <div className="mileage-dialog-tabs" role="group" aria-label="Km-rögzítés nézete">
        <Button className="secondary-button" aria-pressed={!monthly} disabled={save.isPending} onClick={() => setMonthly(false)}>Kilométerállás</Button>
        <Button className="secondary-button" aria-pressed={monthly} disabled={save.isPending} onClick={() => setMonthly(true)}>Havi elszámolás</Button>
      </div>}
      {monthly ? <Suspense fallback={<p role="status">Elszámolás betöltése…</p>}><MileagePanel user={user} tenant={tenant} /></Suspense> : <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!capture.ready) return
          void save
            .mutateAsync()
            .then(async () => {
              onClose()
              await onChanged()
            })
            .catch(() => {})
        }}
      >
        <p className="access-description">
          {vehicle.registration} · {tenant.name}
        </p>
        {mode === 'edit' ? (
          <>
            <label htmlFor="edit-registration">Rendszám</label>
            <input
              id="edit-registration"
              required
              maxLength={16}
              disabled={save.isPending}
              value={registration}
              onChange={(e) => setRegistration(e.target.value)}
            />
            <label htmlFor="edit-make">Gyártó</label>
            <input
              id="edit-make"
              required
              maxLength={64}
              disabled={save.isPending}
              value={make}
              onChange={(e) => setMake(e.target.value)}
            />
            <label htmlFor="edit-model">Modell</label>
            <input
              id="edit-model"
              required
              maxLength={64}
              disabled={save.isPending}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </>
        ) : (
          <>
            <label htmlFor="odometer">Kilométerállás (km)</label>
            <input
              id="odometer"
              required
              type="number"
              inputMode="numeric"
              min={vehicle.odometerKm ?? 0}
              max={100000000}
              step={1}
              disabled={save.isPending}
              value={kilometers}
              onChange={(e) => setKilometers(e.target.value)}
            />
            <p className="field-hint">
              Előző érték: {vehicle.odometerKm?.toLocaleString('hu-HU') ?? 'még nincs adat'} km.
            </p>
            <MileageCaptureFields capture={capture} onMonthly={() => setMonthly(true)} />
          </>
        )}
        {save.isError && (
          <p className="form-error" role="alert">
            {save.error.message}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            type="button"
            className="secondary-button"
            disabled={save.isPending}
            onClick={onClose}
          >
            Mégse
          </Button>
          <Button className="primary-button" disabled={save.isPending || !capture.ready}>
            Mentés
          </Button>
        </div>
      </form>}
    </AccessDialog>
  )
}
