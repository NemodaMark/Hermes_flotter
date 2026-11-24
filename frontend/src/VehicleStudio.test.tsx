import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import VehicleStudio from './VehicleStudio'
import { vehicleModel } from './vehicleModels'

const mocks = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), rendererOptions: vi.fn(), pixelRatio: vi.fn(), dispose: vi.fn(), forceContextLoss: vi.fn() }))
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three')
  return { ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      shadowMap = { enabled: false, type: 0 }
      constructor(options: unknown) { mocks.rendererOptions(options) }
      setPixelRatio = mocks.pixelRatio
      setSize() {}
      render = mocks.render
      dispose = mocks.dispose
      forceContextLoss = mocks.forceContextLoss
    },
    PMREMGenerator: class { fromScene() { return { texture: new actual.Texture(), dispose() {} } } dispose() {} },
  }
})
vi.mock('three/addons/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    setMeshoptDecoder() { return this }
    loadAsync = mocks.load
  },
}))
vi.mock('three/addons/loaders/HDRLoader.js', () => ({ HDRLoader: class { loadAsync = async () => { throw new Error('HDR unavailable in jsdom') } } }))
vi.mock('three/addons/controls/OrbitControls.js', () => ({ OrbitControls: class {
  target = new Vector3()
  camera: PerspectiveCamera
  constructor(camera: PerspectiveCamera) { this.camera = camera }
  update() { this.camera.lookAt(this.target) }
  addEventListener() {}
  removeEventListener() {}
  dispose() {}
} }))
let frames: Map<number, FrameRequestCallback>, sequence: number
beforeEach(() => {
  mocks.load.mockReset(); mocks.render.mockClear(); mocks.dispose.mockClear(); mocks.forceContextLoss.mockClear()
  mocks.rendererOptions.mockClear(); mocks.pixelRatio.mockClear()
  frames = new Map(); sequence = 0
  vi.stubGlobal('WebGL2RenderingContext', class {})
  vi.stubGlobal('devicePixelRatio', 1)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
})
const testModel = { ...vehicleModel('Coupe'), rotation: 0, paintMaterials: ['Paint 1'] }
const props = () => ({ model: testModel, color: 'Kék', menus: [{ key: 'data' as const, label: 'Járműadatok' }], action: null, onSelect: vi.fn(), onFocused: vi.fn(), onCancelled: vi.fn() })
function asset() {
  const scene = new Group(), paint = new MeshPhysicalMaterial({ color: '#ff0000' }); paint.name = 'Paint 1'
  const geometry = new BoxGeometry(4.8, 1.2, 2); scene.add(new Mesh(geometry, paint))
  return { gltf: { scene } as GLTF, paint, geometry }
}
async function frame(time: number) {
  await act(async () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(time) })
}
function renderedPosition() {
  const camera = mocks.render.mock.lastCall?.[1] as PerspectiveCamera | undefined
  if (!camera) throw new Error('Expected a rendered camera frame')
  return camera.position.clone()
}
it('loads once, follows color changes and opens the requested menu only after the camera flight', async () => {
  const { gltf, paint } = asset(); mocks.load.mockResolvedValue(gltf)
  const callbacks = props(), view = render(<VehicleStudio {...callbacks} />)
  await screen.findByRole('button', { name: 'Forgatás jobbra' })
  expect(paint.color.getHexString()).toBe('214d81')
  view.rerender(<VehicleStudio {...callbacks} color="#d5ae31" />)
  expect(paint.color.getHexString()).toBe('d5ae31'); expect(mocks.load).toHaveBeenCalledTimes(1)
  vi.spyOn(performance, 'now').mockReturnValue(0)
  view.rerender(<VehicleStudio {...callbacks} action={{ key: 'data', sequence: 1 }} />)
  await frame(400); expect(callbacks.onFocused).not.toHaveBeenCalled()
  await frame(900); expect(callbacks.onFocused).toHaveBeenCalledExactlyOnceWith('data')
  const renderedFrames = mocks.render.mock.calls.length
  view.rerender(<VehicleStudio {...callbacks} paused />)
  await frame(1200); expect(mocks.render).toHaveBeenCalledTimes(renderedFrames)
  view.rerender(<VehicleStudio {...callbacks} />)
  await frame(1300); expect(mocks.render).toHaveBeenCalledTimes(renderedFrames + 1)
  fireEvent.click(screen.getByRole('button', { name: '3D pont: Járműadatok' }))
  expect(callbacks.onSelect).toHaveBeenCalledWith('data')
})
it('keeps direct menu access after a load failure and can retry the local asset', async () => {
  mocks.load.mockRejectedValueOnce(new Error('Download failed'))
  const callbacks = props(), view = render(<VehicleStudio {...callbacks} />)
  await screen.findByText(/A járműmodell nem tölthető be/)
  view.rerender(<VehicleStudio {...callbacks} action={{ key: 'data', sequence: 1 }} />)
  expect(callbacks.onFocused).toHaveBeenCalledExactlyOnceWith('data')
  mocks.load.mockResolvedValueOnce(asset().gltf)
  fireEvent.click(screen.getByRole('button', { name: 'Újrapróbálom' }))
  await screen.findByRole('button', { name: 'Forgatás jobbra' })
  expect(mocks.load).toHaveBeenCalledTimes(2)
  expect(callbacks.onFocused).toHaveBeenCalledTimes(1)
})
it('renders consecutive 60 Hz camera frames and stops scheduling frames at rest', async () => {
  mocks.load.mockResolvedValue(asset().gltf)
  render(<VehicleStudio {...props()} />)
  await screen.findByRole('button', { name: 'Forgatás jobbra' })
  await frame(100)
  await frame(117)
  expect(frames.size).toBe(0)

  vi.spyOn(performance, 'now').mockReturnValue(200)
  mocks.render.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Forgatás jobbra' }))
  await frame(217)
  await frame(234)
  expect(mocks.render).toHaveBeenCalledTimes(2)

  await frame(1000)
  await frame(1017)
  expect(frames.size).toBe(0)
})
it('keeps the original model and antialiasing on phones, then restores resolution after slow motion', async () => {
  const model = vehicleModel('Sedan')
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width: 760px') }))
  vi.stubGlobal('devicePixelRatio', 2)
  mocks.load.mockResolvedValue(asset().gltf)
  const view = render(<VehicleStudio {...props()} model={model} />)
  Object.defineProperties(view.container.querySelector('.vehicle-studio')!, {
    clientWidth: { value: 390 }, clientHeight: { value: 800 },
  })
  const toggle = await screen.findByRole('button', { name: 'Bemutató mód' })
  expect(mocks.load).toHaveBeenCalledWith(model.url)
  expect(mocks.rendererOptions).toHaveBeenCalledWith(expect.objectContaining({ antialias: true }))
  await frame(100)
  await frame(117)
  expect(mocks.pixelRatio).toHaveBeenLastCalledWith(1.5)

  fireEvent.click(toggle)
  for (const time of [200, 250, 300, 350, 400]) await frame(time)
  expect(mocks.pixelRatio.mock.lastCall?.[0]).toBeLessThan(1.5)

  fireEvent.click(toggle)
  await frame(450)
  expect(mocks.pixelRatio).toHaveBeenLastCalledWith(1.5)
  expect(frames.size).toBe(0)
})
it('starts a slow time-based presentation on request and stops on manual input', async () => {
  mocks.load.mockResolvedValue(asset().gltf)
  render(<VehicleStudio {...props()} />)
  const toggle = await screen.findByRole('button', { name: 'Bemutató mód' })
  await frame(100)
  await frame(117)
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(frames.size).toBe(0)

  fireEvent.click(toggle)
  await frame(1000)
  const original = renderedPosition()
  for (let step = 1; step <= 60; step++) await frame(1000 + step * 1000 / 60)
  const next = renderedPosition()
  const angle = Math.atan2(next.x, next.z) - Math.atan2(original.x, original.z)
  expect(angle).toBeCloseTo(Math.PI * 2 / 90, 5)
  expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect(frames.size).toBe(1)

  fireEvent.pointerDown(screen.getByRole('img', { name: 'Forgatható 3D járműmodell' }))
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await frame(2200)
  expect(renderedPosition().distanceTo(next)).toBeLessThan(.0001)
  expect(frames.size).toBe(0)
  fireEvent.click(toggle)
  await frame(3000)
  await frame(3050)
  fireEvent.wheel(screen.getByRole('img', { name: 'Forgatható 3D járműmodell' }))
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
})
it('stops a presentation when a menu opens and requires an explicit restart after closing', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('min-width') }))
  mocks.load.mockResolvedValue(asset().gltf)
  const studio = { ...props(), immersive: true }
  const view = render(<VehicleStudio {...studio} />)
  const toggle = await screen.findByRole('button', { name: 'Bemutató mód' })
  fireEvent.click(toggle)
  await frame(1000)
  await frame(1050)
  fireEvent.click(screen.getByRole('button', { name: '3D pont: Járműadatok' }))
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(studio.onSelect).toHaveBeenCalledWith('data')

  fireEvent.click(toggle)
  view.rerender(<VehicleStudio {...studio} paused action={{ key: 'data', sequence: 1 }} />)
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(toggle).toBeDisabled()
  await frame(performance.now() + 1000)
  view.rerender(<VehicleStudio {...studio} action={{ key: 'resume', sequence: 2 }} />)
  await frame(performance.now() + 1000)
  expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect(toggle).toBeEnabled()
  await frame(performance.now() + 1100)
  expect(frames.size).toBe(0)
})
it('keeps a presentation running when the camera controls close and reopen', async () => {
  mocks.load.mockResolvedValue(asset().gltf)
  render(<VehicleStudio {...props()} immersive />)
  const camera = await screen.findByRole('button', { name: 'Kameravezérlés megnyitása' })
  fireEvent.click(camera)
  const presentation = screen.getByRole('button', { name: 'Bemutató mód' })
  fireEvent.click(presentation)
  await frame(1000)
  const position = renderedPosition()

  fireEvent.click(screen.getByRole('button', { name: 'Kameravezérlés bezárása' }))
  expect(camera).toHaveAttribute('aria-expanded', 'false')
  expect(presentation).toHaveAttribute('aria-pressed', 'true')
  await frame(1050)
  expect(renderedPosition().distanceTo(position)).toBeGreaterThan(0)

  fireEvent.click(camera)
  fireEvent.keyDown(presentation, { key: 'Escape' })
  expect(camera).toHaveAttribute('aria-expanded', 'false')
  expect(camera).toHaveFocus()
  expect(presentation).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(camera)
  fireEvent.click(presentation)
  expect(presentation).toHaveAttribute('aria-pressed', 'false')
})
it('switches off operation hotspots and explains when the loaded asset has no controls', async () => {
  mocks.load.mockResolvedValue(asset().gltf)
  render(<VehicleStudio {...props()} immersive />)
  const mode = await screen.findByRole('button', { name: 'Modellvezérlés' })
  expect(screen.getByRole('button', { name: '3D pont: Járműadatok' })).toBeInTheDocument()
  fireEvent.click(mode)
  expect(mode).toHaveAttribute('aria-pressed', 'true')
  expect(screen.queryByRole('button', { name: '3D pont: Járműadatok' })).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Ehhez a modellhez nincs vezérelhető alkatrész.')
  fireEvent.click(mode)
  expect(screen.getByRole('button', { name: '3D pont: Járműadatok' })).toBeInTheDocument()
})
it('returns to the user’s orbit and zoom after inspecting multiple desktop sections', async () => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('min-width') }))
  mocks.load.mockResolvedValue(asset().gltf)
  const studio = { ...props(), immersive: true }
  const view = render(<VehicleStudio {...studio} />)
  await screen.findByRole('button', { name: 'Forgatás jobbra' })
  const now = vi.spyOn(performance, 'now').mockReturnValue(100)
  fireEvent.click(screen.getByRole('button', { name: 'Forgatás balra' }))
  await frame(420)
  now.mockReturnValue(450)
  fireEvent.click(screen.getByRole('button', { name: 'Kamera közelítése' }))
  await frame(800)
  const original = renderedPosition()

  now.mockReturnValue(900)
  view.rerender(<VehicleStudio {...studio} paused action={{ key: 'data', sequence: 1 }} />)
  await frame(1700)
  const firstSection = renderedPosition()
  expect(firstSection.distanceTo(original)).toBeGreaterThan(1)
  now.mockReturnValue(1800)
  view.rerender(<VehicleStudio {...studio} paused action={{ key: 'photos', sequence: 2 }} />)
  await frame(2600)
  expect(renderedPosition().distanceTo(firstSection)).toBeGreaterThan(1)
  now.mockReturnValue(2700)
  view.rerender(<VehicleStudio {...studio} action={{ key: 'resume', sequence: 3 }} />)
  await frame(3500)
  expect(renderedPosition().distanceTo(original)).toBeLessThan(.0001)
})
it('keeps the orbit still while a mobile drawer is open', async () => {
  mocks.load.mockResolvedValue(asset().gltf)
  const studio = { ...props(), immersive: true }
  const view = render(<VehicleStudio {...studio} />)
  await screen.findByRole('button', { name: 'Forgatás jobbra' })
  const now = vi.spyOn(performance, 'now').mockReturnValue(100)
  fireEvent.click(screen.getByRole('button', { name: 'Forgatás jobbra' }))
  await frame(220)
  const original = renderedPosition()

  now.mockReturnValue(230)
  view.rerender(<VehicleStudio {...studio} paused action={{ key: 'photos', sequence: 1 }} />)
  await frame(1250)
  expect(renderedPosition().distanceTo(original)).toBeLessThan(.0001)
  now.mockReturnValue(1300)
  view.rerender(<VehicleStudio {...studio} action={{ key: 'resume', sequence: 2 }} />)
  await frame(2100)
  expect(renderedPosition().distanceTo(original)).toBeLessThan(.0001)
})
it('hides a side hotspot with its label and leader when rotated behind the car, then restores it', async () => {
  mocks.load.mockResolvedValue(asset().gltf)
  const callbacks = { ...props(), menus: [{ key: 'site' as const, label: 'Telephely és használó' }] }
  render(<VehicleStudio {...callbacks} />)
  await screen.findByRole('button', { name: 'Forgatás jobbra' })
  vi.spyOn(performance, 'now').mockReturnValue(0)
  await frame(100)
  const hotspot = screen.getByRole('button', { name: '3D pont: Telephely és használó' })
  expect(hotspot).toHaveStyle({ visibility: 'visible' })
  // Half a turn puts the same physical point on the far side of the model.
  for (let i = 0; i < 4; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Forgatás balra' }))
    await frame(1000 + i * 1000)
  }
  expect(hotspot).toHaveStyle({ visibility: 'hidden' })
  expect(hotspot).toBeDisabled(); expect(hotspot).toHaveAttribute('aria-hidden', 'true')
  expect(screen.queryByRole('button', { name: '3D pont: Telephely és használó' })).not.toBeInTheDocument()
  for (let i = 0; i < 4; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Forgatás balra' }))
    await frame(5000 + i * 1000)
  }
  expect(hotspot).toHaveStyle({ visibility: 'visible' }); expect(hotspot).toBeEnabled()
})
it('shows the dock actions as separate labeled portrait hotspots', async () => {
  mocks.load.mockResolvedValue(asset().gltf)
  const studio = props()
  const view = render(<VehicleStudio {...studio} immersive menus={[
    { key: 'data', label: 'Járműadatok', touchLabel: 'Adatlap' }, { key: 'history', label: 'Kilométerállás', touchLabel: 'Km rögzítése' },
    { key: 'fuel', label: 'Tankolás', touchLabel: 'Tankolás' }, { key: 'photos', label: 'Képek', touchLabel: 'Képek' },
    { key: 'more', label: 'Továbbiak', touchLabel: 'Továbbiak' }, { key: 'documents', label: 'Dokumentumok' },
  ]} />)
  Object.defineProperties(view.container.querySelector('.vehicle-studio')!, {
    clientWidth: { value: 390 }, clientHeight: { value: 750 },
  })
  await screen.findByRole('button', { name: 'Forgatás jobbra' })
  await frame(100)

  const labels = screen.getAllByRole('button', { name: /^3D pont:/ })
  const coordinate = (button: HTMLElement, axis: 'x' | 'y') => parseFloat(button.style.getPropertyValue(`--hotspot-${axis}`))
  expect(labels).toHaveLength(5)
  expect(screen.queryByRole('button', { name: '3D pont: Dokumentumok' })).not.toBeInTheDocument()
  for (const [index, label] of labels.entries()) {
    for (const other of labels.slice(0, index))
      expect(Math.abs(coordinate(label, 'x') - coordinate(other, 'x')) >= 116 || Math.abs(coordinate(label, 'y') - coordinate(other, 'y')) >= 44).toBe(true)
    expect(parseFloat(label.style.getPropertyValue('--leader-length'))).toBeGreaterThan(0)
    fireEvent.click(label)
  }
  expect(studio.onSelect.mock.calls).toEqual([['data'], ['history'], ['fuel'], ['photos'], ['more']])
})
it('switches to the requested body asset and discards a previous body that finishes late', async () => {
  let complete!: (gltf: GLTF) => void
  const old = asset(), next = asset(), disposed = vi.spyOn(old.geometry, 'dispose')
  mocks.load.mockImplementationOnce(() => new Promise<GLTF>(resolve => { complete = resolve })).mockResolvedValueOnce(next.gltf)
  const callbacks = props(), view = render(<VehicleStudio {...callbacks} model={{ ...vehicleModel('Estate'), paintMaterials: testModel.paintMaterials }} />)
  view.rerender(<VehicleStudio {...callbacks} model={vehicleModel('Box')} />)
  await screen.findByRole('button', { name: 'Forgatás jobbra' })
  expect(mocks.load.mock.calls.map(call => call[0])).toEqual([vehicleModel('Estate').url, vehicleModel('Box').url])
  await act(async () => { complete(old.gltf) })
  expect(disposed).toHaveBeenCalledTimes(1)
  expect(next.paint.color.getHexString()).toBe('214d81')
  expect(mocks.render).not.toHaveBeenCalled()
})
it('disposes a late-arriving model after unmount without reviving its renderer', async () => {
  let complete!: (gltf: GLTF) => void
  mocks.load.mockImplementation(() => new Promise<GLTF>(resolve => { complete = resolve }))
  const { gltf, geometry } = asset(), dispose = vi.spyOn(geometry, 'dispose')
  const view = render(<VehicleStudio {...props()} />)
  view.unmount()
  await act(async () => { complete(gltf) })
  expect(dispose).toHaveBeenCalledTimes(1); expect(mocks.dispose).toHaveBeenCalledTimes(1)
  expect(mocks.forceContextLoss).toHaveBeenCalledTimes(1)
  expect(frames.size).toBe(0)
})
