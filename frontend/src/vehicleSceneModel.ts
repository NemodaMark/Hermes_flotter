import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export type VehicleShape = { length: number; width: number; roof: number; frontAxle: number; rearAxle: number }

export function vehiclePixelRatio(width: number, height: number) {
  return Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(2_400_000 / (width * height)))
}

export function setVehiclePaint(model: T.Object3D, color: string, paintMaterials: readonly string[] = ['Paint 1', 'Paint 2']) {
  model.traverse(object => {
    if (!(object instanceof T.Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      // Only exterior paint changes; preserve clearcoat, normals, glass and cabin.
      if (!(material instanceof T.MeshStandardMaterial) || !paintMaterials.includes(material.name)) continue
      material.color.set(color)
      // Automotive paint is predominantly dielectric, with a separate glossy coat.
      if (!material.metalnessMap) material.metalness = Math.min(material.metalness, .28)
      if (!material.roughnessMap) material.roughness = T.MathUtils.clamp(material.roughness, .2, .38)
      if (material instanceof T.MeshPhysicalMaterial && !material.clearcoatMap) {
        material.clearcoat = Math.max(material.clearcoat, .6)
        material.clearcoatRoughness = Math.max(material.clearcoatRoughness, .17)
      }
    }
  })
}

function applyGarageMaterials(source: T.Group, paintMaterials: readonly string[]) {
  const prepared = new Map<T.Material, T.Material>()
  const neutralGlass = new T.Color('#263136')
  const finish = (original: T.Material) => {
    const existing = prepared.get(original)
    if (existing) return existing
    if (!(original instanceof T.MeshStandardMaterial)) return original
    let material = original
    if (paintMaterials.includes(original.name)) {
      if (!(original instanceof T.MeshPhysicalMaterial)) {
        const physical = new T.MeshPhysicalMaterial()
        const physicalDefines = physical.defines
        T.MeshStandardMaterial.prototype.copy.call(physical, original)
        physical.defines = physicalDefines
        material = physical
        original.dispose()
      }
      const enamel = material as T.MeshPhysicalMaterial
      enamel.metalness = .1
      enamel.roughness = .27
      enamel.clearcoat = .7
      enamel.clearcoatRoughness = .28
      enamel.envMapIntensity = .82
    } else {
      const name = material.name.toLowerCase()
      if (/glass|glazing|window|windshield|vpc_v1_006_13/.test(name) && !/light|lamp|lens|mirror/.test(name)) {
        material.color.copy(neutralGlass)
        material.roughness = .2
        material.metalness = 0
        material.envMapIntensity = .75
        if (material.transparent) {
          material.opacity = .52
          material.depthWrite = false
        }
      } else if (/tyre|tire|rubber/.test(name)) {
        material.roughness = .83
        material.metalness = 0
      } else if (/chrome|polished steel|rim/.test(name)) {
        material.roughness = Math.max(material.roughness, .28)
        material.envMapIntensity = .7
      }
    }
    if (material instanceof T.MeshPhysicalMaterial && material.transmission > 0) {
      // Smoked glazing retains the interior without a second full-scene render.
      material.transmission = 0
      material.transparent = true
      material.depthWrite = false
      material.opacity = Math.min(material.opacity, .68)
    }
    material.emissiveIntensity = 0
    prepared.set(original, material)
    return material
  }
  source.traverse(object => {
    if (!(object instanceof T.Mesh)) return
    object.material = Array.isArray(object.material) ? object.material.map(finish) : finish(object.material)
    object.castShadow = true
    object.receiveShadow = true
  })
}

export function prepareVehicleModel(source: T.Group, color: string, appearance: { rotation: number; length: number; paintMaterials?: readonly string[] } = { rotation: Math.PI / 2, length: 4.8 }): { model: T.Group; shape: VehicleShape } {
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
  applyGarageMaterials(source, appearance.paintMaterials ?? ['Paint 1', 'Paint 2'])
  setVehiclePaint(model, color, appearance.paintMaterials)
  model.updateMatrixWorld(true)
  return { model, shape: { length: appearance.length, width: size.z * scale, roof: size.y * scale + .025, frontAxle: appearance.length * .29, rearAxle: -appearance.length * .3 } }
}

export function batchVehicleMeshes(model: T.Group) {
  const buckets = new Map<string, T.Mesh<T.BufferGeometry, T.Material>[]>()
  const inverse = model.matrixWorld.clone().invert()
  const transform = new T.Matrix4()
  model.traverseVisible(object => {
    if (!(object instanceof T.Mesh) || object.children.length || object.userData.articulated || Array.isArray(object.material) || object.material.transparent || object.matrixWorld.determinant() < 0) return
    const { attributes, index } = object.geometry
    const layout = Object.keys(attributes).sort().map(name => {
      const attr = attributes[name]
      return `${name}:${attr.itemSize}:${attr.normalized}:${attr.array.constructor.name}`
    })
    const key = `${object.material.uuid}:${Boolean(index)}:${layout.join(',')}`
    const bucket = buckets.get(key) ?? []
    bucket.push(object)
    buckets.set(key, bucket)
  })
  for (const parts of buckets.values()) {
    if (parts.length < 2) continue
    const geometries = parts.map(part => {
      const geometry = part.geometry.clone()
      // Baking a node transform into quantized coordinates would round or clip them.
      for (const name of ['position', 'normal', 'tangent']) {
        const attribute = geometry.getAttribute(name)
        if (!attribute || attribute.array instanceof Float32Array) continue
        const data = new Float32Array(attribute.count * attribute.itemSize)
        for (let vertex = 0; vertex < attribute.count; vertex++) {
          for (let component = 0; component < attribute.itemSize; component++) {
            data[vertex * attribute.itemSize + component] = attribute.getComponent(vertex, component)
          }
        }
        geometry.setAttribute(name, new T.BufferAttribute(data, attribute.itemSize))
      }
      return geometry.applyMatrix4(transform.multiplyMatrices(inverse, part.matrixWorld))
    })
    const combined = mergeGeometries(geometries)
    geometries.forEach(geometry => geometry.dispose())
    if (!combined) continue
    const batch = new T.Mesh(combined, parts[0].material)
    batch.castShadow = batch.receiveShadow = true
    model.add(batch)
    // Keep the individual meshes for inexpensive bounds rejection on hotspot rays.
    parts.forEach(part => { part.visible = false })
  }
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

export function createContactShadow() {
  const width = 96, pixels = new Uint8Array(width * width * 4)
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const radius = Math.hypot((x + .5) / width * 2 - 1, (y + .5) / width * 2 - 1)
    const index = (y * width + x) * 4
    pixels.set([18, 29, 38, Math.round(85 * Math.max(0, 1 - radius ** 2) ** 2)], index)
  }
  const texture = new T.DataTexture(pixels, width, width)
  texture.magFilter = T.LinearFilter
  texture.needsUpdate = true
  const shadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = .012
  return shadow
}
