import { useEffect, useMemo, useRef, useState } from 'react'
import * as T from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Vehicle } from './api'
import { vehicleModel } from './vehicleModels'
import { vehiclePaint } from './vehicleAppearance'
import { batchVehicleMeshes, createContactShadow, disposeVehicleModel, prepareVehicleModel } from './vehicleSceneModel'
import { buildParkingLot, parkingLighting } from './parkingEnvironment'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import './showcase.css'

export default function FleetParking({ vehicles, onOpen }: { vehicles: Vehicle[]; onOpen: (id: string) => void }) {
  const host = useRef<HTMLDivElement>(null), callback = useRef(onOpen)
  const sceneData = JSON.stringify(vehicles.map(({ id, make, model, bodyType, color }) => ({ id, make, model, bodyType, color })))
  const sceneCars = useMemo<Pick<Vehicle, 'id' | 'make' | 'model' | 'bodyType' | 'color'>[]>(() => JSON.parse(sceneData), [sceneData])
  const [hour, setHour] = useState(() => new Date().getHours())
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading')
  useEffect(() => { callback.current = onOpen }, [onOpen])
  useEffect(() => { const timer = window.setInterval(() => setHour(new Date().getHours()), 60000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    const container = host.current!
    let renderer: T.WebGLRenderer
    try { renderer = new T.WebGLRenderer({ antialias: true, powerPreference: 'low-power' }) }
    catch { queueMicrotask(() => setState('fallback')); return }
    queueMicrotask(() => setState('loading'))
    let disposed = false, contextLost = false, frame = 0
    const palette = parkingLighting(hour), scene = new T.Scene()
    scene.background = new T.Color(palette.sky); scene.fog = new T.Fog(palette.sky, 28, 58)
    scene.add(buildParkingLot(sceneCars.length, hour))
    scene.add(new T.HemisphereLight('#e1e9df', '#343e39', palette.ambient))
    const light = new T.DirectionalLight(palette.light, palette.intensity); light.position.set(-7, 12, 7); scene.add(light)
    const room = new RoomEnvironment(), pmrem = new T.PMREMGenerator(renderer), environment = pmrem.fromScene(room, .08)
    scene.environment = environment.texture; scene.environmentIntensity = hour >= 20 || hour < 5 ? .22 : .5; room.dispose(); pmrem.dispose()
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1
    renderer.domElement.setAttribute('aria-label', '3D parkoló, a listázott járművekkel'); renderer.domElement.setAttribute('role', 'img')
    container.prepend(renderer.domElement)
    const camera = new T.PerspectiveCamera(36, 1, .1, 90)
    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.enablePan = false; orbit.enableZoom = false; orbit.enableDamping = false
    orbit.minPolarAngle = .75; orbit.maxPolarAngle = 1.18; orbit.minAzimuthAngle = -.65; orbit.maxAzimuthAngle = .65
    const draw = () => { frame = 0; if (!disposed && !contextLost && !document.hidden) renderer.render(scene, camera) }
    const invalidate = () => { if (!disposed && !contextLost && !frame && !document.hidden) frame = requestAnimationFrame(draw) }
    orbit.addEventListener('change', invalidate)
    const resize = new ResizeObserver(() => {
      const width = container.clientWidth, height = container.clientHeight
      if (!width || !height) return
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.2, Math.sqrt(800000 / (width * height))))
      renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix()
      const distance = Math.max(15, sceneCars.length * 4.1 / camera.aspect)
      camera.position.set(2.2, distance * .43, distance); orbit.target.set(0, .4, 0); orbit.update(); invalidate()
    }); resize.observe(container)
    const ray = new T.Raycaster(), pointer = new T.Vector2(), parked: T.Group[] = []
    let press = [0, 0]
    const down = (event: PointerEvent) => { press = [event.clientX, event.clientY] }
    const pick = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - press[0], event.clientY - press[1]) > 6) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
      ray.setFromCamera(pointer, camera)
      let target: T.Object3D | null = ray.intersectObjects(parked, true).find(hit => hit.object.visible)?.object ?? null
      while (target && !target.userData.vehicleId) target = target.parent
      if (target?.userData.vehicleId) callback.current(target.userData.vehicleId)
    }
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointerup', pick)
    const visibility = () => invalidate(); document.addEventListener('visibilitychange', visibility)
    const lost = (event: Event) => { event.preventDefault(); contextLost = true; setState('fallback'); cancelAnimationFrame(frame) }
    renderer.domElement.addEventListener('webglcontextlost', lost)
    // One canvas, at most four models, loaded sequentially. No animation loop or live shadow maps.
    void (async () => {
      for (const [index, car] of sceneCars.entries()) {
        const appearance = vehicleModel(car.bodyType ?? 'Unknown', car)
        const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(appearance.url)
        if (disposed || contextLost) { disposeVehicleModel(gltf.scene); return }
        const prepared = prepareVehicleModel(gltf.scene, vehiclePaint(car.color ?? null).hex, appearance)
        batchVehicleMeshes(prepared.model)
        const slot = new T.Group(); slot.userData.vehicleId = car.id
        slot.position.set((index - (sceneCars.length - 1) / 2) * 3.7, 0, 0); slot.rotation.y = -Math.PI / 2
        const shadow = createContactShadow(); shadow.scale.set(prepared.shape.length * 1.16, prepared.shape.width * 1.5, 1); slot.add(shadow)
        slot.add(prepared.model); scene.add(slot); parked.push(slot); invalidate()
      }
      if (!disposed) setState('ready')
    })().catch(() => { if (!disposed) setState('fallback') })
    invalidate()
    return () => {
      disposed = true; cancelAnimationFrame(frame); resize.disconnect(); orbit.dispose()
      document.removeEventListener('visibilitychange', visibility)
      renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointerup', pick); renderer.domElement.removeEventListener('webglcontextlost', lost)
      disposeVehicleModel(scene); environment.dispose(); renderer.dispose(); renderer.domElement.remove()
    }
  }, [sceneCars, hour])
  return <section className="fleet-parking" aria-label="Flottaparkoló">
    <div className="fleet-parking-stage" ref={host}><span className="parking-daytime">{parkingLighting(hour).name}</span>
      {state !== 'ready' && <p className="parking-state" role="status">{state === 'loading' ? 'Parkoló betöltése…' : 'A járműveket az alábbi listából nyithatod meg.'}</p>}
    </div>
    <div className="parking-vehicles">{vehicles.map(car => <Button key={car.id} className="parking-vehicle" onClick={() => onOpen(car.id)}>
      <strong>{car.registration}</strong><span>{car.make} {car.model}</span><Badge tone={car.status === 'Active' ? 'success' : car.status === 'Maintenance' ? 'warning' : 'neutral'}>{car.status === 'Active' ? 'Aktív' : car.status === 'Maintenance' ? 'Szervizben' : car.status === 'Archived' ? 'Archivált' : 'Inaktív'}</Badge>
      <small>{car.siteName ?? 'Telephely nélkül'}</small>
    </Button>)}</div>
    <a className="parking-credit" href={`${import.meta.env.BASE_URL}models/studio/LICENSE.md`} target="_blank" rel="noreferrer">3D modellek és licencek</a>
  </section>
}
