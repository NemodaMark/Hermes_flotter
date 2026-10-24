// Reproducible, dependency-free preparation of the licensed showroom asset.
// Run from the repository root: node scripts/prepare-khronos-car.mjs
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const revision = '7d4ba189827916452eeadc82d4b712dbc6280a6f'
const source = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${revision}/Models/CarConcept`
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
async function download(path) {
  const response = await fetch(`${source}/${path}`)
  if (!response.ok) throw new Error(`Asset download failed: ${response.status} ${path}`)
  return Buffer.from(await response.arrayBuffer())
}
const original = await download('glTF-Binary/CarConcept.glb')
if (hash(original) !== 'c272098089d78c5cd9fd9f24ff50ee8acf8d932c55f2d55fc10adb6c8998966b') throw new Error('Pinned upstream asset checksum mismatch')
if (original.readUInt32LE(0) !== 0x46546c67 || original.readUInt32LE(4) !== 2) throw new Error('Expected glTF 2 GLB')
const jsonSize = original.readUInt32LE(12)
const doc = JSON.parse(original.toString('utf8', 20, 20 + jsonSize))
const binary = original.subarray(28 + jsonSize)
if (doc.buffers.length !== 1 || doc.animations?.length || doc.skins?.length) throw new Error('Unexpected source structure; review the pinned asset')

// The dashboard supplies its own paint. Omit the sample variants and the logo
// plate texture; keep an unbranded plate and remove the steering-wheel emblem.
delete doc.extensions.KHR_materials_variants
doc.extensionsUsed = doc.extensionsUsed.filter(name => name !== 'KHR_materials_variants')
for (const mesh of doc.meshes) for (const primitive of mesh.primitives) {
  if (primitive.extensions) {
    delete primitive.extensions.KHR_materials_variants
    if (!Object.keys(primitive.extensions).length) delete primitive.extensions
  }
}
for (const node of doc.nodes) if (node.name === 'InteriorSteeringEmblem') delete node.mesh
const plate = doc.materials.find(material => material.name === 'License')
if (!plate?.pbrMetallicRoughness.baseColorTexture) throw new Error('Plate material changed; review logo removal')
delete plate.pbrMetallicRoughness.baseColorTexture
plate.pbrMetallicRoughness.baseColorFactor = [.8, .8, .8, 1]
for (const material of doc.materials) if (/^Paint [12] Carmine$/.test(material.name)) material.name = material.name.replace(' Carmine', '')

function retain(array, used) {
  const map = new Map(), values = []
  array.forEach((value, index) => { if (used.has(index)) { map.set(index, values.length); values.push(value) } })
  return { map, values }
}
function remap(map, index) {
  if (!map.has(index)) throw new Error(`Unresolved asset reference: ${index}`)
  return map.get(index)
}
const meshes = retain(doc.meshes, new Set(doc.nodes.flatMap(node => node.mesh === undefined ? [] : [node.mesh])))
for (const node of doc.nodes) if (node.mesh !== undefined) node.mesh = remap(meshes.map, node.mesh)
doc.meshes = meshes.values
const primitives = doc.meshes.flatMap(mesh => mesh.primitives)
const materials = retain(doc.materials, new Set(primitives.map(primitive => primitive.material)))
for (const primitive of primitives) primitive.material = remap(materials.map, primitive.material)
doc.materials = materials.values

function textureReferences(value, visit) {
  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== 'object') continue
    if (key.endsWith('Texture') && typeof child.index === 'number') visit(child)
    else textureReferences(child, visit)
  }
}
const usedTextures = new Set()
textureReferences(doc.materials, texture => usedTextures.add(texture.index))
const textures = retain(doc.textures, usedTextures)
textureReferences(doc.materials, texture => { texture.index = remap(textures.map, texture.index) })
doc.textures = textures.values
const images = retain(doc.images, new Set(doc.textures.map(texture => texture.source)))
for (const texture of doc.textures) texture.source = remap(images.map, texture.source)
doc.images = images.values

const usedAccessors = new Set()
for (const primitive of primitives) {
  for (const index of Object.values(primitive.attributes)) usedAccessors.add(index)
  if (primitive.indices !== undefined) usedAccessors.add(primitive.indices)
  for (const target of primitive.targets ?? []) for (const index of Object.values(target)) usedAccessors.add(index)
}
const accessors = retain(doc.accessors, usedAccessors)
for (const primitive of primitives) {
  for (const key of Object.keys(primitive.attributes)) primitive.attributes[key] = remap(accessors.map, primitive.attributes[key])
  if (primitive.indices !== undefined) primitive.indices = remap(accessors.map, primitive.indices)
  for (const target of primitive.targets ?? []) for (const key of Object.keys(target)) target[key] = remap(accessors.map, target[key])
}
doc.accessors = accessors.values
const usedViews = new Set(doc.images.map(image => image.bufferView))
for (const accessor of doc.accessors) {
  if (accessor.bufferView !== undefined) usedViews.add(accessor.bufferView)
  if (accessor.sparse) { usedViews.add(accessor.sparse.indices.bufferView); usedViews.add(accessor.sparse.values.bufferView) }
}
const views = retain(doc.bufferViews, usedViews)
for (const image of doc.images) image.bufferView = remap(views.map, image.bufferView)
for (const accessor of doc.accessors) {
  if (accessor.bufferView !== undefined) accessor.bufferView = remap(views.map, accessor.bufferView)
  if (accessor.sparse) {
    accessor.sparse.indices.bufferView = remap(views.map, accessor.sparse.indices.bufferView)
    accessor.sparse.values.bufferView = remap(views.map, accessor.sparse.values.bufferView)
  }
}
const chunks = []; let offset = 0
for (const view of views.values) {
  const padding = (4 - offset % 4) % 4
  if (padding) { chunks.push(Buffer.alloc(padding)); offset += padding }
  chunks.push(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))
  view.byteOffset = offset; offset += view.byteLength
}
doc.bufferViews = views.values
doc.buffers = [{ byteLength: offset }]
const preparedBinary = Buffer.concat(chunks)
doc.asset.generator += ' | HERMES: unbranded, pruned, runtime paint'
// Preserve upstream copyright and add the adaptation notice.
doc.asset.extras = { sourceRevision: revision, changes: 'Removed plate logo texture, steering emblem and unused material variants. Runtime paint and framing supplied by HERMES.' }
const json = Buffer.from(JSON.stringify(doc)), jsonPadding = (4 - json.length % 4) % 4, binPadding = (4 - preparedBinary.length % 4) % 4
const header = Buffer.alloc(20), binHeader = Buffer.alloc(8)
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
header.writeUInt32LE(28 + json.length + jsonPadding + preparedBinary.length + binPadding, 8)
header.writeUInt32LE(json.length + jsonPadding, 12); header.writeUInt32LE(0x4e4f534a, 16)
binHeader.writeUInt32LE(preparedBinary.length + binPadding); binHeader.writeUInt32LE(0x004e4942, 4)
const output = Buffer.concat([header, json, Buffer.alloc(jsonPadding, 32), binHeader, preparedBinary, Buffer.alloc(binPadding)])
const license = await download('LICENSE.md'), metadata = await download('metadata.json')
const legalPath = new URL('../frontend/public/models/khronos-car/', import.meta.url)
await mkdir(legalPath, { recursive: true })
await mkdir(new URL('../frontend/src/assets/', import.meta.url), { recursive: true })
await writeFile(new URL('../frontend/src/assets/car-concept.glb', import.meta.url), output)
await writeFile(new URL('UPSTREAM-LICENSE.md', legalPath), license)
await writeFile(new URL('upstream-metadata.json', legalPath), metadata)
await writeFile(new URL('source.json', legalPath), JSON.stringify({ source: `${source}/glTF-Binary/CarConcept.glb`, revision, originalSha256: hash(original), preparedSha256: hash(output), originalBytes: original.length, preparedBytes: output.length }, null, 2) + '\n')
console.log(`Prepared Car Concept: ${output.length} bytes; SHA-256 ${hash(output)}`)
