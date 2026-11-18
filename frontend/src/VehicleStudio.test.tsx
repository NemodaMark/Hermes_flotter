import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, Vector3 } from 'three'
import type { PerspectiveCamera } from 'three'
import VehicleStudio from './VehicleStudio'
import { vehicleModel } from './vehicleModels'

const mocks = vi.hoisted(() => ({ load: vi.fn(), render: vi.fn(), dispose: vi.fn() }))
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three')
  return { ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas')
      shadowMap = { enabled: false, type: 0 }
      setPixelRatio() {} setSize() {}
      render = mocks.render
      dispose = mocks.dispose
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
  mocks.load.mockReset(); mocks.render.mockClear(); mocks.dispose.mockClear()
  frames = new Map(); sequence = 0
  vi.stubGlobal('WebGL2RenderingContext', class {})
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
  expect(frames.size).toBe(0)
})
