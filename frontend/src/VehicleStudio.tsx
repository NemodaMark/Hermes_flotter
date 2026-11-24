import { useEffect, useId, useRef, useState } from 'react'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import studioLight from './assets/vehicles/studio-small-03.hdr?url'
import compactStudioLight from './assets/vehicles/compact/studio-small-03.hdr?url'
import { batchVehicleMeshes, createContactShadow as contactShadow, disposeVehicleModel, prepareVehicleModel, setVehiclePaint, vehiclePixelRatio } from './vehicleSceneModel'
import type { VehicleShape } from './vehicleSceneModel'
import { vehiclePaint } from './vehicleAppearance'
import type { VehicleModel } from './vehicleModels'
import { vehicleHotspots } from './vehicleHotspots'
import type { VehicleHotspot } from './vehicleHotspots'
import { buildStudioGarage } from './studioGarageScene'
import { vehicleInteractionLayout } from './vehicleInteractionLayout'
import { ChevronLeft, ChevronRight, Maximize, Minimize, Minus, Pause, Play, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { Button } from './ui/Button'
import { LiquidGlass } from './ui/LiquidGlass'

export type StudioSection = 'data' | 'history' | 'services' | 'documents' | 'leases' | 'site' | 'photos' | 'bookings' | 'fuel' | 'handovers' | 'assignees' | 'audit'
type CameraAction = 'home' | 'resume' | 'left' | 'right' | 'closer' | 'farther'
export type StudioAction = { key: StudioSection | CameraAction; sequence: number }
export type StudioMenu = { key: StudioSection; label: string }
const isSection = (key: StudioAction['key']): key is StudioSection => !['home', 'resume', 'left', 'right', 'closer', 'farther'].includes(key)
const sectionAngles: Record<StudioSection, [azimuth: number, elevation: number]> = {
  data: [42, 21], history: [59, 8], services: [83, 15], documents: [25, 25],
  leases: [-68, 17], site: [-5, 11], photos: [-46, 22], bookings: [52, 20],
  fuel: [-55, 13], handovers: [111, 13], assignees: [-24, 10], audit: [-125, 23],
}

type ScreenPoint = [number, number]
const touchSections = ['data', 'services', 'site', 'documents', 'photos', 'fuel', 'history', 'leases']
const touchLabelWidth = 116, touchLabelHeight = 44, touchLabelGap = 8

function placeTouchLabel(x: number, y: number, width: number, height: number, occupied: ScreenPoint[]) {
  const outward = x < width / 2 ? -1 : 1
  const vertical = y < height * .56 ? -1 : 1
  const offsets: ScreenPoint[] = [[36 * outward, 54 * vertical], [0, 54 * vertical], [-48 * outward, 54 * vertical],
    [36 * outward, -54 * vertical], [0, -54 * vertical], [-48 * outward, -54 * vertical], [0, 92 * vertical]]
  const side = touchLabelWidth / 2 + touchLabelGap, edge = touchLabelHeight / 2 + touchLabelGap
  for (const [dx, dy] of offsets) {
    const left = T.MathUtils.clamp(x + dx, side, width - side)
    const top = T.MathUtils.clamp(y + dy, edge, height - edge)
    if (occupied.every(([otherX, otherY]) => Math.abs(otherX - left) >= touchLabelWidth + touchLabelGap
      || Math.abs(otherY - top) >= touchLabelHeight + touchLabelGap)) {
      const placed: ScreenPoint = [left, top]
      occupied.push(placed)
      return placed
    }
  }
}


export default function VehicleStudio({ model, color, menus, action, onSelect, onFocused, onCancelled, onReset, immersive = false, paused = false }: {
  model: VehicleModel; color: string | null; menus: StudioMenu[]; action: StudioAction | null; paused?: boolean; immersive?: boolean
  onSelect: (key: StudioSection) => void; onFocused: (key: StudioSection) => void; onCancelled: () => void
  onReset?: () => void
}) {
  const host = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null)
  const controls = useRef<{
    focus: (key: StudioAction['key']) => void
    togglePresentation: () => void
    stopPresentation: () => void
  } | null>(null)
  const invalidate = useRef<(() => void) | null>(null)
  const callbacks = useRef({ onFocused, onCancelled })
  useEffect(() => { callbacks.current = { onFocused, onCancelled } }, [onFocused, onCancelled])
  const pausedRef = useRef(paused)
  useEffect(() => {
    pausedRef.current = paused
    if (paused) controls.current?.stopPresentation()
    if (!paused) invalidate.current?.()
  }, [paused])
  const [presentationActive, setPresentationActive] = useState(false)
  const [cameraMenu, setCameraMenu] = useState(false)
  const cameraToggle = useRef<HTMLButtonElement>(null)
  const cameraControlsId = useId()
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
    if (!window.WebGL2RenderingContext) { queueMicrotask(() => setUnavailable(true)); return }
    const compactLighting = window.matchMedia('(max-width: 760px), (prefers-reduced-data: reduce)').matches
    queueMicrotask(() => setLoadState('loading'))
    let renderer: T.WebGLRenderer
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false }) }
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
      const pixelRatio = vehiclePixelRatio(width, height) * quality
      if (resolution !== pixelRatio) { resolution = pixelRatio; renderer.setPixelRatio(pixelRatio) }
    }
    function adjustQuality(elapsed: number) {
      if (!elapsed) return
      slowFrames = elapsed > 36 ? slowFrames + 2 : elapsed > 21 ? slowFrames + 1 : 0
      fastFrames = elapsed < 18 ? fastFrames + 1 : 0
      if (slowFrames >= 4 && quality > .5) quality = Math.max(.5, quality * (elapsed > 36 ? .72 : .86))
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
    let environment: T.WebGLRenderTarget | undefined
    let lighting: T.DataTexture | undefined
    void new HDRLoader().loadAsync(compactLighting ? compactStudioLight : studioLight).then(texture => {
      if (disposed || contextLost) { texture.dispose(); return }
      texture.mapping = T.EquirectangularReflectionMapping
      scene.environment = lighting = texture
      scene.environmentIntensity = .8
      scene.environmentRotation.y = Math.PI * .25
      invalidateFrame()
    }).catch(() => {
      if (disposed || contextLost) return
      const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment()
      try {
        environment = pmrem.fromScene(room, .04)
        scene.environment = environment.texture
        invalidateFrame()
      } catch { /* The direct lights can still illuminate the model. */ }
      finally { room.dispose(); pmrem.dispose() }
    })
    scene.add(new T.HemisphereLight('#e6e9e3', '#414b49', .58))
    const key = new T.DirectionalLight('#fff1df', 1.85); key.position.set(3, 7, 4); key.castShadow = true
    key.shadow.mapSize.setScalar(1024); key.shadow.camera.left = -6; key.shadow.camera.right = 6; key.shadow.camera.top = 6; key.shadow.camera.bottom = -6
    key.shadow.normalBias = .015; key.shadow.radius = 3; scene.add(key)
    const fill = new T.DirectionalLight('#e4ebee', .95); fill.position.set(-4, 3, -5); scene.add(fill)
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const widescreen = window.matchMedia('(min-width: 1001px) and (min-height: 491px)')
    const camera = new T.PerspectiveCamera(35, 1, .1, 100), home = new T.Vector3(5, 1.95, 6.1), homeTarget = new T.Vector3(0, .75, 0)
    const homeDirection = home.clone().normalize()
    camera.position.copy(home)
    const orbit = new OrbitControls(camera, renderer.domElement); orbit.target.copy(homeTarget)
    renderer.domElement.style.touchAction = immersive ? 'none' : 'pan-y'
    orbit.enableDamping = !reduceMotion.matches; orbit.dampingFactor = .075; orbit.enablePan = false; orbit.minDistance = 4.5; orbit.maxDistance = 16
    orbit.minPolarAngle = 1.06; orbit.maxPolarAngle = Math.PI / 2 - .075; orbit.update()
    orbit.addEventListener('change', requestFrame)
    let shape: VehicleShape | null = null
    const positions: Partial<Record<StudioSection, VehicleHotspot>> = {}
    let hotspots: ReturnType<typeof vehicleHotspots> | null = null
    const labels: Partial<Record<StudioSection, [number, number]>> = { data: [.36, .25], history: [.79, .69], fuel: [.22, .46], services: [.85, .4], documents: [.69, .23], leases: [.22, .42], site: [.38, .73], photos: [.21, .63] }
    let framing = 0, lastFit = 0
    let section: StudioSection | null = null
    let presentation = false, presentationTime = 0
    const presentationOffset = new T.Spherical(), presentationVector = new T.Vector3()
    let freeView: { offset: T.Spherical; target: T.Vector3; fit: number } | null = null
    let flight: {
      key: StudioAction['key']; started: number; duration: number; from: T.Spherical; to: T.Spherical
      targetFrom: T.Vector3; targetTo: T.Vector3; frameFrom: number; frameTo: number; clearance: number
    } | null = null
    function stopDamping() {
      const position = camera.position.clone(), target = orbit.target.clone()
      orbit.enableDamping = false
      orbit.update()
      camera.position.copy(position)
      orbit.target.copy(target)
    }
    function stopPresentation() {
      if (!presentation) return
      presentation = false
      presentationTime = 0
      orbit.enableDamping = !reduceMotion.matches
      setPresentationActive(false)
    }
    function togglePresentation() {
      if (presentation) { stopPresentation(); return }
      if (!loadedModel.current || pausedRef.current || contextLost) return
      cancelFlight()
      stopDamping()
      presentation = true
      presentationTime = 0
      orbit.enableDamping = false
      setPresentationActive(true)
      requestFrame()
    }
    function focus(key: StudioAction['key']) {
      stopPresentation()
      const opensSection = isSection(key)
      const wasInSection = section !== null
      section = opensSection ? key : null
      if (opensSection && (!loadedModel.current || (immersive && !widescreen.matches))) {
        if (loadedModel.current && !wasInSection) {
          cancelFlight()
          stopDamping()
          orbit.enableDamping = !reduceMotion.matches
        }
        callbacks.current.onFocused(key)
        return
      }
      if (!loadedModel.current || (key === 'resume' && !freeView)) return
      const startTarget = orbit.target.clone()
      const from = new T.Spherical().setFromVector3(camera.position.clone().sub(startTarget))
      const frameTo = opensSection && immersive ? 1 : 0
      let to = from.clone(), targetTo = startTarget

      if (opensSection) {
        freeView ??= { offset: from, target: startTarget, fit: lastFit }
        const [azimuth, elevation] = key === 'fuel' && shape && shape.roof > 2.05 ? [38, 12] : sectionAngles[key]
        const relativeWidth = height ? (width - drawerWidth()) / height : 1
        const quick = key === 'fuel' || key === 'history'
        const distance = frameTo ? lastFit * (quick ? 1.06 : Math.max(1.65, .9 / relativeWidth)) : lastFit
        to.set(distance || from.radius, T.MathUtils.degToRad(90 - elevation), T.MathUtils.degToRad(azimuth))
        targetTo = homeTarget.clone().lerp(positions[key]?.point ?? homeTarget, .18)
      } else if (key === 'resume' && freeView) {
        to = freeView.offset.clone()
        to.radius *= freeView.fit ? lastFit / freeView.fit : 1
        targetTo = freeView.target
      } else if (key === 'home') {
        freeView = null
        targetTo = homeTarget.clone()
        to.setFromVector3(home.clone().sub(targetTo))
      } else if (key === 'left' || key === 'right') {
        to.theta += key === 'left' ? Math.PI / 4 : -Math.PI / 4
      } else {
        to.radius *= key === 'closer' ? .82 : 1.22
      }
      to.radius = T.MathUtils.clamp(to.radius, orbit.minDistance, orbit.maxDistance)
      const turn = T.MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, 2 * Math.PI) - Math.PI
      to.theta = from.theta + turn
      const angle = Math.abs(turn) / Math.PI
      const duration = opensSection ? 500 + 260 * angle : key === 'resume' ? 430 + 220 * angle : 280

      if (!opensSection) callbacks.current.onCancelled()
      // Consume any leftover drag inertia before starting a scripted move.
      orbit.enabled = false
      stopDamping()
      flight = { key, started: performance.now(), duration, from, to, targetFrom: startTarget, targetTo,
        frameFrom: framing, frameTo, clearance: frameTo && framing === 1 ? to.radius * .09 * angle : 0 }
      requestFrame()
    }
    controls.current = { focus, togglePresentation, stopPresentation }
    function cancelFlight() {
      if (!flight) return
      if (flight.key === 'resume') {
        freeView = null
        framing = 0
        projection()
        invalidateFrame()
      }
      callbacks.current.onCancelled()
      flight = null
      orbit.enabled = true
      orbit.enableDamping = !reduceMotion.matches
    }
    function manualCamera() { stopPresentation(); cancelFlight() }
    renderer.domElement.addEventListener('pointerdown', manualCamera, true)
    renderer.domElement.addEventListener('wheel', manualCamera, { capture: true, passive: true })
    const garage = container.closest('.car-dashboard, .profile-garage') ?? container
    const garageClick = (event: Event) => {
      if (event.target instanceof Element && !event.target.closest('.studio-presentation-toggle, .studio-camera-toggle')) stopPresentation()
    }
    garage.addEventListener('click', garageClick, true)
    const compactView = () => immersive && width > 0 && width <= 760
    const portraitView = () => compactView() && height > width
    function drawerWidth() { return section === 'fuel' || section === 'history' ? Math.min(width * .43, 620) : Math.min(width * .68, 1280) }
    function projection() {
      if (!width || !height) return
      // Reserve the drawer's screen space while keeping the same camera orbit.
      const drawerOffset = widescreen.matches ? drawerWidth() / 2 * framing : 0
      const taskRail = immersive && height < 490 && width > height && width <= 1000 ? width * .15 : 0
      let verticalOffset = immersive && camera.aspect < 1 ? height * .016 : 0
      if (portraitView()) verticalOffset = -Math.min(height * .075, 58)
      camera.setViewOffset(width, height, drawerOffset + taskRail, verticalOffset, width, height)
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
      const safeWidth = immersive && camera.aspect < 1 && !portraitView() ? .72 : .81
      const distance = Math.max(wide / (2 * halfFov * camera.aspect * safeWidth), tall / (2 * halfFov * .65)) + deep * .19
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
      const { length, width } = shape
      const shadow = contactShadow()
      shadow.scale.set(length * 1.16, width * 1.5, 1)
      scene.add(shadow)
      hotspots = vehicleHotspots(vehicle.model, length)
      orbit.minDistance = Math.max(4.5, length * .8)
      for (const [section, { seed, outward }] of Object.entries(vehicleInteractionLayout(shape)))
        positions[section as StudioSection] = hotspots.anchor(seed, outward)
      batchVehicleMeshes(vehicle.model)
      renderer.shadowMap.needsUpdate = true
      fit(true)
      if (section && pausedRef.current) focus(section)
      invalidateFrame(); setLoadState('ready')
    }).catch(() => { if (!disposed && !contextLost) setLoadState('error') })
    const projected = new T.Vector3(), viewDirection = new T.Vector3()
    const lastCamera = new T.Matrix4(), lastProjection = new T.Matrix4(), visiblePoints = new Map<StudioSection, boolean>()
    const occupied: ScreenPoint[] = []
    let lastOcclusion = -Infinity
    function animate(time: number) {
      frame = 0
      if (disposed || container.ownerDocument.hidden || (pausedRef.current && !flight && !renderNeeded && quality === 1)) { previousFrame = 0; return }
      if (flight) {
        renderNeeded = true
        const t = reduceMotion.matches ? 1 : T.MathUtils.clamp((time - flight.started) / flight.duration, 0, 1)
        const ease = t * t * (3 - 2 * t)
        const { key, from, to, targetFrom, targetTo, frameFrom, frameTo, clearance } = flight
        const mix = T.MathUtils.lerp
        const nextFraming = mix(frameFrom, frameTo, ease)
        if (nextFraming !== framing) { framing = nextFraming; projection() }
        orbit.target.lerpVectors(targetFrom, targetTo, ease)
        const radius = mix(from.radius, to.radius, ease) + Math.sin(Math.PI * ease) * clearance
        camera.position.setFromSphericalCoords(radius, mix(from.phi, to.phi, ease), mix(from.theta, to.theta, ease)).add(orbit.target)
        if (t === 1) {
          if (key === 'resume') freeView = null
          flight = null
          orbit.enabled = true
          orbit.enableDamping = !reduceMotion.matches
          if (isSection(key)) callbacks.current.onFocused(key)
        }
      }
      if (presentation) {
        const elapsed = presentationTime ? Math.min((time - presentationTime) / 1000, .1) : 0
        presentationTime = time
        presentationOffset.setFromVector3(presentationVector.subVectors(camera.position, orbit.target))
        // One circuit takes 90 seconds, independent of the display refresh rate.
        presentationOffset.theta += elapsed * Math.PI * 2 / 90
        camera.position.setFromSpherical(presentationOffset).add(orbit.target)
        renderNeeded = true
      }
      orbit.update()
      camera.updateMatrixWorld()
      const cameraChanged = !lastCamera.equals(camera.matrixWorld) || !lastProjection.equals(camera.projectionMatrix)
      const moving = flight || presentation || (cameraChanged && !pausedRef.current)
      if (moving) adjustQuality(previousFrame ? time - previousFrame : 0)
      else {
        slowFrames = fastFrames = 0
        if (quality !== 1) {
          quality = 1
          setResolution()
          renderNeeded = true
        }
      }
      if (!renderNeeded && !cameraChanged) { previousFrame = 0; return }
      renderNeeded = false
      renderer.render(scene, camera)
      const checkOcclusion = time - lastOcclusion >= 80 || !cameraChanged
      const touchLayout = compactView()
      occupied.length = 0
      const buttons = overlay.current?.querySelectorAll<HTMLButtonElement>('[data-hotspot]') ?? []
      const ordered = touchLayout ? Array.from(buttons).sort((a, b) => touchSections.indexOf(a.dataset.hotspot!) - touchSections.indexOf(b.dataset.hotspot!)) : buttons
      for (const button of ordered) {
        const section = button.dataset.hotspot as StudioSection, hotspot = positions[section]
        const label = labels[section]
        if (!hotspot || !hotspots || !label) continue
        const { point } = hotspot
        projected.copy(point).project(camera)
        const onScreen = projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) <= 1.05 && Math.abs(projected.y) <= 1.05
        const facingViewer = viewDirection.subVectors(camera.position, point).normalize().dot(hotspot.outward) > .015
        const candidate = !pausedRef.current && onScreen && facingViewer && (!touchLayout || occupied.length < 3)
        if (!candidate) visiblePoints.delete(section)
        else if (checkOcclusion || !visiblePoints.has(section)) visiblePoints.set(section, hotspots.visible(hotspot, camera.position))
        let visible = candidate && visiblePoints.get(section) === true
        if (visible) {
          const anchorX = (projected.x * .5 + .5) * width, anchorY = (-projected.y * .5 + .5) * height
          const placed = touchLayout ? placeTouchLabel(anchorX, anchorY, width, height, occupied) : [anchorX, anchorY]
          visible = placed !== undefined
          if (placed) {
            const [x, y] = placed
            const dx = (touchLayout ? anchorX : label[0] * width) - x
            const dy = (touchLayout ? anchorY : label[1] * height) - y
            const leader = Math.hypot(dx, dy)
            button.style.setProperty('--hotspot-x', `${x}px`); button.style.setProperty('--hotspot-y', `${y}px`)
            button.style.setProperty('--label-x', `${dx}px`); button.style.setProperty('--label-y', `${dy}px`)
            button.style.setProperty('--leader-length', `${leader}px`); button.style.setProperty('--leader-angle', `${Math.atan2(dy, dx)}rad`)
          }
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
      if (moving) {
        previousFrame = time
        requestFrame()
      } else previousFrame = 0
    }
    requestFrame()
    const visibilityChanged = () => { previousFrame = presentationTime = 0; invalidateFrame() }
    container.ownerDocument.addEventListener('visibilitychange', visibilityChanged)
    const lost = (event: Event) => { event.preventDefault(); stopPresentation(); contextLost = true; cancelAnimationFrame(frame); cancelFlight(); setUnavailable(true) }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    return () => {
      disposed = true; loadedModel.current = null; cancelAnimationFrame(frame); resize.disconnect(); orbit.dispose(); controls.current = null; invalidate.current = null
      container.ownerDocument.removeEventListener('visibilitychange', visibilityChanged)
      orbit.removeEventListener('change', requestFrame)
      renderer.domElement.removeEventListener('pointerdown', manualCamera, true); renderer.domElement.removeEventListener('wheel', manualCamera, true)
      garage.removeEventListener('click', garageClick, true)
      renderer.domElement.removeEventListener('webglcontextlost', lost)
      disposeVehicleModel(scene); environment?.dispose(); lighting?.dispose()
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove()
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
      <div className="studio-hotspots" ref={overlay}>{menus.map(menu => <button type="button" key={menu.key} data-hotspot={menu.key} className="studio-hotspot" aria-label={`3D pont: ${menu.label}`} onClick={() => { controls.current?.stopPresentation(); onSelect(menu.key) }}><span aria-hidden="true" /><i aria-hidden="true" /><strong>{menu.label}</strong></button>)}</div>
      {loadState === 'ready' && <div className="studio-camera-container" onKeyDown={event => {
        if (event.key !== 'Escape' || !cameraMenu) return
        event.preventDefault()
        event.stopPropagation()
        setCameraMenu(false)
        cameraToggle.current?.focus()
      }}>
        <Button ref={cameraToggle} type="button" className="studio-camera-toggle glass-surface liquid-glass" aria-label={cameraMenu ? 'Kameravezérlés bezárása' : 'Kameravezérlés megnyitása'} aria-controls={cameraControlsId} aria-expanded={cameraMenu} onClick={() => setCameraMenu(value => !value)}><SlidersHorizontal size={17} /><span>Kamera</span></Button>
        <LiquidGlass id={cameraControlsId} className={`studio-camera-controls${cameraMenu ? ' is-open' : ''}`} role="group" aria-label="Kamera vezérlése">
        <button type="button" aria-label="Forgatás balra" onClick={() => controls.current?.focus('left')}><ChevronLeft size={17} /></button>
        <button type="button" aria-label="Forgatás jobbra" onClick={() => controls.current?.focus('right')}><ChevronRight size={17} /></button>
        <button type="button" aria-label="Kamera közelítése" onClick={() => controls.current?.focus('closer')}><Plus size={17} /></button>
        <button type="button" aria-label="Kamera távolítása" onClick={() => controls.current?.focus('farther')}><Minus size={17} /></button>
        <button type="button" aria-label="Kamera alaphelyzetbe" title="Alapnézet" onClick={onReset ?? (() => controls.current?.focus('home'))}><RotateCcw size={16} /></button>
        {immersive && document.fullscreenEnabled && <button type="button" aria-label={fullscreen ? 'Kilépés a teljes képernyőből' : 'Teljes képernyő'} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>}
        <Button type="button" className="studio-presentation-toggle" aria-pressed={presentationActive} disabled={paused}
          title={presentationActive ? 'Bemutató leállítása' : 'Lassú körbejárás indítása'}
          onClick={() => controls.current?.togglePresentation()}>
          {presentationActive ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          <span>Bemutató mód</span>
        </Button>
        </LiquidGlass>
      </div>}
    </>}
  </div>
}
