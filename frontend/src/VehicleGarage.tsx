import { lazy, Suspense, useState } from 'react'
import type { ReactNode } from 'react'
import { Gauge } from 'lucide-react'
import { bodyNames, vehiclePaint } from './vehicleAppearance'
import { vehicleModel } from './vehicleModels'
import type { Vehicle } from './api'
import type { StudioAction, StudioMenu, StudioHotspotKey } from './VehicleStudio'
import { useVehicleAccent } from './useVehicleAccent'
import './dashboard.css'
import './garage-hud.css'

const VehicleStudio = lazy(() => import('./VehicleStudio'))
const emptyMenus: StudioMenu[] = []
const ignore = () => {}

export function VehicleGarage({ car, bodyType, color, menus = emptyMenus, action, onSelect = ignore,
  onReset, paused = false, immersive = false, overlay, children }: {
  car: Vehicle; bodyType: string; color: string | null; menus?: StudioMenu[]; action: StudioAction | null
  onSelect?: (key: StudioHotspotKey) => void
  onReset: () => void; paused?: boolean; immersive?: boolean; overlay?: ReactNode; children?: ReactNode
}) {
  const model = vehicleModel(bodyType, car)
  const paint = vehiclePaint(color)
  return <>
    <div className="car-stage-wrap">
      {model && <Suspense fallback={<div className="vehicle-studio studio-loading" role="status">Garázs betöltése…</div>}>
        <VehicleStudio key={model.key} model={model} vehicleId={car.id} color={color} menus={menus} action={action}
          onSelect={onSelect} onFocused={ignore} onCancelled={ignore} onReset={onReset} immersive={immersive} paused={paused} />
      </Suspense>}
      {overlay && <div className="car-stage-overlay">{overlay}</div>}
      {!immersive && <div className="car-stage-meta">
        <span>{bodyType !== 'Unknown' && bodyNames[bodyType]}<i style={{ backgroundColor: paint.hex }} />{color ?? 'Szín nincs megadva'}</span>
        {car.odometerKm != null && <div className="car-stage-instrument"><Gauge size={17} aria-hidden="true" />
          <strong>{car.odometerKm.toLocaleString('hu-HU')}</strong><span>km</span>
        </div>}
      </div>}
    </div>
    {children}
    {model && <div className="studio-credit">
      <a href={`${import.meta.env.BASE_URL}${model.license}`} target="_blank" rel="noreferrer"
        aria-label={`3D illusztráció: ${model.credit}`} title={model.credit}>{immersive && <span className="studio-credit-compact">3D illusztráció</span>}<span>3D illusztráció · {model.title}</span></a>
    </div>}
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
