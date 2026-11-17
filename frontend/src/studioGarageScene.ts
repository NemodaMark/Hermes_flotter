import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

function concreteTexture() {
  const size = 128
  const pixels = new Uint8Array(size * size * 4)
  let seed = 983
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      const grain = (seed >>> 26) / 5
      const marks = 4 * Math.sin(x * .31 + y * .24) + 3 * Math.sin(x * .14 - y * .19)
      const gray = Math.round(220 + marks - grain)
      pixels.set([gray, gray, gray - 3, 255], (y * size + x) * 4)
    }
  }
  const texture = new T.DataTexture(pixels, size, size)
  texture.colorSpace = T.SRGBColorSpace
  texture.wrapS = texture.wrapT = T.RepeatWrapping
  texture.repeat.set(12, 12)
  texture.magFilter = T.LinearFilter
  texture.minFilter = T.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.needsUpdate = true
  return texture
}

export function buildStudioGarage(scale: number) {
  const garage = new T.Group()
  garage.scale.setScalar(scale)
  const material = (color: string, roughness = .8, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness })
  const concrete = material('#5b5148', .86)
  concrete.map = concreteTexture()
  concrete.envMapIntensity = .4
  const wall = material('#83796c')
  const wainscot = material('#454b45')
  const steel = material('#393b38', .65, .22)
  const track = material('#615a50', .65, .28)
  const shutter = material('#595750', .7, .22)
  const painted = material('#bca580', .76)
  const seam = new T.MeshBasicMaterial({ color: '#605650' })
  const tube = new T.MeshBasicMaterial({ color: '#f3d4a3' })
  const box = (w: number, h: number, d: number, surface: T.Material, x = 0, y = 0, z = 0) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), surface)
    mesh.position.set(x, y, z)
    garage.add(mesh)
    return mesh
  }
  box(34, .12, 34, concrete, 0, -.06)
  for (let position = -16; position <= 16; position += 4) {
    box(33, .003, .016, seam, 0, .001, position)
    box(.016, .003, 33, seam, position, .001)
  }
  for (const x of [-3.75, 3.75]) {
    for (const z of [-2.4, 2.4]) {
      box(1.43, .006, .045, painted, x - Math.sign(x) * .68, .003, z)
      box(.045, .006, 1.03, painted, x, .003, z - Math.sign(z) * .47)
    }
  }
  box(34, .3, 34, steel, 0, 14)
  for (const z of [-12, -6, 0, 6, 12]) {
    box(34, .35, .28, track, 0, 13.8, z)
    for (const x of [-8, 0, 8]) {
      box(3.6, .17, .3, steel, x, 12.65, z)
      box(3.3, .08, .17, tube, x, 12.54, z)
    }
  }

  for (let index = 0; index < 4; index++) {
    const start = garage.children.length
    box(33.5, 14, .3, wall, 0, 7, -16.7)
    box(33.5, 2, .15, wainscot, 0, 1, -16.45)
    box(33.5, .09, .2, track, 0, 2.01, -16.36)
    for (const x of [-12.5, -6.25, 0, 6.25, 12.5]) {
      box(.36, 14, .54, steel, x, 7, -16.26)
      box(.1, 2.8, .11, tube, x + .29, 4.4, -16.29)
    }
    for (const center of [-9.4, 3.12, 9.4]) {
      box(4.8, 4.85, .26, track, center, 2.425, -16.30)
      box(4.48, 4.6, .25, shutter, center, 2.3, -16.15)
      for (let y = .25; y < 4.6; y += .36)
        box(4.48, .042, .09, track, center, y, -15.97)
    }
    box(4.84, 1.11, .87, steel, -3.125, .55, -15.72)
    box(5.0, .16, 1.05, track, -3.125, 1.16, -15.7)
    for (const x of [-4.61, -3.125, -1.61]) {
      box(1.26, 1.1, .19, steel, x, 2.79, -16.26)
      box(1.04, .095, .24, track, x, 2.41, -16.09)
    }
    const angle = index * Math.PI / 2
    const vertical = new T.Vector3(0, 1, 0)
    for (const mesh of garage.children.slice(start)) {
      mesh.position.applyAxisAngle(vertical, angle)
      mesh.rotation.y = angle
    }
  }
  // The orbit only needs one draw call per surface, including on mobile.
  const surfaces = new Map<T.Material, T.BufferGeometry[]>()
  for (const mesh of garage.children as T.Mesh<T.BufferGeometry, T.Material>[]) {
    mesh.updateMatrix()
    mesh.geometry.applyMatrix4(mesh.matrix)
    const parts = surfaces.get(mesh.material) ?? []
    parts.push(mesh.geometry)
    surfaces.set(mesh.material, parts)
  }
  garage.clear()
  for (const [surface, parts] of surfaces) {
    const mesh = new T.Mesh(mergeGeometries(parts)!, surface)
    mesh.receiveShadow = surface === concrete
    garage.add(mesh)
    parts.forEach(part => part.dispose())
  }
  return garage
}
