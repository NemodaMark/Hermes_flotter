import { expect, it } from 'vitest'
import { Box3, Mesh, Line } from 'three'
import { buildVehicle } from './vehicleSceneModel'
import { bodyNames } from './vehicleAppearance'

it('builds a bounded nonempty 3D mesh for every supported body type, including missing and future values',()=>{
  for(const body of [...Object.keys(bodyNames),'FutureBody']) {
    const {model}=buildVehicle(body,'#214d81')
    const bounds=new Box3().setFromObject(model)
    expect(bounds.isEmpty(),body).toBe(false)
    expect(Number.isFinite(bounds.min.x)&&Number.isFinite(bounds.max.y),body).toBe(true)
    expect(bounds.max.x-bounds.min.x,body).toBeGreaterThan(4)
    expect(bounds.max.y,body).toBeLessThan(3)
    model.traverse(item=>{if(item instanceof Mesh||item instanceof Line){item.geometry.dispose();for(const material of Array.isArray(item.material)?item.material:[item.material])material.dispose()}})
  }
})
it('uses different physical proportions for passenger, coupe and commercial bodies',()=>{
  const sedan=buildVehicle('Sedan','#ffffff'),coupe=buildVehicle('Coupe','#ffffff'),van=buildVehicle('Van','#ffffff')
  expect(coupe.shape.length).toBeLessThan(sedan.shape.length)
  expect(coupe.shape.roof).toBeLessThan(sedan.shape.roof)
  expect(van.shape.length).toBeGreaterThan(sedan.shape.length)
  expect(van.shape.roof).toBeGreaterThan(sedan.shape.roof)
})
