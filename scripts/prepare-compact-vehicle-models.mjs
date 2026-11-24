// npm install --prefix .local/vehicle-asset-tools --save-exact @gltf-transform/core@4.5.1 @gltf-transform/extensions@4.5.1 @gltf-transform/functions@4.5.1 meshoptimizer@1.3.0 sharp@0.35.5
// node scripts/prepare-compact-vehicle-models.mjs .local/vehicle-asset-tools
import { mkdir, readdir, stat, rm, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HDRLoader } from '../frontend/node_modules/three/examples/jsm/loaders/HDRLoader.js'
import { FloatType } from '../frontend/node_modules/three/build/three.module.js'

const toolDirectory = resolve(process.argv[2] ?? '.local/vehicle-asset-tools')
const requireTool = createRequire(pathToFileURL(resolve(toolDirectory, 'package.json')))
const { NodeIO } = requireTool('@gltf-transform/core')
const { ALL_EXTENSIONS } = requireTool('@gltf-transform/extensions')
const { meshopt, simplify, textureCompress, weld } = requireTool('@gltf-transform/functions')
const { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } = await import(pathToFileURL(requireTool.resolve('meshoptimizer')).href)
const sharp = requireTool('sharp')
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])

const assets = new URL('../frontend/src/assets/vehicles/', import.meta.url)
const output = new URL('compact/', assets)
await mkdir(output, { recursive: true })
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
})
const modelSource = await readFile(new URL('../frontend/src/vehicleModels.ts', import.meta.url), 'utf8')
const activeModels = new Set([...modelSource.matchAll(/assets\/vehicles\/([^/']+\.glb)\?url/g)].map(match => match[1]))

for (const name of (await readdir(assets)).filter(name => activeModels.has(name))) {
  const source = new URL(name, assets)
  const target = new URL(name, output)
  const glb = await io.readBinary(await readFile(source))
  await glb.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: .45, error: .005, lockBorder: true }),
    textureCompress({ encoder: sharp, resize: [512, 512] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  const originalSize = (await stat(source)).size
  const compact = await io.writeBinary(glb)
  if (compact.length >= originalSize * .9) {
    await rm(target, { force: true })
    continue
  }
  await writeFile(target, compact)
  console.log(`${name} ${originalSize} → ${compact.length} bytes`)
}

// Average in linear light, then write Radiance RGBE scanlines. This retains
// the high dynamic range of the original reflections through tone mapping.
const original = await readFile(new URL('studio-small-03.hdr', assets))
const { data, width, height } = new HDRLoader().setDataType(FloatType).parse(Uint8Array.from(original).buffer)
const scale = 4
const targetWidth = width / scale
const targetHeight = height / scale
const scanlines = [Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${targetHeight} +X ${targetWidth}\n`)]
for (let row = 0; row < targetHeight; row++) {
  const channels = Array.from({ length: 4 }, () => new Uint8Array(targetWidth))
  for (let column = 0; column < targetWidth; column++) {
    const rgb = [0, 0, 0]
    for (let y = 0; y < scale; y++) {
      for (let x = 0; x < scale; x++) {
        const pixel = ((row * scale + y) * width + column * scale + x) * 4
        for (let channel = 0; channel < 3; channel++) rgb[channel] += data[pixel + channel] / (scale * scale)
      }
    }
    const peak = Math.max(...rgb)
    if (!peak) continue
    const exponent = Math.floor(Math.log2(peak)) + 1
    for (let channel = 0; channel < 3; channel++) channels[channel][column] = Math.floor(rgb[channel] * 256 / 2 ** exponent)
    channels[3][column] = exponent + 128
  }
  scanlines.push(Buffer.from([2, 2, targetWidth >> 8, targetWidth & 255]))
  for (const channel of channels) {
    for (let column = 0; column < targetWidth; column += 128) {
      const segment = channel.subarray(column, column + 128)
      scanlines.push(Buffer.from([segment.length]), segment)
    }
  }
}
await writeFile(new URL('studio-small-03.hdr', output), Buffer.concat(scanlines))
