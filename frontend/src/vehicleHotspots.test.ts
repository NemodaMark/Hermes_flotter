import { expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, Vector3 } from 'three'
import { vehicleHotspots } from './vehicleHotspots'

function body() {
  const model = new Group()
  const mesh = new Mesh(new BoxGeometry(4, 2, 2), new MeshPhysicalMaterial())
  mesh.position.y = 1; model.add(mesh); model.updateMatrixWorld(true)
  return { model, mesh }
}
it('places an interior seed on the outer surface and hides it from the opposite side', () => {
  const { model } = body(), hotspots = vehicleHotspots(model, 4)
  const point = hotspots.anchor(new Vector3(0, 1, 0), new Vector3(0, 0, 1))
  expect(point.point.z).toBeGreaterThan(1)
  expect(hotspots.visible(point, new Vector3(0, 1, 6))).toBe(true)
  expect(hotspots.visible(point, new Vector3(0, 1, -6))).toBe(false)
  // Grazing views must not leave a floating line along the body silhouette.
  expect(hotspots.visible(point, new Vector3(6, 1, point.point.z))).toBe(false)
})
it('hides a forward-facing point when another part of the vehicle occludes it', () => {
  const { model } = body()
  const pillar = new Mesh(new BoxGeometry(.5, 3, .4), new MeshPhysicalMaterial())
  pillar.position.set(1.5, 1.5, 2.5); model.add(pillar); model.updateMatrixWorld(true)
  const hotspots = vehicleHotspots(model, 4), point = hotspots.anchor(new Vector3(0, 1, 0), new Vector3(0, 0, 1))
  expect(hotspots.visible(point, new Vector3(0, 1, 6))).toBe(true)
  expect(hotspots.visible(point, new Vector3(3, 1, 4))).toBe(false)
  expect(hotspots.visible(point, new Vector3(-3, 1, 4))).toBe(true)
})
it('keeps roof points visible from above and does not show far-side points through glazing', () => {
  const { model, mesh } = body()
  mesh.material = new MeshPhysicalMaterial({ transparent: true, opacity: .3, transmission: 1 })
  const hotspots = vehicleHotspots(model, 4)
  const roof = hotspots.anchor(new Vector3(0, 1, 0), new Vector3(0, 1, 0))
  expect(hotspots.visible(roof, new Vector3(0, 5, 5))).toBe(true)
  expect(hotspots.visible(roof, new Vector3(0, 5, -5))).toBe(true)
  const side = hotspots.anchor(new Vector3(0, 1, 0), new Vector3(0, 0, 1))
  expect(hotspots.visible(side, new Vector3(0, 2, -5))).toBe(false)
})
