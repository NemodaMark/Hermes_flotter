import { useEffect, useRef, useState } from 'react'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import studioLight from './assets/vehicles/studio-small-03.hdr?url'
import { disposeVehicleModel, prepareVehicleModel, setVehiclePaint } from './vehicleSceneModel'
import type { VehicleShape } from './vehicleSceneModel'
import { vehiclePaint } from './vehicleAppearance'
import type { VehicleModel } from './vehicleModels'
import { vehicleHotspots } from './vehicleHotspots'
import type { VehicleHotspot } from './vehicleHotspots'
import { buildStudioGarage } from './studioGarageScene'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'

export type StudioSection = 'data' | 'history' | 'services' | 'documents' | 'leases' | 'site' | 'photos'
type CameraAction = 'home' | 'left' | 'right' | 'closer' | 'farther'
export type StudioAction = { key: StudioSection | CameraAction; sequence: number }
export type StudioMenu = { key: StudioSection; label: string }
const isSection = (key: StudioAction['key']): key is StudioSection => !['home', 'left', 'right', 'closer', 'farther'].includes(key)

function contactShadow() {
  const width = 96, pixels = new Uint8Array(width * width * 4)
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const radius = Math.hypot((x + .5) / width * 2 - 1, (y + .5) / width * 2 - 1)
    const index = (y * width + x) * 4
    pixels.set([18, 29, 38, Math.round(85 * Math.max(0, 1 - radius ** 2) ** 2)], index)
  }
  const texture = new T.DataTexture(pixels, width, width)
  texture.magFilter = T.LinearFilter
  texture.needsUpdate = true
  const shadow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }))
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = .012
  return shadow
}

