import * as T from 'three'
import { createGarageSurfaceTexture } from './studioGarageScene'

export function parkingLighting(hour: number) {
  if (hour >= 7 && hour < 17) return { name: 'Nappal', sky: '#a5b4b4', light: '#fff5dc', intensity: 2.1, ambient: 1.7, lamps: false }
  if (hour >= 5 && hour < 7) return { name: 'Hajnal', sky: '#65767d', light: '#ffd5ac', intensity: 1.6, ambient: .9, lamps: true }
  if (hour >= 17 && hour < 20) return { name: 'Alkonyat', sky: '#59615f', light: '#ffce9f', intensity: 1.5, ambient: .8, lamps: true }
  return { name: 'Éjszaka', sky: '#141e23', light: '#dceaf2', intensity: .5, ambient: .25, lamps: true }
}

export function buildParkingLot(count: number, hour: number) {
  const group = new T.Group(), palette = parkingLighting(hour)
  const concrete = new T.MeshStandardMaterial({ color: '#77796f', roughness: .95 })
  const metal = new T.MeshStandardMaterial({ color: '#343e39', roughness: .72 })
  const paint = new T.MeshStandardMaterial({ color: '#cfbc8d', roughness: .9 })
  const texture = createGarageSurfaceTexture(); texture.repeat.set(6, 6)
  concrete.map = concrete.bumpMap = texture; concrete.bumpScale = .025
  const asphalt = new T.MeshStandardMaterial({ color: '#444c49', roughness: .98, map: texture, bumpMap: texture, bumpScale: .035 })
  const glass = new T.MeshStandardMaterial({ color: palette.lamps ? '#a99c7a' : '#596b6c', roughness: .35,
    emissive: palette.lamps ? '#c7ac78' : '#000', emissiveIntensity: palette.lamps ? .35 : 0 })
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: T.Material = concrete) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); group.add(mesh); return mesh
  }
  const span = count * 3.7
  box(0, -.07, 0, 80, .1, 80, asphalt)
  box(0, .08, -4.1, span + 8, .18, .3)
  box(0, 2.4, -7.7, span + 8, 4.8, 4.4)
  box(0, .8, -5.45, span + 8, 1.3, .12, metal)
  box(0, 4.8, -5.5, span + 8.3, .18, .4, metal)
  const marks = new T.InstancedMesh(new T.BoxGeometry(.065, .012, 6.5), paint, count + 1)
  const matrix = new T.Matrix4()
  for (let i = 0; i <= count; i++) { matrix.makeTranslation((i - count / 2) * 3.7, .002, .15); marks.setMatrixAt(i, matrix) }
  group.add(marks)
  const windows = new T.InstancedMesh(new T.BoxGeometry(.8, 1.1, .04), glass, count * 3)
  const frames = new T.InstancedMesh(new T.BoxGeometry(.94, 1.24, .15), metal, count * 3)
  for (let i = 0; i < count * 3; i++) {
    const x = (i - (count * 3 - 1) / 2) * 1.12
    matrix.makeTranslation(x, 2.9, -5.54); frames.setMatrixAt(i, matrix)
    matrix.makeTranslation(x, 2.9, -5.46); windows.setMatrixAt(i, matrix)
  }
  group.add(windows, frames)
  for (const x of [-span / 2 - .9, span / 2 + .9]) box(x, .08, .2, .18, .18, 8.5)
  const lamp = new T.MeshBasicMaterial({ color: palette.lamps ? '#ffe6bb' : '#98a69e' })
  for (const x of [-span / 2 - 1.4, span / 2 + 1.4]) {
    box(x, 2.3, -3.6, .12, 4.6, .12, metal); box(x - .3, 4.6, -3.6, .75, .1, .4, metal)
    box(x - .3, 4.53, -3.6, .6, .035, .3, lamp)
    if (palette.lamps) { const light = new T.PointLight('#ffe4b1', 10, 12, 2); light.position.set(x - .3, 4.45, -3.6); group.add(light) }
  }
  return group
}
