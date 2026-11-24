import { Box3, Group, Mesh, MeshStandardMaterial, SpotLight, Vector3 } from 'three'
import type { Object3D } from 'three'

export type ModelControl = {
  id: string
  label: string
  point: (target: Vector3) => Vector3
  apply: (progress: number) => void
}

const frontLightMaterials: Record<string, string> = {
  'ford-mustang': 'light', 'renault-megane': 'farcam', 'volkswagen-passat': 'vehiclelights128__spec',
  'bmw-7-series-f01': 'Headlights_1', 'kia-carnival': 'Headlight.003', 'mercedes-benz-sprinter': 'Headlamp reflector',
  'audi-tt': 'front_lamps', 'fiat-ducato': 'front_lamps', 'renault-duster': 'front_lamps',
}

function headlamps(model: Group, materialName: string | undefined): ModelControl | undefined {
  if (!materialName) return
  const bulbs = new Map<MeshStandardMaterial, MeshStandardMaterial['emissive']>()
  const bounds = new Box3()
  model.traverse(object => {
    if (!(object instanceof Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (!(material instanceof MeshStandardMaterial) || material.name !== materialName) continue
      if (!bulbs.has(material)) bulbs.set(material, material.emissive.clone())
      bounds.expandByObject(object, true)
    }
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

export function vehicleModelControls(model: Group, key: string) {
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
