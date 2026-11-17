import { lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { Gauge, RotateCcw } from 'lucide-react'
import { Button } from './ui/Button'
import { bodyNames, vehiclePaint } from './vehicleAppearance'
import { vehicleModel } from './vehicleModels'
import type { Vehicle } from './api'
import type { StudioAction, StudioMenu, StudioSection } from './VehicleStudio'
import './dashboard.css'

const VehicleStudio = lazy(() => import('./VehicleStudio'))
const emptyMenus: StudioMenu[] = []
const ignore = () => {}

export function VehicleGarage({ car, bodyType, color, menus = emptyMenus, action, onSelect = ignore,
  onFocused = ignore, onCancelled = ignore, onReset, paused = false, flying = false, children }: {
  car: Vehicle; bodyType: string; color: string | null; menus?: StudioMenu[]; action: StudioAction | null
  onSelect?: (key: StudioSection) => void; onFocused?: (key: StudioSection) => void; onCancelled?: () => void
  onReset: () => void; paused?: boolean; flying?: boolean; children?: ReactNode
}) {
  const model = vehicleModel(bodyType)
  const paint = vehiclePaint(color)
  return <>
    <div className="car-stage-wrap">
      <Suspense fallback={<div className="vehicle-studio studio-loading" role="status">Garázs betöltése…</div>}>
        <VehicleStudio key={`${car.id}:${model.key}`} model={model} color={color} menus={menus} action={action}
          onSelect={onSelect} onFocused={onFocused} onCancelled={onCancelled} paused={paused} />
      </Suspense>
      <div className="car-stage-meta">
        <span>{bodyNames[bodyType] ?? 'Egyéb karosszéria'}<i style={{ backgroundColor: paint.hex }} />{color ?? 'Szín nincs megadva'}</span>
        <Button className="studio-reset" aria-label="Kamera alaphelyzetbe" onClick={onReset}><RotateCcw size={16} aria-hidden="true"/>Alapnézet</Button>
      </div>
      {car.odometerKm != null && <div className="car-stage-instrument"><Gauge size={19} aria-hidden="true" />
        <strong>{car.odometerKm.toLocaleString('hu-HU')}</strong><span>km</span>
      </div>}
      {flying && <span className="studio-flight-status" role="status">Nézet beállítása…</span>}
    </div>
    {children}
    <div className="studio-credit">
      {model.fallback ? 'Általános bemutatómodell' : 'Karosszériatípus szerinti illusztráció'} ·{' '}
      <a href={`${import.meta.env.BASE_URL}${model.license}`} target="_blank" rel="noreferrer">{model.credit}</a>
    </div>
  </>
}

export function ProfileVehicleGarage({ car, bodyType, color }: { car: Vehicle; bodyType: string; color: string | null }) {
  const [action, setAction] = useState<StudioAction | null>(null)
  return <section className="profile-garage" aria-label="3D garázs">
    <VehicleGarage car={car} bodyType={bodyType} color={color} action={action}
      onReset={() => setAction(previous => ({ key: 'home', sequence: (previous?.sequence ?? 0) + 1 }))} />
  </section>
}
