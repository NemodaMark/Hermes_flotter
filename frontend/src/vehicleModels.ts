import concept from './assets/car-concept.glb?url'
import sedan from './assets/vehicles/sedan.glb?url'
import hatchback from './assets/vehicles/hatchback.glb?url'
import estate from './assets/vehicles/estate.glb?url'
import suv from './assets/vehicles/suv.glb?url'
import convertible from './assets/vehicles/convertible.glb?url'
import minivan from './assets/vehicles/minivan.glb?url'
import van from './assets/vehicles/van.glb?url'
import pickup from './assets/vehicles/pickup.glb?url'
import box from './assets/vehicles/box.glb?url'
import chassis from './assets/vehicles/chassis.glb?url'
import tipper from './assets/vehicles/tipper.glb?url'

export type VehicleModel = { key: string; url: string; rotation: number; length: number; credit: string; license: string; fallback?: boolean }
const library = (key: string, url: string, length: number, rotation = Math.PI): VehicleModel => ({
  key, url, length, rotation, credit: '3D: Innerscene · CC0 · módosítva', license: 'models/vehicle-bodies/LICENSE.md',
})
const models: Record<string, VehicleModel> = {
  Sedan: library('sedan', sedan, 4.8), Hatchback: library('hatchback', hatchback, 4.25), Estate: library('estate', estate, 4.8),
  Suv: library('suv', suv, 4.6), Convertible: library('convertible', convertible, 4.1), Minivan: library('minivan', minivan, 5.1),
  Van: library('van', van, 5.7), Pickup: library('pickup', pickup, 5.6), Box: library('box', box, 6.5),
  ChassisCab: library('chassis', chassis, 6.5), Tipper: library('tipper', tipper, 7.2, 0),
  Coupe: { key: 'concept', url: concept, rotation: Math.PI / 2, length: 4.8, credit: '3D: Car Concept · Eric Chadwick / DGG · CC BY 4.0 · módosítva', license: 'models/khronos-car/LICENSE.md' },
}
const fallback = { ...models.Sedan, fallback: true }
export function vehicleModel(bodyType: string): VehicleModel { return models[bodyType] ?? fallback }
