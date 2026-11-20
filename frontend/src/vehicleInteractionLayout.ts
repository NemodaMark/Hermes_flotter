import { Vector3 } from 'three'
import type { VehicleShape } from './vehicleSceneModel'

export function vehicleInteractionLayout(shape: VehicleShape) {
  const { length, width, roof, frontAxle } = shape
  const utility = roof > 2.05
  const point = (x: number, y: number, z: number, nx = 0, ny = 0, nz = 1) => ({ seed: new Vector3(x, y, z), outward: new Vector3(nx, ny, nz) })
  return {
    data: point(-length * (utility ? .19 : .05), roof * (utility ? .62 : 1), utility ? width * .48 : 0, 0, utility ? 0 : 1, utility ? 1 : 0),
    history: point(frontAxle * .3, roof * (utility ? .57 : .69), width * .46),
    fuel: point(length * (utility ? .12 : -.29), roof * (utility ? .31 : .43), width * .47),
    services: point(length * .30, roof * .43, 0, 0, 1, 0),
    documents: point(length * .08, roof * .73, width * .34),
    leases: point(-length * .4, roof * .55, 0, -1, 0, 0),
    site: point(-length * .08, roof * .5, width * .44),
    photos: point(-length * .38, roof * .30, width * .42),
  }
}
