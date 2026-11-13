/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { Box3, Mesh, MeshStandardMaterial, Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { vehicleModel } from './vehicleModels'
import { bodyNames } from './vehicleAppearance'
import { disposeVehicleModel, prepareVehicleModel } from './vehicleSceneModel'
import { vehicleHotspots } from './vehicleHotspots'
import { Vector3 } from 'three'

const bodies = Object.keys(bodyNames).filter(body => !['Unknown', 'Other', 'Coupe'].includes(body))
const prepared = JSON.parse(readFileSync(resolve('public/models/vehicle-bodies/prepared.json'), 'utf8')) as { key: string; sha256: string }[]
const studio = JSON.parse(readFileSync(resolve('public/models/studio/sources.json'), 'utf8')) as { key: string; sha256: string }[]
it('selects a different asset for every known body instead of reusing the sports coupe', () => {
  const selected = [...bodies, 'Coupe'].map(body => vehicleModel(body))
  expect(new Set(selected.map(model => model.url)).size).toBe(12)
  expect(vehicleModel('Unknown').fallback).toBe(true)
  expect(vehicleModel('Other').fallback).toBe(true)
  expect(vehicleModel('FutureBodyType').fallback).toBe(true)
})
it.each([...bodies, 'Unknown'])('loads and paints the real %s body with valid ground-level proportions', async body => {
  const appearance = vehicleModel(body), bytes = readFileSync(resolve(`src/assets/vehicles/${appearance.key}.glb`))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe([...prepared, ...studio].find(asset => asset.key === appearance.key)?.sha256)
  const doc = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
  expect(doc.buffers).toHaveLength(1)
  expect(doc.buffers[0].uri).toBeUndefined()
  expect((doc.images ?? []).every((image: { bufferView?: number; uri?: string }) => image.bufferView !== undefined && !image.uri)).toBe(true)
  const loader = new GLTFLoader().register(() => ({ name: 'skip_test_image_decode', loadTexture: async () => new Texture() }))
  const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes)
  const { model, shape } = prepareVehicleModel((await loader.parseAsync(buffer, '')).scene, '#214d81', appearance)
  const bounds = new Box3().setFromObject(model, true)
  expect(bounds.min.y).toBeCloseTo(.025, 4)
  expect(bounds.max.x - bounds.min.x).toBeCloseTo(appearance.length, 4)
  expect(bounds.min.x + bounds.max.x).toBeCloseTo(0, 4)
  expect(bounds.min.z + bounds.max.z).toBeCloseTo(0, 4)
  expect(shape.width).toBeGreaterThan(1.5); expect(shape.width).toBeLessThan(3)
  expect(shape.roof).toBeGreaterThan(body === 'Convertible' ? 1 : 1.3)
  expect(shape.roof).toBeLessThan(3.5)
  if (['Van', 'Box', 'Tipper', 'ChassisCab'].includes(body)) expect(shape.roof).toBeGreaterThan(2)
  if (body === 'Estate') expect(shape.roof).toBeLessThan(1.7)
  let painted = 0, glass = 0
  model.traverse(object => {
    if (!(object instanceof Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof MeshStandardMaterial)) continue
      if ((appearance.paintMaterials ?? ['Paint 1']).includes(material.name)) { painted++; expect(material.color.getHexString()).toBe('214d81'); expect(material.map).toBeNull() }
      if (/glass|glazing/i.test(material.name)) { glass++; expect(material.color.getHexString()).not.toBe('214d81') }
    }
  })
  expect(painted).toBeGreaterThan(0); expect(glass).toBeGreaterThan(0)
  const hotspots = vehicleHotspots(model, shape.length)
  const door = hotspots.anchor(new Vector3(-shape.length * .08, shape.roof * .5, shape.width * .44), new Vector3(0, 0, 1))
  expect(hotspots.visible(door, door.point.clone().add(new Vector3(0, 0, 5)))).toBe(true)
  expect(hotspots.visible(door, door.point.clone().add(new Vector3(0, 0, -5)))).toBe(false)
  if (body === 'ChassisCab') {
    let enclosure = false
    model.traverse(object => { if (object instanceof Mesh && /freight_box/.test(object.name)) enclosure = true })
    expect(enclosure).toBe(false)
  }
  disposeVehicleModel(model)
})
