import * as T from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { createGarageSurfaceTexture } from './studioGarageScene'

export function parkingLighting(hour: number) {
  if (hour >= 7 && hour < 17) return { name: 'Nappal', sky: '#676d69', light: '#fff3de', intensity: 2.1, ambient: 1.45, lamps: false }
  if (hour >= 5 && hour < 7) return { name: 'Hajnal', sky: '#414d53', light: '#ffd5ac', intensity: 1.7, ambient: .95, lamps: true }
  if (hour >= 17 && hour < 20) return { name: 'Alkonyat', sky: '#484641', light: '#ffce9f', intensity: 1.6, ambient: .85, lamps: true }
  return { name: 'Éjszaka', sky: '#171e21', light: '#dceaf2', intensity: 1.1, ambient: .65, lamps: true }
}

// Models face +X after preparation; -45° points their nose towards the aisle (+Z).
// Use the same positions and angle for the cars and their bay markings.
export function parkingLayout(count: number) {
  const pitch = 4.4, yaw = -Math.PI / 4
  return { yaw, width: Math.max(8, (count - 1) * pitch + 7.4),
    positions: Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * pitch) }
}

export function buildParkingLot(count: number, hour: number) {
  const group = new T.Group(), palette = parkingLighting(hour), layout = parkingLayout(count)
  group.name = 'HermesParkingGarage'
  const material = (color: string, roughness = .8, metalness = 0) => new T.MeshStandardMaterial({ color, roughness, metalness })
  const floor = material('#666b65', .68, .08), concrete = material('#827a66'), wood = material('#574633')
  const steel = material('#2d3733', .55, .35), joints = material('#363e39'), zinc = material('#83867a', .42, .5)
  const paint = material('#d3bf8d'), rubber = material('#282b27', .96), cardboard = material('#806747')
  const texture = createGarageSurfaceTexture(); texture.repeat.set(7, 7)
  floor.map = floor.bumpMap = texture; floor.bumpScale = .023; floor.envMapIntensity = .35
  const plaster = texture.clone(); plaster.repeat.set(4, 2)
  concrete.map = concrete.bumpMap = plaster; concrete.bumpScale = .045
  const timber = texture.clone(); timber.repeat.set(1, 8)
  wood.map = wood.bumpMap = timber; wood.bumpScale = .025
  const lamp = new T.MeshBasicMaterial({ color: palette.lamps ? '#ffe5ba' : '#fff0d3', toneMapped: false })
  // Merge architecture by material: detail adds geometry, not draw calls.
  const surfaces = new Map<T.Material, T.BufferGeometry[]>()
  const add = (geometry: T.BufferGeometry, surface: T.Material, x: number, y: number, z: number, yaw = 0) => {
    geometry.rotateY(yaw); geometry.translate(x, y, z)
    const parts = surfaces.get(surface) ?? []; parts.push(geometry); surfaces.set(surface, parts)
  }
  const box = (w: number, h: number, d: number, surface: T.Material, x: number, y: number, z: number, yaw = 0) =>
    add(new T.BoxGeometry(w, h, d), surface, x, y, z, yaw)
  const width = layout.width + 8, edge = width / 2, rear = -6.2
  box(100, .12, 100, floor, 0, -.065, 0)
  for (let x = -40; x <= 40; x += 4) box(.014, .004, 90, joints, x, .001, 0)
  for (let z = -40; z <= 40; z += 4) box(90, .004, .014, joints, 0, .001, z)
  box(width, 5.6, .28, concrete, 0, 2.8, rear)
  box(width, .6, .12, steel, 0, .3, rear + .18)
  box(width, .12, .16, zinc, 0, 1.18, rear + .2)
  // Timber fascia and exposed beams echo the entrance garage.
  for (let y = 4.5; y < 5.7; y += .21) box(width, .18, .13, wood, 0, y, rear + .22)
  box(width, .24, 18, steel, 0, 5.8, -1.8)
  for (const z of [-5.5, -.8, 4]) box(width, .3, .22, steel, 0, 5.6, z)
  for (const x of [-edge + .25, edge - .25]) {
    box(.28, 5.6, 14, concrete, x, 2.8, .6)
    box(.22, 5.6, .3, steel, x, 2.8, 5)
    box(.34, .9, .4, rubber, x, .45, 5)
    for (let y = .2; y < 1; y += .3) box(.36, .11, .42, paint, x, y, 5)
  }
  for (const x of layout.positions) {
    box(3.6, 3.5, .12, steel, x, 2, rear + .23)
    for (let y = .42; y < 3.7; y += .22) box(3.37, .19, .06, zinc, x, y, rear + .32)
    for (const offset of [-1.76, 1.76]) box(.1, 3.8, .17, steel, x + offset, 2, rear + .36)
    box(.48, .06, .1, steel, x, .88, rear + .41)
    box(2.7, .12, .4, steel, x, 5.25, -.4)
    box(2.5, .04, .28, lamp, x, 5.17, -.4)
    for (const offset of [-1.2, 1.2]) box(.035, .42, .035, zinc, x + offset, 5.48, -.4)
    // A 7.4 m bay accommodates long vans; perpendicular clearance exceeds 3 m.
    const bay = (along: number, across: number, w: number, d: number, surface = paint, height = .012) => {
      const dx = along * Math.cos(layout.yaw) + across * Math.sin(layout.yaw)
      const dz = -along * Math.sin(layout.yaw) + across * Math.cos(layout.yaw)
      box(w, height, d, surface, x + dx, height / 2 + .004, dz, layout.yaw)
    }
    for (const side of [-1.5, 1.5]) bay(0, side, 7.4, .065)
    bay(-3.65, 0, .065, 3)
    bay(-3.05, 0, .18, 1.9, rubber, .12)
    for (const offset of [-.55, .55]) bay(-3.05, offset, .19, .16, paint, .125)
  }
  // Storage, workbenches and fittings remain outside the parking envelope.
  for (const side of [-1, 1]) {
    const x = side * (edge - .7)
    const windowX = side * (edge - 2)
    const glass = material(palette.lamps ? '#716f59' : '#687c7c', .35, .12)
    box(2.55, 1.65, .12, steel, windowX, 2.9, rear + .22)
    box(2.3, 1.4, .03, glass, windowX, 2.9, rear + .3)
    box(.06, 1.4, .04, zinc, windowX, 2.9, rear + .33)
    box(2.3, .06, .04, zinc, windowX, 2.9, rear + .33)
    box(2.7, .08, .4, zinc, windowX, 2.05, rear + .4)
    box(2.7, .09, .85, wood, windowX, 1, rear + .7)
    for (const offset of [-1.15, 1.15]) box(.075, 1, .075, steel, windowX + offset, .5, rear + 1)
    for (const z of [-4, -.5, 3]) box(.09, 3.5, .09, steel, x, 1.75, z)
    for (let y = .55; y < 3.5; y += .82) {
      box(1, .07, 7.2, wood, x, y, -.5)
      for (const [i, z] of [-3.2, -1, 1.7].entries()) {
        box(.58, .32 + i * .06, .65, cardboard, x, y + .2, z)
        box(.012, .1, .18, zinc, x - side * .3, y + .2, z)
      }
    }
    box(1.6, .1, 2, wood, side * (edge - 1.15), 1, 5.5)
    for (const z of [4.7, 6.3]) box(.07, 1, .07, steel, side * (edge - 1.65), .5, z)
    add(new T.CylinderGeometry(.34, .34, .83, 16), steel, side * (edge - 1.3), .43, -4.8)
    for (const y of [.14, .7]) add(new T.TorusGeometry(.343, .02, 4, 16).rotateX(Math.PI / 2), zinc, side * (edge - 1.3), y, -4.8)
  }
  for (const [surface, parts] of surfaces) {
    const geometry = mergeGeometries(parts)
    parts.forEach(part => part.dispose())
    if (geometry) group.add(new T.Mesh(geometry, surface))
  }
  return group
}
