import { lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { Gauge } from 'lucide-react'
import { bodyNames, vehiclePaint } from './vehicleAppearance'
import { vehicleModel } from './vehicleModels'
import type { Vehicle } from './api'
import type { StudioAction, StudioMenu, StudioSection } from './VehicleStudio'
import { useVehicleAccent } from './useVehicleAccent'
import './dashboard.css'

const VehicleStudio = lazy(() => import('./VehicleStudio'))
const emptyMenus: StudioMenu[] = []
const ignore = () => {}

export function VehicleGarage({ car, bodyType, color, menus = emptyMenus, action, onSelect = ignore,
  onFocused = ignore, onCancelled = ignore, onReset, paused = false, flying = false, immersive = false, overlay, children }: {
  car: Vehicle; bodyType: string; color: string | null; menus?: StudioMenu[]; action: StudioAction | null
  onSelect?: (key: StudioSection) => void; onFocused?: (key: StudioSection) => void; onCancelled?: () => void
  onReset: () => void; paused?: boolean; flying?: boolean; immersive?: boolean; overlay?: ReactNode; children?: ReactNode
}) {
  const model = vehicleModel(bodyType)
  const paint = vehiclePaint(color)
  return <>
    <div className="car-stage-wrap">
      <Suspense fallback={<div className="vehicle-studio studio-loading" role="status">Garázs betöltése…</div>}>
        <VehicleStudio key={`${car.id}:${model.key}`} model={model} color={color} menus={menus} action={action}
          onSelect={onSelect} onFocused={onFocused} onCancelled={onCancelled} onReset={onReset} immersive={immersive} paused={paused} />
      </Suspense>
      {overlay && <div className="car-stage-overlay">{overlay}</div>}
      <div className="car-stage-meta">
        <span>{bodyNames[bodyType] ?? 'Egyéb karosszéria'}<i style={{ backgroundColor: paint.hex }} />{color ?? 'Szín nincs megadva'}</span>
        {car.odometerKm != null && <div className="car-stage-instrument"><Gauge size={17} aria-hidden="true" />
          <strong>{car.odometerKm.toLocaleString('hu-HU')}</strong><span>km</span>
        </div>}
      </div>
      {flying && <span className="studio-flight-status" role="status">Nézet beállítása…</span>}
    </div>
    {children}
    <div className="studio-credit">
      <a href={`${import.meta.env.BASE_URL}${model.license}`} target="_blank" rel="noreferrer"
        aria-label={model.credit} title={model.credit}>{immersive && <span className="studio-credit-compact">3D modell forrása</span>}<span>{model.credit}</span></a>
    </div>
  </>
}

export function ProfileVehicleGarage({ car, bodyType, color }: { car: Vehicle; bodyType: string; color: string | null }) {
  const [action, setAction] = useState<StudioAction | null>(null)
  useVehicleAccent(color)
  return <section className="profile-garage" aria-label="3D garázs">
    <VehicleGarage car={car} bodyType={bodyType} color={color} action={action}
      onReset={() => setAction(previous => ({ key: 'home', sequence: (previous?.sequence ?? 0) + 1 }))} />
  </section>
}
