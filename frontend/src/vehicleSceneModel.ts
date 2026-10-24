import * as T from 'three'

export type VehicleShape = { length: number; width: number; roof: number; frontAxle: number; rearAxle: number }

export function setVehiclePaint(model: T.Object3D, color: string) {
  model.traverse(object => {
    if (!(object instanceof T.Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      // Only exterior paint changes; preserve clearcoat, normals, glass and cabin.
      if (material instanceof T.MeshStandardMaterial && /^Paint [12]$/.test(material.name)) material.color.set(color)
    }
  })
}

export function prepareVehicleModel(source: T.Group, color: string, appearance = { rotation: Math.PI / 2, length: 4.8 }): { model: T.Group; shape: VehicleShape } {
  const model = new T.Group()
  model.name = 'HermesVehicle'
  // Assets have different forward axes; the studio always uses +X.
  source.rotation.y = appearance.rotation
  model.add(source)
  const bounds = new T.Box3().setFromObject(model, true), size = bounds.getSize(new T.Vector3())
  if (bounds.isEmpty() || !Number.isFinite(size.x) || size.x <= 0) throw new Error('A járműmodell geometriája érvénytelen.')
  const scale = appearance.length / size.x, center = bounds.getCenter(new T.Vector3())
  model.scale.setScalar(scale)
  model.position.set(-center.x * scale, -bounds.min.y * scale + .025, -center.z * scale)
  model.traverse(object => { if (object instanceof T.Mesh) { object.castShadow = true; object.receiveShadow = true } })
  setVehiclePaint(model, color)
  model.updateMatrixWorld(true)
  return { model, shape: { length: appearance.length, width: size.z * scale, roof: size.y * scale + .025, frontAxle: appearance.length * .29, rearAxle: -appearance.length * .3 } }
}

export function disposeVehicleModel(model: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>(), textures = new Set<T.Texture>()
  const images = new Set<{ close: () => void }>()
  model.traverse(object => {
    if (!(object instanceof T.Mesh || object instanceof T.Line)) return
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof T.Texture) textures.add(value)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
  for (const texture of textures) {
    texture.dispose()
    const image = texture.image as { close?: () => void } | undefined
    if (typeof image?.close === 'function') images.add(image as { close: () => void })
  }
  for (const image of images) image.close()
}