export default function VehicleStudio({ model, color, menus, action, onSelect, onFocused, onCancelled, paused = false }: {
  model: VehicleModel; color: string | null; menus: StudioMenu[]; action: StudioAction | null; paused?: boolean
  onSelect: (key: StudioSection) => void; onFocused: (key: StudioSection) => void; onCancelled: () => void
}) {
  const host = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null)
  const controls = useRef<{ focus: (key: StudioAction['key']) => void; cancel: () => void } | null>(null)
  const invalidate = useRef<(() => void) | null>(null)
  const callbacks = useRef({ onFocused, onCancelled })
  useEffect(() => { callbacks.current = { onFocused, onCancelled } }, [onFocused, onCancelled])
  const pausedRef = useRef(paused)
  useEffect(() => {
    pausedRef.current = paused
    if (paused) controls.current?.cancel()
    else invalidate.current?.()
  }, [paused])
  const [unavailable, setUnavailable] = useState(() => !window.WebGL2RenderingContext)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const paint = vehiclePaint(color).hex, paintRef = useRef(paint), loadedModel = useRef<T.Group | null>(null)
  useEffect(() => {
    paintRef.current = paint
    if (loadedModel.current) {
      setVehiclePaint(loadedModel.current, paint, model.paintMaterials)
      invalidate.current?.()
    }
  }, [paint, model.paintMaterials])
  useEffect(() => { invalidate.current?.() }, [menus])

  useEffect(() => {
    const container = host.current!
    if (!window.WebGL2RenderingContext) return
    queueMicrotask(() => setLoadState('loading'))
    let renderer: T.WebGLRenderer
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }) }
    catch { queueMicrotask(() => setUnavailable(true)); return }
    let disposed = false, contextLost = false
    let renderNeeded = true
    invalidate.current = () => { renderNeeded = true }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap
    renderer.toneMapping = T.NeutralToneMapping; renderer.toneMappingExposure = 1.02
    renderer.domElement.setAttribute('aria-label', 'Forgatható 3D járműmodell')
    renderer.domElement.setAttribute('role', 'img')
    container.prepend(renderer.domElement)
    const garageScale = Math.max(1, model.length / 4.8)
    const scene = new T.Scene()
    scene.background = new T.Color('#37322c')
    scene.fog = new T.Fog('#37322c', 22 * garageScale, 69 * garageScale)
    scene.add(buildStudioGarage(garageScale))
    const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), environment = pmrem.fromScene(room, .04)
    scene.environment = environment.texture; room.dispose(); pmrem.dispose()
    let lighting: T.DataTexture | undefined
    void new HDRLoader().loadAsync(studioLight).then(texture => {
      if (disposed || contextLost) { texture.dispose(); return }
      texture.mapping = T.EquirectangularReflectionMapping
      scene.environment = lighting = texture
      scene.environmentIntensity = .62
      scene.environmentRotation.y = Math.PI * .25
      renderNeeded = true
    }).catch(() => { /* The local room environment remains available. */ })
    scene.add(new T.HemisphereLight('#faf1e0', '#7f8588', .62))
    const key = new T.DirectionalLight('#fff0da', 1.55); key.position.set(3, 7, 4); key.castShadow = true
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6
    key.shadow.normalBias = .015; key.shadow.radius = 3; scene.add(key)
    const fill = new T.DirectionalLight('#e2edff', .82); fill.position.set(-4, 3, -5); scene.add(fill)
    const camera = new T.PerspectiveCamera(32, 1, .1, 80), home = new T.Vector3(4.3, 1.35, 5.4), homeTarget = new T.Vector3(0, .75, 0)
    camera.position.copy(home)
    const orbit = new OrbitControls(camera, renderer.domElement); orbit.target.copy(homeTarget)
    renderer.domElement.style.touchAction = 'pan-y'
    orbit.enableDamping = true; orbit.dampingFactor = .075; orbit.enablePan = false; orbit.minDistance = 4.5; orbit.maxDistance = 16
    orbit.minPolarAngle = .72; orbit.maxPolarAngle = Math.PI / 2 - .035; orbit.update()
    let shape: VehicleShape | null = null
    const positions: Partial<Record<StudioSection, VehicleHotspot>> = {}
    let hotspots: ReturnType<typeof vehicleHotspots> | null = null
    const targets: Record<StudioSection, T.Vector3> = {
      data: new T.Vector3(5.2, 2.8, 5.2), history: new T.Vector3(3.2, 1.1, 5.5), services: new T.Vector3(6.1, 2.3, 2.5),
      documents: new T.Vector3(3.5, 2.1, 5), leases: new T.Vector3(-5.8, 2.1, 4.2), site: new T.Vector3(-.5, 1.6, 6.2), photos: new T.Vector3(-5.8, 2.1, 4.8),
    }
    const labels: Record<StudioSection, [number, number]> = { data: [.3, .2], history: [.76, .78], services: [.85, .4], documents: [.69, .19], leases: [.14, .43], site: [.4, .83], photos: [.13, .68] }
    let flight: { key: StudioAction['key']; started: number; from: T.Vector3; targetFrom: T.Vector3; to: T.Vector3; targetTo: T.Vector3 } | null = null
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    controls.current = { cancel: cancelFlight, focus: section => {
      if (!loadedModel.current) { if (isSection(section)) callbacks.current.onFocused(section); return }
      if (!isSection(section)) callbacks.current.onCancelled()
      orbit.enabled = false
      let to: T.Vector3, targetTo: T.Vector3
      if (section === 'home') { to = home; targetTo = homeTarget }
      else if (!isSection(section)) {
        targetTo = orbit.target.clone()
        const offset = camera.position.clone().sub(targetTo)
        if (section === 'left' || section === 'right') offset.applyAxisAngle(new T.Vector3(0, 1, 0), section === 'left' ? Math.PI / 4 : -Math.PI / 4)
        else offset.setLength(T.MathUtils.clamp(offset.length() * (section === 'closer' ? .82 : 1.22), orbit.minDistance, orbit.maxDistance))
        to = offset.add(targetTo)
      } else { to = targets[section]; targetTo = positions[section]!.point.clone().lerp(homeTarget, .35) }
      flight = { key: section, started: performance.now(), from: camera.position.clone(), targetFrom: orbit.target.clone(), to, targetTo }
    } }
    function cancelFlight() { if (flight) callbacks.current.onCancelled(); flight = null; orbit.enabled = true }
    renderer.domElement.addEventListener('pointerdown', cancelFlight, true)
    const fit = () => {
      const width = container.clientWidth, height = container.clientHeight; if (!width || !height) return
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height)
      const length = shape?.length ?? model.length, roof = shape?.roof ?? 1.5
      homeTarget.y = roof * .48
      const distance = Math.max(length * 1.38, length * .65 / (Math.tan(T.MathUtils.degToRad(16)) * camera.aspect), roof * 2.85)
      orbit.maxDistance = 15 * garageScale
      home.set(4.3, 1.35, 5.4).normalize().multiplyScalar(distance).add(homeTarget)
      if (!flight) { camera.position.copy(home); orbit.target.copy(homeTarget); orbit.update() }
      renderNeeded = true
      renderer.render(scene, camera)
    }
    const resize = new ResizeObserver(fit); resize.observe(container)
    void new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(model.url).then(gltf => {
      if (disposed || contextLost) { disposeVehicleModel(gltf.scene); return }
      let vehicle: ReturnType<typeof prepareVehicleModel>
      try { vehicle = prepareVehicleModel(gltf.scene, paintRef.current, model) }
      catch (error) { disposeVehicleModel(gltf.scene); throw error }
      loadedModel.current = vehicle.model; shape = vehicle.shape; scene.add(vehicle.model)
      const { length, width, roof, frontAxle } = shape
      const shadow = contactShadow()
      shadow.scale.set(length * 1.16, width * 1.5, 1)
      scene.add(shadow)
      hotspots = vehicleHotspots(vehicle.model, length)
      const anchor = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => hotspots!.anchor(new T.Vector3(x, y, z), new T.Vector3(nx, ny, nz))
      const cameraScale = Math.max(1, length / 4.8, roof / 2)
      orbit.minDistance = Math.max(4.5, length * .8)
      for (const target of Object.values(targets)) target.multiplyScalar(cameraScale)
      Object.assign(positions, {
        data: anchor(-.05 * length, roof, 0, 0, 1, 0), history: anchor(frontAxle, .34, width * .43, 0, 0, 1),
        services: anchor(length * .29, roof * .43, 0, 0, 1, 0), documents: anchor(.08 * length, roof * .73, width * .34, 0, 0, 1),
        leases: anchor(-length * .4, roof * .55, 0, -1, 0, 0), site: anchor(-length * .08, roof * .5, width * .44, 0, 0, 1), photos: anchor(-length * .38, roof * .3, width * .42, 0, 0, 1),
      })
      fit(); setLoadState('ready')
    }).catch(() => { if (!disposed && !contextLost) setLoadState('error') })
    let frame = 0, last = 0
    const projected = new T.Vector3()
    const lastCamera = new T.Matrix4(), lastProjection = new T.Matrix4(), visiblePoints = new Map<StudioSection, boolean>()
    function animate(time: number) {
      if (disposed) return
      frame = requestAnimationFrame(animate)
      if (time - last < 30) return; last = time
      if (container.ownerDocument.hidden || pausedRef.current) return
      if (flight) {
        renderNeeded = true
        const t = reduceMotion.matches ? 1 : Math.min(1, (time - flight.started) / 850), ease = t * t * (3 - 2 * t)
        camera.position.lerpVectors(flight.from, flight.to, ease); orbit.target.lerpVectors(flight.targetFrom, flight.targetTo, ease)
        if (t === 1) { const section = flight.key; flight = null; orbit.enabled = true; if (isSection(section)) callbacks.current.onFocused(section) }
      }
      orbit.update()
      camera.updateMatrixWorld()
      const cameraChanged = !lastCamera.equals(camera.matrixWorld) || !lastProjection.equals(camera.projectionMatrix)
      if (!renderNeeded && !cameraChanged) return
      renderNeeded = false
      renderer.render(scene, camera)
      for (const button of overlay.current?.querySelectorAll<HTMLButtonElement>('[data-hotspot]') ?? []) {
        const section = button.dataset.hotspot as StudioSection, hotspot = positions[section]
        if (!hotspot || !hotspots) continue
        const { point } = hotspot
        if (cameraChanged || !visiblePoints.has(section)) visiblePoints.set(section, hotspots.visible(hotspot, camera.position))
        projected.copy(point).project(camera)
        button.style.left = `${(projected.x * .5 + .5) * 100}%`; button.style.top = `${(-projected.y * .5 + .5) * 100}%`
        const [labelX, labelY] = labels[section]
        const dx = (labelX - (projected.x * .5 + .5)) * container.clientWidth + 15, dy = (labelY - (-projected.y * .5 + .5)) * container.clientHeight + 15
        button.style.setProperty('--label-x', `${dx}px`); button.style.setProperty('--label-y', `${dy}px`)
        button.style.setProperty('--leader-length', `${Math.hypot(dx - 17, dy - 17)}px`); button.style.setProperty('--leader-angle', `${Math.atan2(dy - 17, dx - 17)}rad`)
        const visible = visiblePoints.get(section) && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1.05 && Math.abs(projected.y) <= 1.05
        // One parent controls the dot, leader and label together, including
        // keyboard and assistive-technology access to the hidden button.
        button.style.visibility = visible ? 'visible' : 'hidden'
        button.disabled = !visible
        button.setAttribute('aria-hidden', String(!visible))
      }
      lastCamera.copy(camera.matrixWorld); lastProjection.copy(camera.projectionMatrix)
    }
    frame = requestAnimationFrame(animate)
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; cancelAnimationFrame(frame); cancelFlight(); setUnavailable(true) }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    return () => {
      disposed = true; loadedModel.current = null; cancelAnimationFrame(frame); resize.disconnect(); orbit.dispose(); controls.current = null; invalidate.current = null
      renderer.domElement.removeEventListener('pointerdown', cancelFlight, true); renderer.domElement.removeEventListener('webglcontextlost', lost)
      disposeVehicleModel(scene); environment.dispose(); lighting?.dispose(); renderer.dispose(); renderer.domElement.remove()
    }
  }, [attempt, model])
  useEffect(() => {
    if (!action) return
    if (unavailable) { if (isSection(action.key)) callbacks.current.onFocused(action.key); return }
    controls.current?.focus(action.key)
  }, [action, unavailable])
  return <div className="vehicle-studio" ref={host} aria-busy={!unavailable && loadState === 'loading'}>
    {unavailable ? <div className="studio-unavailable" role="status"><p>A 3D nézet ezen az eszközön nem érhető el.</p><span>A jármű összes engedélyezett funkciója a menüből használható.</span></div> : <>
      {loadState !== 'ready' && <div className="studio-model-status" role="status">{loadState === 'loading' ? <p>Járműmodell betöltése…</p> : <><p>A járműmodell nem tölthető be. A gyorsmenü továbbra is használható.</p><button type="button" onClick={() => { setLoadState('loading'); setAttempt(value => value + 1) }}>Újrapróbálom</button></>}</div>}
      <div className="studio-hotspots" ref={overlay}>{menus.map(menu => <button type="button" key={menu.key} data-hotspot={menu.key} className="studio-hotspot" aria-label={`3D pont: ${menu.label}`} onClick={() => onSelect(menu.key)}><span aria-hidden="true" /><i aria-hidden="true" /><strong>{menu.label}</strong></button>)}</div>
      {loadState === 'ready' && <div className="studio-camera-controls" role="group" aria-label="Kamera vezérlése">
        <button type="button" aria-label="Forgatás balra" onClick={() => controls.current?.focus('left')}><ChevronLeft size={17} /></button>
        <button type="button" aria-label="Forgatás jobbra" onClick={() => controls.current?.focus('right')}><ChevronRight size={17} /></button>
        <button type="button" aria-label="Kamera közelítése" onClick={() => controls.current?.focus('closer')}><Plus size={17} /></button>
        <button type="button" aria-label="Kamera távolítása" onClick={() => controls.current?.focus('farther')}><Minus size={17} /></button>
      </div>}
    </>}
  </div>
}
