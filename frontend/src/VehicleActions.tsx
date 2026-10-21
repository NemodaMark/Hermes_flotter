import { Button } from './ui/Button'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, vehicleKey } from './api'
import type { Session, Tenant, Vehicle } from './api'
import { AccessDialog } from './AccessDialog'

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
  const client = useQueryClient()
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
          tenant={tenant}
          vehicle={vehicle}
          mode={mode}
          onClose={() => setMode(null)}
          onChanged={async () => {
            await client.invalidateQueries({ queryKey: vehicleKey(user.id, tenant.id) })
            await client.invalidateQueries({ queryKey: ['fleet-management', tenant.id, vehicle.id] })
          }}
        />
      )}
    </div>
  )
}

function VehicleActionDialog({
  tenant,
  vehicle,
  mode,
  onClose,
  onChanged,
}: {
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
  const save = useMutation({
    mutationFn: () =>
      mode === 'edit'
        ? api.updateVehicle(tenant.id, vehicle, { registration, make, model })
        : api.recordOdometer(tenant.id, vehicle, Number(kilometers)),
  })
  return (
    <AccessDialog
      title={mode === 'edit' ? 'Járműadatok szerkesztése' : 'Kilométerállás rögzítése'}
      pending={save.isPending}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
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
          <Button className="primary-button" disabled={save.isPending}>
            Mentés
          </Button>
        </div>
      </form>
    </AccessDialog>
  )
}
