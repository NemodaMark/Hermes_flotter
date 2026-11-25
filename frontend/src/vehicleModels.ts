import bmw from './assets/vehicles/bmw-7-series-f01.glb?url'
import golf from './assets/vehicles/vw-golf.glb?url'
import mustang from './assets/vehicles/ford-mustang.glb?url'
import ducato from './assets/vehicles/fiat-ducato.glb?url'
import sprinter from './assets/vehicles/mercedes-benz-sprinter.glb?url'
import corolla from './assets/vehicles/toyota-corolla-2014.glb?url'
import volvo from './assets/vehicles/volvo-v60-polestar-2013.glb?url'
import tucson from './assets/vehicles/hyundai-tucson-2015.glb?url'
import duster from './assets/vehicles/dacia-duster-2010.glb?url'
import nissan from './assets/vehicles/nissan-350z-2003.glb?url'
import audi from './assets/vehicles/audi-tt-2014-roadster.glb?url'
import delica from './assets/vehicles/mitsubishi-delica-1986.glb?url'
import hummer from './assets/vehicles/gmc-hummer-2021.glb?url'
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
const openX = (key: string, url: string, length: number, title: string, author: string): VehicleModel => ({
  key, url, length, rotation: 0, title, paintMaterials: ['Body'],
  credit: `${title} · ${author} / OpenX Assets · CC BY 4.0 + MPL 2.0`, license: 'models/openx/LICENSE.md',
})
const utility = (key: string, url: string, length: number, title: string, rotation = Math.PI): VehicleModel => ({
  key, url, length, rotation, title, credit: `${title} · Innerscene · CC0 · módosítva`, license: 'models/vehicle-bodies/LICENSE.md',
})
const forward = Math.PI / 2
const models: Record<string, VehicleModel> = {
  Sedan: openX('toyota-corolla-2014', corolla, 4.61, 'Toyota Corolla', 'Armored Wave'),
  Hatchback: road('vw-golf', golf, 4.29, -forward, 'Volkswagen Golf GTI', 'GT Cars: Hyperspeed', ['Meshesuntitleduniqueid1500011Mtl']),
  Estate: openX('volvo-v60-polestar-2013', volvo, 4.68, 'Volvo V60 Polestar', 'myedsu'),
  Suv: openX('hyundai-tucson-2015', tucson, 4.54, 'Hyundai Tucson', 'razor24'),
  Coupe: openX('nissan-350z-2003', nissan, 4.35, 'Nissan 350Z', 'Blue3D'),
  Convertible: openX('audi-tt-2014-roadster', audi, 4.18, 'Audi TT Roadster', 'razor24'),
  Minivan: openX('mitsubishi-delica-1986', delica, 4.32, 'Mitsubishi Delica', 'kekomag'),
  Van: road('fiat-ducato', ducato, 5.41, forward, 'Fiat Ducato', 'razor24', ['varnish']),
  Pickup: openX('gmc-hummer-2021', hummer, 5.52, 'GMC Hummer EV', 'Ajay Gawde'),
  Box: utility('box', box, 6.5, 'Dobozos teherautó'),
  ChassisCab: utility('chassis', chassis, 6.5, 'Alvázas teherautó'),
  Tipper: utility('tipper', tipper, 7.2, 'Billencs', 0),
}
const dusterModel = openX('dacia-duster-2010', duster, 4.33, 'Dacia / Renault Duster', 'razor24')
const mustangModel = road('ford-mustang', mustang, 4.83, forward, 'Ford Mustang Shelby GT500', 'Jiaxing', ['carpaint'])
const bmwModel = road('bmw-7-series-f01', bmw, 5.07, Math.PI, 'BMW 7-es (F01)', 'Black Snow', ['Body_Color'])
const sprinterModel = road('mercedes-benz-sprinter', sprinter, 5.93, forward, 'Mercedes-Benz Sprinter', 'Savelliy 07', ['Color_A01_1'])

export function vehicleModel(bodyType: string, vehicle?: { make: string; model: string }): VehicleModel {
  const body = Object.hasOwn(models, bodyType) ? models[bodyType] : undefined
  const make = vehicle?.make?.toLowerCase().replace(/[^a-z\d]/g, '') ?? ''
  const name = vehicle?.model ?? ''
  if ((!body || bodyType === 'Suv') && /^(dacia|renault)$/.test(make) && /\bduster\b/i.test(name)) return dusterModel
  if ((!body || bodyType === 'Coupe') && make === 'ford' && /\bmustang\b/i.test(name)) return mustangModel
  if ((!body || bodyType === 'Van') && /^mercedes(benz)?$/.test(make) && /\bsprinter\b/i.test(name)) return sprinterModel
  if (!body && /\b(sprinter|ducato|crafter|transit|jumper|boxer)\b/i.test(name)) return models.Van
  if (bodyType === 'Sedan' && make === 'bmw') return bmwModel
  if (body) return body
  if (make === 'bmw') return /\b(?:x[1-7]|ix[1-3]?)\b/i.test(name) ? models.Suv : bmwModel
  return models.Sedan
}
