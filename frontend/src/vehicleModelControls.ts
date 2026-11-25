import { Box3, Group, Mesh, MeshStandardMaterial, SpotLight, Vector3 } from 'three'
import type { Object3D } from 'three'

export type ModelControl = {
  id: string
  label: string
  point: (target: Vector3) => Vector3
  apply: (progress: number) => void
}

const frontLightMaterials: Record<string, string> = {
  'ford-mustang': 'light', 'bmw-7-series-f01': 'Headlights_1',
  'mercedes-benz-sprinter': 'Headlamp reflector', 'fiat-ducato': 'front_lamps',
}

function headlamps(model: Group, materialName: string | undefined, lowBeamsOnly = false): ModelControl | undefined {
  if (!materialName) return
  const bulbs = new Map<MeshStandardMaterial, MeshStandardMaterial['emissive']>()
  const isolated = new Map<MeshStandardMaterial, MeshStandardMaterial>()
  const bounds = new Box3()
  model.traverse(object => {
    if (!(object instanceof Mesh)) return
    if (lowBeamsOnly && !/^Light_Low_Beam_(Left|Right)_\d+$/.test(object.name)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    const updated = materials.map(original => {
      if (!(original instanceof MeshStandardMaterial) || original.name !== materialName) return original
      // OpenX reuses Lamp_White for other lights, including reverse lights.
      const material = lowBeamsOnly ? isolated.get(original) ?? original.clone() : original
      if (lowBeamsOnly) isolated.set(original, material)
      if (!bulbs.has(material)) bulbs.set(material, material.emissive.clone())
      bounds.expandByObject(object, true)
      return material
    })
    if (lowBeamsOnly) object.material = Array.isArray(object.material) ? updated : updated[0]
  })
  if (bounds.isEmpty()) return
  const center = bounds.getCenter(new Vector3()), half = (bounds.max.z - bounds.min.z) / 2
  const point = model.worldToLocal(center.clone())
  const beams = [-1, 1].map(side => {
    const z = center.z + side * half * .78
    const beam = new SpotLight('#fff1d9', 0, 13, .28, .7)
    beam.visible = false
    beam.position.copy(model.worldToLocal(new Vector3(bounds.max.x + .06, center.y, z)))
    beam.target.position.copy(model.worldToLocal(new Vector3(bounds.max.x + 5, .04, z)))
    model.add(beam, beam.target)
    return beam
  })
  return {
    id: 'headlamps', label: 'Fényszórók', point: target => model.localToWorld(target.copy(point)),
    apply: progress => {
      for (const [material, color] of bulbs) {
        material.emissive.copy(color)
        if (progress > 0) material.emissive.set('#fff1d9')
        material.emissiveIntensity = progress * 2.4
      }
      for (const beam of beams) {
        beam.visible = progress > 0
        beam.intensity = progress * 42
      }
    },
  }
}

function hinge(model: Group, id: string, label: string, parts: Object3D[], bounds: Box3, pivotPoint: Vector3, axis: Vector3, angle: number): ModelControl {
  const pivot = new Group()
  pivot.name = `Hermes-${id}`
  pivot.position.copy(model.worldToLocal(pivotPoint))
  model.add(pivot)
  for (const part of parts) {
    part.traverse(child => { if (child instanceof Mesh) child.userData.articulated = true })
    pivot.attach(part)
  }
  const point = pivot.worldToLocal(bounds.getCenter(new Vector3()))
  return {
    id, label, point: target => pivot.localToWorld(target.copy(point)),
    apply: progress => pivot.quaternion.setFromAxisAngle(axis, angle * progress),
  }
}

function openXControls(model: Group, root: Object3D, pickup: boolean): ModelControl[] {
  const specs = [
    ['Front_0', 'hood', 'Motorháztető', 0, Math.PI / 3.2],
    ['Left_0', 'door-L', 'Bal ajtó', -Math.PI / 3.5, 0],
    ['Right_0', 'door-R', 'Jobb ajtó', Math.PI / 3.5, 0],
    ['Left_1', 'door-L-rear', 'Bal hátsó ajtó', -Math.PI / 3.5, 0],
    ['Right_1', 'door-R-rear', 'Jobb hátsó ajtó', Math.PI / 3.5, 0],
    ['Rear_0', 'trunk', pickup ? 'Platóajtó' : 'Csomagtartó', 0, pickup ? Math.PI / 2 : -Math.PI / 3.2],
  ] as const
  const controls: ModelControl[] = []
  for (const [name, id, label, yaw, pitch] of specs) {
    const part = root.getObjectByName(`Grp_Door_${name}`)
    if (!part) continue
    const bounds = new Box3().setFromObject(part, true)
    if (bounds.isEmpty()) continue
    const origin = part.getWorldPosition(new Vector3())
    const axis = yaw === 0 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
    controls.push(hinge(model, id, label, [part], bounds, origin, axis, yaw || pitch))
  }
  const lights = headlamps(model, 'Lamp_White', true)
  if (lights) controls.push(lights)
  return controls
}

export function vehicleModelControls(model: Group, key: string) {
  const root = model.getObjectByName('Grp_Root')
  if (root) return openXControls(model, root, key === 'gmc-hummer-2021')
  const controls: ModelControl[] = []
  if (key === 'ford-mustang') {
    const find = (name: string) => model.getObjectByName(`GT500${name}`)
    for (const [side, label, sign] of [['L', 'Bal ajtó', -1], ['R', 'Jobb ajtó', 1]] as const) {
      const door = find(`Door${side}`), glass = find(`DoorGlass${side}`), mirror = find(`Mirror${side}`)
      if (!door || !glass || !mirror) continue
      const bounds = new Box3().setFromObject(door, true)
      const pivot = bounds.getCenter(new Vector3())
      pivot.x = bounds.max.x - .05
      controls.push(hinge(model, `door-${side}`, label, [door, glass, mirror], bounds, pivot, new Vector3(0, 1, 0), sign * Math.PI / 3))
    }
    const hood = find('Hood')
    if (hood) {
      const bounds = new Box3().setFromObject(hood, true)
      const pivot = bounds.getCenter(new Vector3())
      pivot.x = bounds.min.x + .05
      pivot.y = bounds.max.y - .035
      controls.unshift(hinge(model, 'hood', 'Motorháztető', [hood], bounds, pivot, new Vector3(0, 0, 1), Math.PI / 3.2))
    }
    const trunk = find('Trunk'), spoiler = find('Wing')
    if (trunk && spoiler) {
      const bounds = new Box3().setFromObject(trunk, true)
      const pivot = bounds.getCenter(new Vector3())
      pivot.x = bounds.max.x - .025
      pivot.y = bounds.max.y - .025
      controls.push(hinge(model, 'trunk', 'Csomagtartó', [trunk, spoiler], bounds, pivot, new Vector3(0, 0, 1), -Math.PI / 4))
    }
  }
  const lights = headlamps(model, frontLightMaterials[key])
  if (lights) controls.push(lights)
  return controls
}
