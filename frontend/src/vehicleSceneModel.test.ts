/// <reference types="node" />
import { beforeAll, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { Box3, BoxGeometry, Color, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { disposeVehicleModel, prepareVehicleModel, setVehiclePaint } from './vehicleSceneModel'

const bytes = readFileSync(resolve('src/assets/car-concept.glb'))
let source: Group
beforeAll(async () => {
  // Parse the actual shipped geometry and materials without a GPU or image
  // decoder. Browser QA separately checks the embedded textures and lighting.
  const loader = new GLTFLoader().register(() => ({ name: 'test_skip_image_decode', loadTexture: async () => new Texture() }))
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  source = (await loader.parseAsync(buffer, '')).scene
})
it('ships the pinned self-contained asset without logo textures or sample variants', () => {
  const json = JSON.parse(bytes.toString('utf8', 20, 20 + bytes.readUInt32LE(12)))
  const provenance = JSON.parse(readFileSync(resolve('public/models/khronos-car/source.json'), 'utf8'))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(provenance.preparedSha256)
  expect(json.asset.copyright).toContain('Eric Chadwick')
  expect(json.buffers).toHaveLength(1)
  expect(json.buffers[0].uri).toBeUndefined()
  expect(json.images.every((image: { bufferView?: number; uri?: string }) => image.bufferView !== undefined && !image.uri)).toBe(true)
  expect(json.materials.find((material: { name: string }) => material.name === 'License').pbrMetallicRoughness.baseColorTexture).toBeUndefined()
  expect(json.nodes.find((node: { name: string }) => node.name === 'InteriorSteeringEmblem').mesh).toBeUndefined()
  expect(json.extensionsUsed).not.toContain('KHR_materials_variants')
})
it('normalizes the real model to the floor, centers it and keeps passenger-car proportions', () => {
  const { model, shape } = prepareVehicleModel(source.clone(true), '#214d81')
  const bounds = new Box3().setFromObject(model, true)
  expect(bounds.min.y).toBeCloseTo(.025, 4)
  expect(bounds.max.x - bounds.min.x).toBeCloseTo(4.8, 4)
  expect(bounds.min.x + bounds.max.x).toBeCloseTo(0, 4)
  expect(bounds.min.z + bounds.max.z).toBeCloseTo(0, 4)
  // Bounds include mirrors and the source asset's steered front tires.
  expect(shape.width).toBeGreaterThan(1.5); expect(shape.width).toBeLessThan(3.2)
  expect(shape.roof).toBeGreaterThan(1); expect(shape.roof).toBeLessThan(1.7)
  expect(model.getObjectByName('BodyHood')).toBeDefined()
  expect(model.getObjectByName('BodyDoorLColor1')).toBeDefined()
})
it('recolors only the two exterior paints, retaining optical properties and all other materials', () => {
  const model = new Group()
  const paint = new MeshPhysicalMaterial({ color: '#ff0000', clearcoat: 1, metalness: .7, roughness: .25 }); paint.name = 'Paint 1'
  const secondary = paint.clone(); secondary.name = 'Paint 2'
  const glass = new MeshPhysicalMaterial({ color: '#112233', transmission: .8 }); glass.name = 'Glass'
  const cabin = new MeshStandardMaterial({ color: '#aa0000' }); cabin.name = 'Interior 3 Carmine'
  model.add(new Mesh(new BoxGeometry(), [paint, secondary, glass, cabin]))
  setVehiclePaint(model, '#214d81')
  expect(paint.color.getHexString()).toBe('214d81'); expect(secondary.color.getHexString()).toBe('214d81')
  expect(paint.clearcoat).toBe(1); expect(paint.roughness).toBe(.25); expect(paint.metalness).toBe(.7)
  expect(glass.color.equals(new Color('#112233'))).toBe(true); expect(glass.transmission).toBe(.8)
  expect(cabin.color.getHexString()).toBe('aa0000')
  setVehiclePaint(model, '#d5ae31')
  expect(paint.color.getHexString()).toBe('d5ae31')
  disposeVehicleModel(model)
})
it('releases shared geometry, material and image resources once when leaving the studio', () => {
  const image = { close: vi.fn() }, texture = new Texture(image), normal = new Texture(image), material = new MeshStandardMaterial({ map: texture, normalMap: normal }), geometry = new BoxGeometry()
  const model = new Group(); model.add(new Mesh(geometry, material), new Mesh(geometry, material))
  const disposeGeometry = vi.spyOn(geometry, 'dispose'), disposeMaterial = vi.spyOn(material, 'dispose'), disposeTexture = vi.spyOn(texture, 'dispose')
  disposeVehicleModel(model)
  expect(disposeGeometry).toHaveBeenCalledTimes(1); expect(disposeMaterial).toHaveBeenCalledTimes(1)
  expect(disposeTexture).toHaveBeenCalledTimes(1); expect(image.close).toHaveBeenCalledTimes(1)
})
