// Run from the repository root after frontend/npm ci. Normal builds use the
// checked-in GLBs and never download models. Sources are pinned by SHA-256.
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'

const root = new URL('../', import.meta.url)
const legal = 'frontend/public/models/vehicle-bodies/'
const assets = 'frontend/src/assets/vehicles/'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const sources = JSON.parse(await fs.readFile(new URL(`${legal}sources.json`, root), 'utf8'))
const outputs = []
await fs.mkdir(new URL(assets, root), { recursive: true })

function textureReferences(value, references = []) {
  for (const [key, child] of Object.entries(value)) {
    if (!child || typeof child !== 'object') continue
    if (key.endsWith('Texture') && typeof child.index === 'number') references.push(child)
    else textureReferences(child, references)
  }
  return references
}

function prunePaintImages(doc, binary) {
  // Remove only unused textures/images and their buffer views. Preserve all
  // geometry, normals, roughness maps, glazing and non-paint optical materials.
  const references = textureReferences(doc.materials)
  const usedTextures = new Set(references.map(reference => reference.index))
  const textureMap = new Map(), textures = []
  doc.textures.forEach((texture, index) => {
    if (usedTextures.has(index)) { textureMap.set(index, textures.length); textures.push(texture) }
  })
  for (const reference of references) reference.index = textureMap.get(reference.index)
  doc.textures = textures

  const usedImages = new Set(textures.map(texture => texture.source))
  const imageMap = new Map(), images = [], removedViews = new Set()
  doc.images.forEach((image, index) => {
    if (usedImages.has(index)) { imageMap.set(index, images.length); images.push(image) }
    else removedViews.add(image.bufferView)
  })
  for (const texture of textures) texture.source = imageMap.get(texture.source)
  doc.images = images

  const chunks = [], views = [], viewMap = new Map()
  let offset = 0
  doc.bufferViews.forEach((view, index) => {
    if (removedViews.has(index)) return
    const padding = (4 - offset % 4) % 4
    chunks.push(Buffer.alloc(padding)); offset += padding
    chunks.push(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength))
    view.byteOffset = offset; offset += view.byteLength
    viewMap.set(index, views.length); views.push(view)
  })
  for (const image of images) image.bufferView = viewMap.get(image.bufferView)
  for (const accessor of doc.accessors) {
    if (accessor.bufferView !== undefined) accessor.bufferView = viewMap.get(accessor.bufferView)
    if (accessor.sparse) {
      accessor.sparse.indices.bufferView = viewMap.get(accessor.sparse.indices.bufferView)
      accessor.sparse.values.bufferView = viewMap.get(accessor.sparse.values.bufferView)
    }
  }
  doc.bufferViews = views; doc.buffers = [{ byteLength: offset }]
  return Buffer.concat(chunks)
}

function pack(doc, binary) {
  const json = Buffer.from(JSON.stringify(doc))
  const jsonPadding = (4 - json.length % 4) % 4, binPadding = (4 - binary.length % 4) % 4
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8)
  header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + json.length + jsonPadding + binary.length + binPadding, 8)
  header.writeUInt32LE(json.length + jsonPadding, 12); header.writeUInt32LE(0x4e4f534a, 16)
  binHeader.writeUInt32LE(binary.length + binPadding); binHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, json, Buffer.alloc(jsonPadding, 32), binHeader, binary, Buffer.alloc(binPadding)])
}

async function removeFreightEnclosure(original, doc) {
  // This source has a separate cab, chassis and freight body. Inspect actual
  // world-space bounds; retain the cab and all low running gear and fittings.
  const { GLTFLoader } = await import('../frontend/node_modules/three/examples/jsm/loaders/GLTFLoader.js')
  const { Texture, Box3 } = await import('../frontend/node_modules/three/build/three.module.js')
  const loader = new GLTFLoader().register(() => ({ name: 'preparation_skip_image_decode', loadTexture: async () => new Texture() }))
  const parsed = await loader.parseAsync(original.buffer.slice(original.byteOffset, original.byteOffset + original.byteLength), '')
  let removed = 0
  for (const [object, association] of parsed.parser.associations) {
    if (association.nodes === undefined || !object.isMesh) continue
    const bounds = new Box3().setFromObject(object, true)
    if (/freight_box/.test(object.name) || (bounds.min.x > -.8 && bounds.min.y > .85)) {
      delete doc.nodes[association.nodes].mesh; removed++
    }
  }
  if (removed < 30) throw new Error('Freight body structure changed; review the pinned source')
  doc.asset.extras.changes += ' Freight enclosure removed for chassis-cab variant.'
}

for (const source of sources) {
  let original
  if (process.env.HERMES_MODEL_CACHE) original = await fs.readFile(`${process.env.HERMES_MODEL_CACHE}/${source.key}.glb`)
  else {
    const response = await fetch(source.source, { signal: AbortSignal.timeout(120000) })
    if (!response.ok) throw new Error(`Download failed: ${source.key}, HTTP ${response.status}`)
    original = Buffer.from(await response.arrayBuffer())
  }
  if (hash(original) !== source.sha256) throw new Error(`Source checksum changed: ${source.key}`)
  const size = original.readUInt32LE(12)
  const doc = JSON.parse(original.toString('utf8', 20, 20 + size)), binary = original.subarray(28 + size)
  if (doc.animations?.length || doc.skins?.length || doc.buffers.length !== 1 || doc.buffers[0].uri) throw new Error('Expected static self-contained GLB')
  let paints = 0
  for (const material of doc.materials) {
    if (material.name !== 'paint' && !/outdoor paint$/.test(material.name)) continue
    material.name = 'Paint 1'
    material.pbrMetallicRoughness.baseColorFactor = [1, 1, 1, 1]
    delete material.pbrMetallicRoughness.baseColorTexture
    paints++
  }
  if (!paints) throw new Error(`No exterior paint: ${source.key}`)
  doc.asset.copyright = 'Innerscene — original model, CC0 1.0'
  doc.asset.extras = { source: source.page, license: 'CC0-1.0', changes: 'Neutral exterior paint; unused paint textures removed. Runtime color and body-specific framing by HERMES.' }
  const preparedBinary = prunePaintImages(doc, binary)
  async function save(key) {
    const output = pack(doc, preparedBinary)
    await fs.writeFile(new URL(`${assets}${key}.glb`, root), output)
    outputs.push({ key, sha256: hash(output), bytes: output.length, source: source.key })
    console.log(`${key}: ${output.length} bytes`)
  }
  await save(source.key)
  if (source.key === 'box') { await removeFreightEnclosure(original, doc); await save('chassis') }
}
await fs.writeFile(new URL(`${legal}prepared.json`, root), JSON.stringify(outputs, null, 2) + '\n')
