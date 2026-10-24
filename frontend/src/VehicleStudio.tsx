import { useEffect, useRef, useState } from 'react'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { disposeVehicleModel, prepareVehicleModel, setVehiclePaint } from './vehicleSceneModel'
import type { VehicleShape } from './vehicleSceneModel'
import { vehiclePaint } from './vehicleAppearance'
import carModelUrl from './assets/car-concept.glb?url'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'

export type StudioSection = 'data' | 'history' | 'services' | 'documents' | 'leases' | 'site' | 'photos'
type CameraAction = 'home' | 'left' | 'right' | 'closer' | 'farther'
export type StudioAction = { key: StudioSection | CameraAction; sequence: number }
export type StudioMenu = { key: StudioSection; label: string }
const isSection = (key: StudioAction['key']): key is StudioSection => !['home', 'left', 'right', 'closer', 'farther'].includes(key)

export default function VehicleStudio({ color, menus, action, onSelect, onFocused, onCancelled, paused = false }: {
  color: string | null; menus: StudioMenu[]; action: StudioAction | null; paused?: boolean
  onSelect: (key: StudioSection) => void; onFocused: (key: StudioSection) => void; onCancelled: () => void
}) {
  const host = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null)
  const controls = useRef<{ focus: (key: StudioAction['key']) => void } | null>(null)
  const callbacks = useRef({ onFocused, onCancelled })
  useEffect(() => { callbacks.current = { onFocused, onCancelled } }, [onFocused, onCancelled])
  const pausedRef = useRef(paused)
  useEffect(() => { pausedRef.current = paused }, [paused])
  const [unavailable, setUnavailable] = useState(() => !window.WebGL2RenderingContext)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const paint = vehiclePaint(color).hex, paintRef = useRef(paint), loadedModel = useRef<T.Group | null>(null)
  useEffect(() => { paintRef.current = paint; if (loadedModel.current) setVehiclePaint(loadedModel.current, paint) }, [paint])

  useEffect(() => {
    const container = host.current!
    if (!window.WebGL2RenderingContext) return
    let renderer: T.WebGLRenderer
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }) }
    catch { queueMicrotask(() => setUnavailable(true)); return }
    let disposed = false, contextLost = false
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .98
    renderer.domElement.setAttribute('aria-label', 'Forgatható 3D járműmodell')
    renderer.domElement.setAttribute('role', 'img')
    container.prepend(renderer.domElement)
    const scene = new T.Scene(); scene.background = new T.Color('#dce4e5'); scene.fog = new T.Fog('#dce4e5', 18, 42)
    const pmrem = new T.PMREMGenerator(renderer), room = new RoomEnvironment(), environment = pmrem.fromScene(room, .04)
    scene.environment = environment.texture; room.dispose(); pmrem.dispose()
    const floor = new T.Mesh(new T.PlaneGeometry(150, 150), new T.MeshStandardMaterial({ color: '#c8d2d4', roughness: .64, metalness: .14 }))
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor)
    const platform = new T.Mesh(new T.CylinderGeometry(4.1, 4.15, .045, 96), new T.MeshStandardMaterial({ color: '#b5c3c6', roughness: .65, metalness: .2 }))
    platform.position.y = -.008; platform.receiveShadow = true; scene.add(platform)
    const ring = new T.Mesh(new T.TorusGeometry(4.07, .009, 8, 96), new T.MeshBasicMaterial({ color: '#93a9ac' }))
    ring.rotation.x = Math.PI / 2; ring.position.y = .025; scene.add(ring)
    scene.add(new T.HemisphereLight('#ffffff', '#9baeb6', 1))
    const key = new T.DirectionalLight('#fff8ed', 2.8); key.position.set(3, 7, 4); key.castShadow = true
    key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -7; key.shadow.camera.right = 7; key.shadow.camera.top = 7; key.shadow.camera.bottom = -7; key.shadow.normalBias = .025; scene.add(key)
    const fill = new T.DirectionalLight('#d5ecf8', 1.6); fill.position.set(-4, 3, -5); scene.add(fill)
    const camera = new T.PerspectiveCamera(32, 1, .1, 80), home = new T.Vector3(4.6, 2.4, 4.8), homeTarget = new T.Vector3(0, .75, 0)
    camera.position.copy(home)
    const orbit = new OrbitControls(camera, renderer.domElement); orbit.target.copy(homeTarget)
    orbit.enableDamping = true; orbit.dampingFactor = .075; orbit.enablePan = false; orbit.minDistance = 4.5; orbit.maxDistance = 16
    orbit.minPolarAngle = .25; orbit.maxPolarAngle = Math.PI / 2 - .035; orbit.update()
    let shape: VehicleShape | null = null
    const positions: Partial<Record<StudioSection, T.Vector3>> = {}
    const targets: Record<StudioSection, T.Vector3> = {
      data: new T.Vector3(5.2, 2.8, 5.2), history: new T.Vector3(3.2, 1.1, 5.5), services: new T.Vector3(6.1, 2.3, 2.5),
      documents: new T.Vector3(3.5, 2.1, 5), leases: new T.Vector3(-5.8, 2.1, 4.2), site: new T.Vector3(-.5, 1.6, 6.2), photos: new T.Vector3(-5.8, 2.1, 4.8),
    }
    const labels: Record<StudioSection, [number, number]> = { data: [.3, .2], history: [.76, .78], services: [.85, .4], documents: [.69, .19], leases: [.14, .43], site: [.4, .83], photos: [.13, .68] }
    let flight: { key: StudioAction['key']; started: number; from: T.Vector3; targetFrom: T.Vector3; to: T.Vector3; targetTo: T.Vector3 } | null = null
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
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
      } else { to = targets[section]; targetTo = positions[section]!.clone().lerp(homeTarget, .35) }
      flight = { key: section, started: performance.now(), from: camera.position.clone(), targetFrom: orbit.target.clone(), to, targetTo }
    } }
    const cancelFlight = () => { if (flight) callbacks.current.onCancelled(); flight = null; orbit.enabled = true }
    renderer.domElement.addEventListener('pointerdown', cancelFlight, true)
    const fit = () => {
      const width = container.clientWidth, height = container.clientHeight; if (!width || !height) return
      camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height)
      const distance = Math.max(6.95, (shape?.length ?? 4.8) * .64 / (Math.tan(T.MathUtils.degToRad(16)) * camera.aspect))
      home.set(4.6, 2.4, 4.8).normalize().multiplyScalar(distance)
      if (!flight) { camera.position.copy(home); orbit.target.copy(homeTarget); orbit.update() }
    }
    const resize = new ResizeObserver(fit); resize.observe(container)
    void new GLTFLoader().loadAsync(carModelUrl).then(gltf => {
      if (disposed || contextLost) { disposeVehicleModel(gltf.scene); return }
      const vehicle = prepareVehicleModel(gltf.scene, paintRef.current)
      loadedModel.current = vehicle.model; shape = vehicle.shape; scene.add(vehicle.model)
      const { length, width, roof, frontAxle } = shape
      Object.assign(positions, {
        data: new T.Vector3(-.05 * length, roof, 0), history: new T.Vector3(frontAxle, .34, width * .43),
        services: new T.Vector3(length * .29, roof * .43, 0), documents: new T.Vector3(.08 * length, roof * .73, width * .34),
        leases: new T.Vector3(-length * .4, roof * .55, 0), site: new T.Vector3(-length * .08, roof * .5, width * .44), photos: new T.Vector3(-length * .38, roof * .3, width * .42),
      })
      fit(); setLoadState('ready')
    }).catch(() => { if (!disposed && !contextLost) setLoadState('error') })
    let frame = 0, last = 0
    const projected = new T.Vector3()
    function animate(time: number) {
      if (disposed) return
      frame = requestAnimationFrame(animate)
      if (time - last < 30) return; last = time
      if (container.ownerDocument.hidden || pausedRef.current) return
      if (flight) {
        const t = reduceMotion.matches ? 1 : Math.min(1, (time - flight.started) / 850), ease = t * t * (3 - 2 * t)
        camera.position.lerpVectors(flight.from, flight.to, ease); orbit.target.lerpVectors(flight.targetFrom, flight.targetTo, ease)
        if (t === 1) { const section = flight.key; flight = null; orbit.enabled = true; if (isSection(section)) callbacks.current.onFocused(section) }
      }
      orbit.update(); renderer.render(scene, camera)
      for (const button of overlay.current?.querySelectorAll<HTMLButtonElement>('[data-hotspot]') ?? []) {
        const section = button.dataset.hotspot as StudioSection, point = positions[section]
        if (!point) continue
        projected.copy(point).project(camera)
        button.style.left = `${(projected.x * .5 + .5) * 100}%`; button.style.top = `${(-projected.y * .5 + .5) * 100}%`
        const [labelX, labelY] = labels[section]
        const dx = (labelX - (projected.x * .5 + .5)) * container.clientWidth + 15, dy = (labelY - (-projected.y * .5 + .5)) * container.clientHeight + 15
        button.style.setProperty('--label-x', `${dx}px`); button.style.setProperty('--label-y', `${dy}px`)
        button.style.setProperty('--leader-length', `${Math.hypot(dx - 17, dy - 17)}px`); button.style.setProperty('--leader-angle', `${Math.atan2(dy - 17, dx - 17)}rad`)
        button.style.visibility = projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05 ? 'hidden' : 'visible'
      }
    }
    frame = requestAnimationFrame(animate)
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; cancelAnimationFrame(frame); cancelFlight(); setUnavailable(true) }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    return () => {
      disposed = true; loadedModel.current = null; cancelAnimationFrame(frame); resize.disconnect(); orbit.dispose(); controls.current = null
      renderer.domElement.removeEventListener('pointerdown', cancelFlight, true); renderer.domElement.removeEventListener('webglcontextlost', lost)
      disposeVehicleModel(scene); environment.dispose(); renderer.dispose(); renderer.domElement.remove()
    }
  }, [attempt])
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
