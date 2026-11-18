import coupe from './assets/vehicles/coupe.glb?url'
import sedan from './assets/vehicles/sedan.glb?url'
import hatchback from './assets/vehicles/hatchback.glb?url'
import estate from './assets/vehicles/estate.glb?url'
import suv from './assets/vehicles/suv.glb?url'
import van from './assets/vehicles/van.glb?url'
import convertible from './assets/vehicles/convertible.glb?url'
import minivan from './assets/vehicles/minivan.glb?url'
import pickup from './assets/vehicles/pickup.glb?url'
import box from './assets/vehicles/box.glb?url'
import chassis from './assets/vehicles/chassis.glb?url'
import tipper from './assets/vehicles/tipper.glb?url'

export type VehicleModel = { key: string; url: string; rotation: number; length: number; credit: string; license: string; fallback?: boolean; paintMaterials?: readonly string[] }
const library = (key: string, url: string, length: number, rotation = Math.PI): VehicleModel => ({
  key, url, length, rotation, credit: '3D: Innerscene · CC0 · módosítva', license: 'models/vehicle-bodies/LICENSE.md',
})
const models: Record<string, VehicleModel> = {
  Sedan: library('sedan', sedan, 4.8), Hatchback: library('hatchback', hatchback, 4.25), Estate: library('estate', estate, 4.8),
  Suv: library('suv', suv, 4.6), Coupe: library('coupe', coupe, 4.5),
  Convertible: library('convertible', convertible, 4.1), Minivan: library('minivan', minivan, 5.1),
  Van: library('van', van, 5.7), Pickup: library('pickup', pickup, 5.6), Box: library('box', box, 6.5),
  ChassisCab: library('chassis', chassis, 6.5), Tipper: library('tipper', tipper, 7.2, 0),
}
const fallback: VehicleModel = { ...models.Sedan, fallback: true }
const vanFallback: VehicleModel = { ...models.Van, fallback: true }
export function vehicleModel(bodyType: string, modelName = ''): VehicleModel {
  if (Object.hasOwn(models, bodyType)) return models[bodyType]
  // Older records may have a known van model without a stored body type.
  return /\b(sprinter|ducato|crafter|transit|jumper|boxer)\b/i.test(modelName) ? vanFallback : fallback
}
