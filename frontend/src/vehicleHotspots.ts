import { Mesh, Raycaster, Vector3 } from 'three'
import type { Intersection, Object3D } from 'three'

export type VehicleHotspot = { point: Vector3; outward: Vector3 }

export function vehicleHotspots(model: Object3D, extent: number) {
  const surfaces: Mesh[] = []
  model.traverseVisible(object => { if (object instanceof Mesh) surfaces.push(object) })
  const ray = new Raycaster(), direction = new Vector3(), origin = new Vector3()
  const intersections: Intersection[] = [], offset = extent * .002
  return {
    anchor(seed: Vector3, outward: Vector3): VehicleHotspot {
      outward = outward.clone().normalize()
      // Body proportions are approximate. Put each anchor on the actual outer
      // surface so a near-side point is not accidentally buried in the model.
      origin.copy(seed).addScaledVector(outward, extent)
      direction.copy(outward).negate()
      ray.set(origin, direction); ray.far = extent * 2
      intersections.length = 0
      ray.intersectObjects(surfaces, false, intersections)
      const point = (intersections[0]?.point ?? seed).clone().addScaledVector(outward, offset)
      return { point, outward }
    },
    visible(hotspot: VehicleHotspot, eye: Vector3): boolean {
      direction.subVectors(eye, hotspot.point).normalize()
      // Never show the opposite side through windows or gaps in the mesh.
      if (direction.dot(hotspot.outward) <= .015) return false
      const distance = eye.distanceTo(hotspot.point)
      direction.negate(); ray.set(eye, direction)
      ray.far = Math.max(0, distance - offset * .5)
      intersections.length = 0
      ray.intersectObjects(surfaces, false, intersections)
      return intersections.length === 0
    },
  }
}
