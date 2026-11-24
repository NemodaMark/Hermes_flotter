import bmw from './assets/vehicles/bmw-7-series-f01.glb?url'
import megane from './assets/vehicles/renault-megane.glb?url'
import golf from './assets/vehicles/vw-golf.glb?url'
import passat from './assets/vehicles/volkswagen-passat.glb?url'
import rav4 from './assets/vehicles/toyota-rav4.glb?url'
import duster from './assets/vehicles/renault-duster.glb?url'
import mustang from './assets/vehicles/ford-mustang.glb?url'
import audi from './assets/vehicles/audi-tt.glb?url'
import carnival from './assets/vehicles/kia-carnival.glb?url'
import ducato from './assets/vehicles/fiat-ducato.glb?url'
import sprinter from './assets/vehicles/mercedes-benz-sprinter.glb?url'
import hilux from './assets/vehicles/toyota-hilux.glb?url'
import box from './assets/vehicles/box.glb?url'
import chassis from './assets/vehicles/chassis.glb?url'
import tipper from './assets/vehicles/tipper.glb?url'

export type VehicleModel = {
  key: string; url: string; rotation: number; length: number; title: string; credit: string; license: string
  paintMaterials?: readonly string[]
}

const road = (key: string, url: string, length: number, rotation: number, title: string, author: string, paintMaterials: string[]): VehicleModel => ({
  key, url, length, rotation, title, paintMaterials,
  credit: `${title} · ${author} · CC BY 4.0 · módosítva`, license: 'models/studio/LICENSE.md',
})
const utility = (key: string, url: string, length: number, title: string, rotation = Math.PI): VehicleModel => ({
  key, url, length, rotation, title, credit: `${title} · Innerscene · CC0 · módosítva`, license: 'models/vehicle-bodies/LICENSE.md',
})
const forward = Math.PI / 2
const models: Record<string, VehicleModel> = {
  Sedan: road('renault-megane', megane, 4.63, forward, 'Renault Mégane', 'Mona x Supercars', ['Body']),
  Hatchback: road('vw-golf', golf, 4.29, -forward, 'Volkswagen Golf GTI', 'GT Cars: Hyperspeed', ['Meshesuntitleduniqueid1500011Mtl']),
  Estate: road('volkswagen-passat', passat, 4.77, -forward, 'Volkswagen Passat Variant', 'ANDREO12', ['Matte__FFC0C0C0__prim_env_9_spec']),
  Suv: road('toyota-rav4', rav4, 4.60, forward, 'Toyota RAV4', 'tonielpro520', ['Silver_Sky_Metallic']),
  Coupe: road('ford-mustang', mustang, 4.83, forward, 'Ford Mustang Shelby GT500', 'Jiaxing', ['carpaint']),
  Convertible: road('audi-tt', audi, 4.18, forward, 'Audi TT Roadster', 'razor24', ['varnish']),
  Minivan: road('kia-carnival', carnival, 5.13, -forward, 'Kia Carnival', 'Doz3', ['Meshescarnivalkcvl26211Mtl.005']),
  Van: road('fiat-ducato', ducato, 5.41, forward, 'Fiat Ducato', 'razor24', ['varnish']),
  Pickup: road('toyota-hilux', hilux, 5.26, forward, 'Toyota Hilux', 'David_Holiday', ['vpc_v1_006_carpaint_1']),
  Box: utility('box', box, 6.5, 'Dobozos teherautó'),
  ChassisCab: utility('chassis', chassis, 6.5, 'Alvázas teherautó'),
  Tipper: utility('tipper', tipper, 7.2, 'Billencs', 0),
}
const dusterModel = road('renault-duster', duster, 4.32, forward, 'Dacia / Renault Duster (2011)', 'razor24', ['varnish'])
const bmwModel = road('bmw-7-series-f01', bmw, 5.07, Math.PI, 'BMW 7-es (F01)', 'Black Snow', ['Body_Color'])
const sprinterModel = road('mercedes-benz-sprinter', sprinter, 5.93, forward, 'Mercedes-Benz Sprinter', 'Savelliy 07', ['Color_A01_1'])

export function vehicleModel(bodyType: string, vehicle?: { make: string; model: string }): VehicleModel {
  const body = Object.hasOwn(models, bodyType) ? models[bodyType] : undefined
  const make = vehicle?.make?.toLowerCase().replace(/[^a-z\d]/g, '') ?? ''
  const name = vehicle?.model ?? ''
  if ((!body || bodyType === 'Suv') && /^(dacia|renault)$/.test(make) && /\bduster\b/i.test(name)) return dusterModel
  if ((!body || bodyType === 'Van') && /^mercedes(benz)?$/.test(make) && /\bsprinter\b/i.test(name)) return sprinterModel
  if (!body && /\b(sprinter|ducato|crafter|transit|jumper|boxer)\b/i.test(name)) return models.Van
  if (bodyType === 'Sedan' && make === 'bmw') return bmwModel
  if (body) return body
  if (make === 'bmw') return /\b(?:x[1-7]|ix[1-3]?)\b/i.test(name) ? models.Suv : bmwModel
  return models.Sedan
}
