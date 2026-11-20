import * as T from 'three'

// This licensed Passat asset contains complete right wheels but empty left arches.
// Reuse its original wheel triangles/materials, rather than replacing its wheels with a different style.
export function restorePassatWheels(model: T.Group) {
  const inverse = model.matrixWorld.clone().invert(), point = new T.Vector3()
  const repairs: T.Mesh[] = []
  model.traverse(object => {
    if (!(object instanceof T.Mesh) || Array.isArray(object.material) || object.material.transparent) return
    const source = object.geometry, position = source.getAttribute('position'), index = source.index
    const selected: number[] = []
    const count = index?.count ?? position.count
    for (let offset = 0; offset < count; offset += 3) {
      const vertices = [0, 1, 2].map(i => index ? index.getX(offset + i) : offset + i)
      const points = vertices.map(vertex => point.fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld).clone())
      if (points.every(p => p.z > .62 && Math.min(Math.hypot(p.x - 1.55, p.y - .35), Math.hypot(p.x + 1.28, p.y - .35)) < .39))
        selected.push(vertices[0], vertices[2], vertices[1]) // Reflection reverses winding.
    }
    if (!selected.length) return
    const geometry = new T.BufferGeometry()
    for (const name of ['position', 'normal', 'uv', 'color']) {
      const attribute = source.getAttribute(name)
      if (!attribute) continue
      const values = new Float32Array(selected.length * attribute.itemSize)
      selected.forEach((vertex, i) => {
        for (let c = 0; c < attribute.itemSize; c++) values[i * attribute.itemSize + c] = attribute.getComponent(vertex, c)
      })
      geometry.setAttribute(name, new T.BufferAttribute(values, attribute.itemSize))
    }
    geometry.applyMatrix4(object.matrixWorld)
    geometry.applyMatrix4(new T.Matrix4().makeScale(1, 1, -1))
    geometry.applyMatrix4(inverse)
    const mesh = new T.Mesh(geometry, object.material)
    mesh.name = 'Hermes_restored_original_wheels'
    mesh.castShadow = mesh.receiveShadow = true
    repairs.push(mesh)
  })
  model.add(...repairs)
  model.updateMatrixWorld(true)
}
