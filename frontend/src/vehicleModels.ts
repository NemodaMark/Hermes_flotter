import concept from './assets/car-concept.glb?url'
import megane from './assets/vehicles/renault-megane.glb?url'
import golf from './assets/vehicles/vw-golf.glb?url'
import passat from './assets/vehicles/volkswagen-passat.glb?url'
import rav4 from './assets/vehicles/toyota-rav4.glb?url'
import ducato from './assets/vehicles/fiat-ducato.glb?url'
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
const studio = (key: string, url: string, length: number, rotation: number, author: string, paintMaterial: string): VehicleModel => ({
  key, url, length, rotation, credit: `3D: ${author} · CC BY 4.0 · módosítva`,
  license: 'models/studio/LICENSE.md', paintMaterials: [paintMaterial],
})
const models: Record<string, VehicleModel> = {
  Sedan: studio('renault-megane', megane, 4.63, Math.PI / 2, 'Mona x Supercars', 'Body'),
  Hatchback: studio('vw-golf', golf, 4.29, -Math.PI / 2, 'GT Cars: Hyperspeed', 'Meshesuntitleduniqueid1500011Mtl'),
  Estate: studio('volkswagen-passat', passat, 4.77, -Math.PI / 2, 'ANDREO12', 'Matte__FFC0C0C0__prim_env_9_spec'),
  Suv: studio('toyota-rav4', rav4, 4.60, Math.PI / 2, 'tonielpro520', 'Silver_Sky_Metallic'),
  Convertible: library('convertible', convertible, 4.1), Minivan: library('minivan', minivan, 5.1),
  Van: studio('fiat-ducato', ducato, 5.7, Math.PI / 2, 'razor24', 'varnish'), Pickup: library('pickup', pickup, 5.6), Box: library('box', box, 6.5),
  ChassisCab: library('chassis', chassis, 6.5), Tipper: library('tipper', tipper, 7.2, 0),
  Coupe: { key: 'concept', url: concept, rotation: Math.PI / 2, length: 4.8, credit: '3D: Car Concept · Eric Chadwick / DGG · CC BY 4.0 · módosítva', license: 'models/khronos-car/LICENSE.md' },
}
const fallback: VehicleModel = { ...models.Sedan, fallback: true }
export function vehicleModel(bodyType: string): VehicleModel { return models[bodyType] ?? fallback }
