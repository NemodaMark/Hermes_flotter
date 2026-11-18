import { useEffect, useRef, useState } from 'react'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import studioLight from './assets/vehicles/studio-small-03.hdr?url'
import { batchVehicleMeshes, disposeVehicleModel, prepareVehicleModel, setVehiclePaint } from './vehicleSceneModel'
import type { VehicleShape } from './vehicleSceneModel'
import { vehiclePaint } from './vehicleAppearance'
import type { VehicleModel } from './vehicleModels'
import { vehicleHotspots } from './vehicleHotspots'
import type { VehicleHotspot } from './vehicleHotspots'
import { buildStudioGarage } from './studioGarageScene'
import { ChevronLeft, ChevronRight, Maximize, Minimize, Minus, Plus, RotateCcw } from 'lucide-react'

export type StudioSection = 'data' | 'history' | 'services' | 'documents' | 'leases' | 'site' | 'photos' | 'bookings' | 'fuel' | 'handovers' | 'assignees' | 'audit'
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

export default function VehicleStudio({ model, color, menus, action, onSelect, onFocused, onCancelled, onReset, immersive = false, paused = false }: {
  model: VehicleModel; color: string | null; menus: StudioMenu[]; action: StudioAction | null; paused?: boolean; immersive?: boolean
  onSelect: (key: StudioSection) => void; onFocused: (key: StudioSection) => void; onCancelled: () => void
  onReset?: () => void
}) {
  const host = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null)
  const controls = useRef<{ focus: (key: StudioAction['key']) => void } | null>(null)
  const invalidate = useRef<(() => void) | null>(null)
  const callbacks = useRef({ onFocused, onCancelled })
  useEffect(() => { callbacks.current = { onFocused, onCancelled } }, [onFocused, onCancelled])
  const pausedRef = useRef(paused)
  useEffect(() => {
    pausedRef.current = paused
    if (!paused) invalidate.current?.()
  }, [paused])
  const [unavailable, setUnavailable] = useState(() => !window.WebGL2RenderingContext)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [fullscreen, setFullscreen] = useState(() => !!document.fullscreenElement)
  useEffect(() => {
    if (!immersive) return
    const sync = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [immersive])
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch { /* The garage already fills the browser viewport when fullscreen is unavailable. */ }
  }
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
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' }) }
    catch { queueMicrotask(() => setUnavailable(true)); return }
    let disposed = false, contextLost = false
    let renderNeeded = true, frame = 0, previousFrame = 0
    let width = 0, height = 0, resolution = 0, quality = 1, slowFrames = 0, fastFrames = 0
    function requestFrame() {
      if (!frame && !disposed && !contextLost && !container.ownerDocument.hidden) frame = requestAnimationFrame(animate)
    }
    function invalidateFrame() { renderNeeded = true; requestFrame() }
    invalidate.current = invalidateFrame
    function setResolution() {
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.35, Math.sqrt(1_100_000 / (width * height))) * quality
      if (resolution !== pixelRatio) { resolution = pixelRatio; renderer.setPixelRatio(pixelRatio) }
    }
    function adjustQuality(elapsed: number) {
      if (!elapsed) return
      slowFrames = elapsed > 36 ? slowFrames + 2 : elapsed > 21 ? slowFrames + 1 : 0
      fastFrames = elapsed < 18 ? fastFrames + 1 : 0
      if (slowFrames >= 4 && quality > .32) quality = Math.max(.32, quality * (elapsed > 36 ? .72 : .86))
      else if (fastFrames >= 80 && quality < 1) quality = Math.min(1, quality * 1.12)
      else return
      setResolution()
      slowFrames = fastFrames = 0
    }
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap
    renderer.shadowMap.autoUpdate = false
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08
    renderer.domElement.setAttribute('aria-label', 'Forgatható 3D járműmodell')
    renderer.domElement.setAttribute('role', 'img')
    container.prepend(renderer.domElement)
    const garageScale = Math.max(1, model.length / 4.8)
    const scene = new T.Scene()
    scene.background = new T.Color('#171a19')
    scene.fog = new T.FogExp2('#171a19', .032 / garageScale)
    scene.add(buildStudioGarage(garageScale))
    const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), environment = pmrem.fromScene(room, .04)
    scene.environment = environment.texture; room.dispose(); pmrem.dispose()
    let lighting: T.DataTexture | undefined
    void new HDRLoader().loadAsync(studioLight).then(texture => {
      if (disposed || contextLost) { texture.dispose(); return }
      texture.mapping = T.EquirectangularReflectionMapping
      scene.environment = lighting = texture
      scene.environmentIntensity = .8
      scene.environmentRotation.y = Math.PI * .25
      invalidateFrame()
    }).catch(() => { /* The local room environment remains available. */ })
    scene.add(new T.HemisphereLight('#e6e9e3', '#414b49', .58))
    const key = new T.DirectionalLight('#fff1df', 1.85); key.position.set(3, 7, 4); key.castShadow = true
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6
    key.shadow.normalBias = .015; key.shadow.radius = 3; scene.add(key)
    const fill = new T.DirectionalLight('#e4ebee', .95); fill.position.set(-4, 3, -5); scene.add(fill)
    const camera = new T.PerspectiveCamera(35, 1, .1, 100), home = new T.Vector3(5, 1.95, 6.1), homeTarget = new T.Vector3(0, .75, 0)
    const homeDirection = home.clone().normalize()
    camera.position.copy(home)
    const orbit = new OrbitControls(camera, renderer.domElement); orbit.target.copy(homeTarget)
    renderer.domElement.style.touchAction = immersive ? 'none' : 'pan-y'
    orbit.enableDamping = true; orbit.dampingFactor = .075; orbit.enablePan = false; orbit.minDistance = 4.5; orbit.maxDistance = 16
    orbit.minPolarAngle = 1.06; orbit.maxPolarAngle = Math.PI / 2 - .075; orbit.update()
    orbit.addEventListener('change', requestFrame)
    let shape: VehicleShape | null = null
    const positions: Partial<Record<StudioSection, VehicleHotspot>> = {}
    let hotspots: ReturnType<typeof vehicleHotspots> | null = null
    const targets: Record<StudioSection, T.Vector3> = {
      data: new T.Vector3(5.2, 2.8, 5.2), history: new T.Vector3(3.2, 1.1, 5.5), services: new T.Vector3(6.1, 2.3, 2.5),
      documents: new T.Vector3(3.5, 2.1, 5), leases: new T.Vector3(-5.8, 2.1, 4.2), site: new T.Vector3(-.5, 1.6, 6.2), photos: new T.Vector3(-5.8, 2.1, 4.8),
      bookings: new T.Vector3(5.5, 2.5, -4.8), fuel: new T.Vector3(-5.7, 1.8, -4.1), handovers: new T.Vector3(6.3, 1.7, 2.8),
      assignees: new T.Vector3(-2.8, 1.9, 6.2), audit: new T.Vector3(-6.2, 2.3, 1.8),
    }
    const labels: Partial<Record<StudioSection, [number, number]>> = { data: [.36, .25], history: [.79, .69], services: [.85, .4], documents: [.69, .23], leases: [.22, .42], site: [.38, .73], photos: [.21, .63] }
    let framing = 0
    let flight: { key: StudioAction['key']; started: number; from: T.Spherical; to: T.Spherical; targetFrom: T.Vector3; targetTo: T.Vector3; frameFrom: number; frameTo: number } | null = null
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const widescreen = window.matchMedia('(min-width: 1001px) and (min-height: 491px)')
    controls.current = { focus: section => {
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
      } else {
        to = targets[section]
        targetTo = positions[section]?.point.clone().lerp(homeTarget, .72) ?? homeTarget
      }
      const from = new T.Spherical().setFromVector3(camera.position.clone().sub(orbit.target))
      const destination = new T.Spherical().setFromVector3(to.clone().sub(targetTo))
      destination.theta = from.theta + T.MathUtils.euclideanModulo(destination.theta - from.theta + Math.PI, 2 * Math.PI) - Math.PI
      const frameTo = isSection(section) && immersive && widescreen.matches ? 1 : 0
      if (frameTo) {
        const relativeWidth = (width - drawerWidth()) / height
        const framingDistance = lastFit * Math.max(1.65, .9 / relativeWidth)
        destination.radius = Math.min(orbit.maxDistance, Math.max(destination.radius, framingDistance))
      }
      flight = { key: section, started: performance.now(), from, to: destination, targetFrom: orbit.target.clone(), targetTo, frameFrom: framing, frameTo }
      requestFrame()
    } }
    function cancelFlight() { if (flight) callbacks.current.onCancelled(); flight = null; orbit.enabled = true }
    renderer.domElement.addEventListener('pointerdown', cancelFlight, true)
    let lastFit = 0
    function drawerWidth() { return Math.min(width * .68, 1280) }
    function projection() {
      if (!width || !height) return
      // Reserve the drawer's screen space while keeping the same camera orbit.
      const drawerOffset = widescreen.matches ? drawerWidth() / 2 * framing : 0
      camera.setViewOffset(width, height, drawerOffset, immersive && camera.aspect < 1 ? height * .016 : 0, width, height)
    }
    const fit = (reset = false) => {
      width = container.clientWidth; height = container.clientHeight
      if (!width || !height) return
      camera.aspect = width / height
      projection()
      setResolution()
      renderer.setSize(width, height)
      const length = shape?.length ?? model.length, roof = shape?.roof ?? 1.5, bodyWidth = shape?.width ?? 1.8
      const halfFov = Math.tan(T.MathUtils.degToRad(camera.fov / 2))
      const wide = length * homeDirection.z + bodyWidth * homeDirection.x
      const deep = length * homeDirection.x + bodyWidth * homeDirection.z
      const tall = roof + deep * homeDirection.y
      const distance = Math.max(wide / (2 * halfFov * camera.aspect * .81), tall / (2 * halfFov * .65)) + deep * .19
      homeTarget.y = roof * .48
      orbit.maxDistance = 16 * garageScale
      const fitted = T.MathUtils.clamp(distance, orbit.minDistance, orbit.maxDistance)
      home.copy(homeDirection).multiplyScalar(fitted).add(homeTarget)
      if (!flight) {
        if (reset || !lastFit) { camera.position.copy(home); orbit.target.copy(homeTarget) }
        else camera.position.sub(orbit.target).multiplyScalar(fitted / lastFit).add(orbit.target)
        orbit.update()
      }
      lastFit = fitted
      invalidateFrame()
    }
    const resize = new ResizeObserver(() => fit()); resize.observe(container)
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
      batchVehicleMeshes(vehicle.model)
      renderer.shadowMap.needsUpdate = true
      fit(true); invalidateFrame(); setLoadState('ready')
    }).catch(() => { if (!disposed && !contextLost) setLoadState('error') })
    const projected = new T.Vector3(), viewDirection = new T.Vector3()
    const lastCamera = new T.Matrix4(), lastProjection = new T.Matrix4(), visiblePoints = new Map<StudioSection, boolean>()
    let lastOcclusion = -Infinity
    function animate(time: number) {
      frame = 0
      if (disposed || container.ownerDocument.hidden || (pausedRef.current && !flight && !renderNeeded)) { previousFrame = 0; return }
      if (flight) {
        renderNeeded = true
        const t = reduceMotion.matches || (immersive && !widescreen.matches && isSection(flight.key)) ? 1 : T.MathUtils.clamp((time - flight.started) / 680, 0, 1)
        const ease = t * t * (3 - 2 * t)
        const { from, to, targetFrom, targetTo, frameFrom, frameTo } = flight
        const mix = T.MathUtils.lerp
        const nextFraming = mix(frameFrom, frameTo, ease)
        if (nextFraming !== framing) { framing = nextFraming; projection() }
        orbit.target.lerpVectors(targetFrom, targetTo, ease)
        camera.position.setFromSphericalCoords(mix(from.radius, to.radius, ease), mix(from.phi, to.phi, ease), mix(from.theta, to.theta, ease)).add(orbit.target)
        if (t === 1) { const section = flight.key; flight = null; orbit.enabled = true; if (isSection(section)) callbacks.current.onFocused(section) }
      }
      orbit.update()
      camera.updateMatrixWorld()
      const cameraChanged = !lastCamera.equals(camera.matrixWorld) || !lastProjection.equals(camera.projectionMatrix)
      if (!renderNeeded && !cameraChanged) { previousFrame = 0; return }
      adjustQuality(previousFrame ? time - previousFrame : 0)
      renderNeeded = false
      renderer.render(scene, camera)
      const checkOcclusion = time - lastOcclusion >= 80 || !cameraChanged
      for (const button of overlay.current?.querySelectorAll<HTMLButtonElement>('[data-hotspot]') ?? []) {
        const section = button.dataset.hotspot as StudioSection, hotspot = positions[section]
        const label = labels[section]
        if (!hotspot || !hotspots || !label) continue
        const { point } = hotspot
        projected.copy(point).project(camera)
        const onScreen = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1.05 && Math.abs(projected.y) <= 1.05
        const facingViewer = viewDirection.subVectors(camera.position, point).normalize().dot(hotspot.outward) > .015
        const candidate = !pausedRef.current && onScreen && facingViewer
        if (!candidate) visiblePoints.delete(section)
        else if (checkOcclusion || !visiblePoints.has(section)) visiblePoints.set(section, hotspots.visible(hotspot, camera.position))
        const visible = candidate && visiblePoints.get(section) === true
        if (visible) {
          const x = (projected.x * .5 + .5) * width, y = (-projected.y * .5 + .5) * height
          const dx = label[0] * width - x, dy = label[1] * height - y
          button.style.setProperty('--hotspot-x', `${x}px`); button.style.setProperty('--hotspot-y', `${y}px`)
          button.style.setProperty('--label-x', `${dx}px`); button.style.setProperty('--label-y', `${dy}px`)
          button.style.setProperty('--leader-length', `${Math.hypot(dx, dy)}px`); button.style.setProperty('--leader-angle', `${Math.atan2(dy, dx)}rad`)
        }
        // One parent controls the dot, leader and label together, including
        // keyboard and assistive-technology access to the hidden button.
        if (!button.style.visibility || button.disabled === visible) {
          button.style.visibility = visible ? 'visible' : 'hidden'
          button.disabled = !visible
          button.setAttribute('aria-hidden', String(!visible))
        }
      }
      if (checkOcclusion) lastOcclusion = time
      lastCamera.copy(camera.matrixWorld); lastProjection.copy(camera.projectionMatrix)
      if (flight || cameraChanged) {
        previousFrame = time
        requestFrame()
      } else previousFrame = 0
    }
    requestFrame()
    const visibilityChanged = () => { previousFrame = 0; invalidateFrame() }
    container.ownerDocument.addEventListener('visibilitychange', visibilityChanged)
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; cancelAnimationFrame(frame); cancelFlight(); setUnavailable(true) }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    return () => {
      disposed = true; loadedModel.current = null; cancelAnimationFrame(frame); resize.disconnect(); orbit.dispose(); controls.current = null; invalidate.current = null
      container.ownerDocument.removeEventListener('visibilitychange', visibilityChanged)
      orbit.removeEventListener('change', requestFrame)
      renderer.domElement.removeEventListener('pointerdown', cancelFlight, true); renderer.domElement.removeEventListener('webglcontextlost', lost)
      disposeVehicleModel(scene); environment.dispose(); lighting?.dispose(); renderer.dispose(); renderer.domElement.remove()
    }
  }, [attempt, immersive, model])
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
        <button type="button" aria-label="Kamera alaphelyzetbe" title="Alapnézet" onClick={onReset ?? (() => controls.current?.focus('home'))}><RotateCcw size={16} /></button>
        {immersive && document.fullscreenEnabled && <button type="button" aria-label={fullscreen ? 'Kilépés a teljes képernyőből' : 'Teljes képernyő'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>}
      </div>}
    </>}
  </div>
}
