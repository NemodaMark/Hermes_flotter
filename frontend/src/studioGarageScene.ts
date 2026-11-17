import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

function surfaceTexture() {
  const size = 256
  const pixels = new Uint8Array(size * size * 4)
  // Each frequency tiles at the texture boundary, including its interpolated edges.
  const mottling = (x: number, y: number, frequency: number) => {
    const hash = (col: number, row: number) => {
      const key = Math.imul(col % frequency + 31, 1597334677) ^ Math.imul(row % frequency + 83, 3812015801)
      return (Math.imul(key ^ (key >>> 16), 2246822519) >>> 0) / 4294967295
    }
    const col = Math.floor(x * frequency), row = Math.floor(y * frequency)
    const smooth = (n: number) => n * n * (3 - 2 * n)
    const u = smooth(x * frequency - col), v = smooth(y * frequency - row)
    return T.MathUtils.lerp(T.MathUtils.lerp(hash(col, row), hash(col + 1, row), u),
      T.MathUtils.lerp(hash(col, row + 1), hash(col + 1, row + 1), u), v)
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size
      const level = 177 + mottling(u, v, 5) * 28 + mottling(u, v, 28) * 17 + mottling(u, v, 256) * 25
      pixels.set([level, level, level, 255], (y * size + x) * 4)
    }
  }
  const texture = new T.DataTexture(pixels, size, size)
  texture.wrapS = texture.wrapT = T.RepeatWrapping
  texture.magFilter = T.LinearFilter
  texture.minFilter = T.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

export function buildStudioGarage(scale: number) {
  const garage = new T.Group()
  garage.scale.setScalar(scale)
  const material = (color: string, roughness = .75, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness })
  const floor = material('#454a45', .47, .13)
  const concrete = material('#4c504d', .87)
  const texture = surfaceTexture()
  texture.repeat.set(8, 8)
  floor.map = texture
  floor.roughnessMap = texture
  floor.bumpMap = texture
  floor.bumpScale = .027
  floor.envMapIntensity = .34
  concrete.bumpMap = texture
  concrete.map = texture
  concrete.bumpScale = .035
  const steel = material('#202725', .64, .27)
  const zinc = material('#565c55', .52, .42)
  const shutter = material('#323a38', .55, .28)
  const joints = material('#242927')
  const paint = material('#c5a15d', .77)
  const rubber = material('#30322e', .95)
  const lamp = new T.MeshBasicMaterial({ color: '#fff0ce', toneMapped: false })

  const surfaces = new Map<T.Material, T.BufferGeometry[]>()
  const box = (w: number, h: number, d: number, surface: T.Material, x = 0, y = 0, z = 0, yaw = 0) => {
    const geometry = new T.BoxGeometry(w, h, d)
    geometry.translate(x, y, z)
    if (yaw) geometry.rotateY(yaw)
    const parts = surfaces.get(surface) ?? []
    parts.push(geometry)
    surfaces.set(surface, parts)
  }

  box(41, .12, 41, floor, 0, -.06)
  for (let offset = -15; offset <= 15; offset += 5) {
    box(40, .006, .019, joints, 0, .001, offset)
    box(.019, .006, 40, joints, offset, .001)
  }
  for (const x of [-3.8, 3.8]) {
    for (const z of [-2.3, 2.3]) {
      box(1.03, .007, .049, paint, x - Math.sign(x) * .51, .006, z)
      box(.049, .007, .72, paint, x, .006, z - Math.sign(z) * .34)
    }
  }
  for (const z of [-6, 6]) {
    box(22, .007, .16, joints, 0, .004, z)
    for (let x = -10.8; x < 10.9; x += .27) box(.08, .008, .134, zinc, x, .006, z)
  }

  box(41, .3, 41, steel, 0, 10.45)
  for (const offset of [-14, -7, 0, 7, 14]) box(.26, .4, 40, zinc, offset, 10.14)
  for (const x of [-9, 0, 9]) for (const z of [-10, -3, 3, 10]) {
    box(.052, 1.1, .05, zinc, x - 1.9, 9.5, z)
    box(.052, 1.1, .05, zinc, x + 1.9, 9.5, z)
    box(4.34, .13, .36, steel, x, 8.93, z)
    box(4.12, .04, .23, lamp, x, 8.85, z)
  }

  for (let side = 0; side < 4; side++) {
    const yaw = side * Math.PI / 2
    const wall = (w: number, h: number, d: number, surface: T.Material, x: number, y: number, z: number) => box(w, h, d, surface, x, y, z, yaw)
    wall(40.4, 10.4, .4, concrete, 0, 5.2, -20.1)
    wall(40.4, .3, .3, joints, 0, .15, -19.8)
    wall(40.4, .12, .18, zinc, 0, 5.3, -19.82)
    wall(40.4, .045, .2, zinc, 0, 1.45, -19.81)
    for (const x of [-17.5, -10.5, -3.5, 3.5, 10.5, 17.5]) {
      wall(.25, 10.4, .55, steel, x, 5.2, -19.75)
      wall(.32, .95, .69, rubber, x, .475, -19.63)
      wall(.29, .08, .7, paint, x, .83, -19.62)
    }
    for (const x of [-2.85, 2.85]) {
      wall(.25, 2.9, .27, steel, x, 3.2, -19.7)
      wall(.053, 2.75, .08, lamp, x, 3.2, -19.52)
    }
    const shutterCenter = side % 2 === 0 ? -7 : 7
    for (const center of [shutterCenter, -shutterCenter * 2]) {
      wall(5.98, 4.85, .58, steel, center, 2.425, -19.7)
      wall(5.65, 4.63, .61, shutter, center, 2.315, -19.68)
      for (let y = .23; y < 4.62; y += .19) wall(5.64, .016, .055, joints, center, y, -19.345)
      for (const x of [-2.85, 2.85]) wall(.1, 4.72, .12, zinc, center + x, 2.36, -19.37)
      wall(2.1, .085, .14, lamp, center, 5.19, -19.61)
    }
    for (const offset of [-2.5, 0, 2.5]) {
      const x = -shutterCenter + offset
      wall(2.39, 1.44, .62, shutter, x, .85, -18.94)
      wall(2.33, .11, .76, zinc, x, 1.58, -18.91)
      wall(2.34, 1.45, .19, steel, x, 2.73, -19.44)
      for (const y of [.35, .62, .89, 1.16]) wall(1.88, .037, .08, zinc, x, y, -18.6)
    }
    wall(6.9, .07, .1, lamp, -shutterCenter, 3.78, -19.3)
  }

  for (const [surface, parts] of surfaces) {
    const mesh = new T.Mesh(mergeGeometries(parts)!, surface)
    mesh.receiveShadow = surface === floor
    garage.add(mesh)
    parts.forEach(part => part.dispose())
  }
  return garage
}
