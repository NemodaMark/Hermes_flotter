import { useEffect, useRef, useState } from 'react'
import * as T from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { buildVehicle } from './vehicleSceneModel'
import { vehiclePaint } from './vehicleAppearance'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'

export type StudioSection = 'data' | 'history' | 'services' | 'documents' | 'leases' | 'site' | 'photos'
type CameraAction = 'home' | 'left' | 'right' | 'closer' | 'farther'
export type StudioAction = { key: StudioSection | CameraAction; sequence: number }
export type StudioMenu = { key: StudioSection; label: string }
const isSection=(key:StudioAction['key']):key is StudioSection=>!['home','left','right','closer','farther'].includes(key)
export default function VehicleStudio({ bodyType, color, menus, action, onSelect, onFocused, onCancelled }: {
  bodyType: string; color: string | null; menus: StudioMenu[]; action: StudioAction | null
  onSelect: (key: StudioSection) => void; onFocused: (key: StudioSection) => void; onCancelled: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const controls = useRef<{ focus: (key: StudioAction['key']) => void } | null>(null)
  const callbacks = useRef({ onFocused, onCancelled })
  useEffect(()=>{callbacks.current={onFocused,onCancelled}},[onFocused,onCancelled])
  const [unavailable, setUnavailable] = useState(()=>!window.WebGL2RenderingContext)
  const paint = vehiclePaint(color).hex
  useEffect(() => {
    const container = host.current!
    if (!window.WebGL2RenderingContext) return
    let renderer: T.WebGLRenderer
    try { renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' }) }
    catch { queueMicrotask(()=>setUnavailable(true)); return }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6))
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap
    renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .98
    renderer.domElement.setAttribute('aria-label', 'Forgatható 3D járműmodell')
    renderer.domElement.setAttribute('role', 'img')
    container.prepend(renderer.domElement)
    const scene = new T.Scene(); scene.background = new T.Color('#dce4e5'); scene.fog = new T.Fog('#dce4e5',18,42)
    const pmrem = new T.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const environment = pmrem.fromScene(room,.04)
    scene.environment = environment.texture; room.dispose(); pmrem.dispose()
    const { model, shape } = buildVehicle(bodyType,paint); scene.add(model)
    const floor = new T.Mesh(new T.PlaneGeometry(150,150),new T.MeshStandardMaterial({color:'#c8d2d4',roughness:.64,metalness:.14}))
    floor.rotation.x=-Math.PI/2; floor.receiveShadow=true; scene.add(floor)
    const platform = new T.Mesh(new T.CylinderGeometry(4.1,4.15,.045,96),new T.MeshStandardMaterial({color:'#b5c3c6',roughness:.65,metalness:.2}))
    platform.position.y=-.008; platform.receiveShadow=true;scene.add(platform)
    const ring=new T.Mesh(new T.TorusGeometry(4.07,.009,8,96),new T.MeshBasicMaterial({color:'#93a9ac'}));ring.rotation.x=Math.PI/2;ring.position.y=.025;scene.add(ring)
    scene.add(new T.HemisphereLight('#ffffff','#9baeb6',1))
    const key=new T.DirectionalLight('#fff8ed',2.8);key.position.set(3,7,4);key.castShadow=true
    key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-7;key.shadow.camera.right=7;key.shadow.camera.top=7;key.shadow.camera.bottom=-7;key.shadow.normalBias=.025;scene.add(key)
    const fill=new T.DirectionalLight('#d5ecf8',1.6);fill.position.set(-4,3,-5);scene.add(fill)
    const camera=new T.PerspectiveCamera(32,1,.1,80)
    const home=new T.Vector3(4.6,2.4,4.8), homeTarget=new T.Vector3(0,.9,0)
    camera.position.copy(home)
    const orbit=new OrbitControls(camera,renderer.domElement);orbit.target.copy(homeTarget)
    orbit.enableDamping=true;orbit.dampingFactor=.075;orbit.enablePan=false;orbit.minDistance=4.8;orbit.maxDistance=16
    orbit.minPolarAngle=.25;orbit.maxPolarAngle=Math.PI/2-.035;orbit.update()
    const positions: Record<StudioSection,T.Vector3> = {
      data:new T.Vector3(0,shape.roof+.08,0),history:new T.Vector3(shape.frontAxle,.62,shape.width/2+.12),
      services:new T.Vector3(shape.length/2-.25,1.07,0),documents:new T.Vector3(.7,shape.roof-.18,shape.width/2+.1),
      leases:new T.Vector3(-shape.length/2,1,0),site:new T.Vector3(-.55,1.03,shape.width/2+.1),photos:new T.Vector3(-shape.length/2,.65,shape.width/2+.1),
    }
    const targets: Record<StudioSection,T.Vector3> = {
      data:new T.Vector3(6,3.4,6),history:new T.Vector3(3.2,1.25,5.8),services:new T.Vector3(6.4,2.8,2.8),
      documents:new T.Vector3(3.8,2.6,5.5),leases:new T.Vector3(-6.3,2.5,4.5),site:new T.Vector3(-.5,2,6.7),photos:new T.Vector3(-6.3,2.4,5),
    }
    const labels:Record<StudioSection,[number,number]>={data:[.3,.2],history:[.76,.78],services:[.85,.4],documents:[.69,.19],leases:[.14,.43],site:[.4,.83],photos:[.13,.68]}
    let flight: { key: StudioAction['key']; started: number; from: T.Vector3; targetFrom: T.Vector3; to: T.Vector3; targetTo: T.Vector3 } | null=null
    const reduceMotion=window.matchMedia('(prefers-reduced-motion: reduce)')
    controls.current={focus:section=> {
      if(!isSection(section))callbacks.current.onCancelled()
      orbit.enabled=false
      let to:T.Vector3,targetTo:T.Vector3
      if(section==='home'){to=home;targetTo=homeTarget}
      else if(!isSection(section)){
        targetTo=orbit.target.clone()
        const offset=camera.position.clone().sub(targetTo)
        if(section==='left'||section==='right')offset.applyAxisAngle(new T.Vector3(0,1,0),section==='left'?Math.PI/4:-Math.PI/4)
        else offset.setLength(T.MathUtils.clamp(offset.length()*(section==='closer'?.82:1.22),orbit.minDistance,orbit.maxDistance))
        to=offset.add(targetTo)
      }else{to=targets[section];targetTo=positions[section].clone().multiplyScalar(.5)}
      flight={key:section,started:performance.now(),from:camera.position.clone(),targetFrom:orbit.target.clone(),
        to,targetTo}
    }}
    const cancelFlight=()=>{if(flight)callbacks.current.onCancelled();flight=null;orbit.enabled=true}
    renderer.domElement.addEventListener('pointerdown',cancelFlight,true)
    const resize=new ResizeObserver(()=>{
      const width=container.clientWidth,height=container.clientHeight;if(!width||!height)return
      camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height)
      const distance=Math.max(6.95,shape.length*.64/(Math.tan(T.MathUtils.degToRad(16))*camera.aspect))
      home.set(4.6,2.4,4.8).normalize().multiplyScalar(distance)
      if(!flight){camera.position.copy(home);orbit.target.copy(homeTarget);orbit.update()}
    })
    resize.observe(container)
    let frame=0,last=0,disposed=false
    const projected=new T.Vector3()
    function animate(time:number) {
      if(disposed)return
      frame=requestAnimationFrame(animate)
      if(time-last<30)return;last=time
      if(container.ownerDocument.hidden)return
      if(flight){
        const t=reduceMotion.matches?1:Math.min(1,(time-flight.started)/850),ease=t*t*(3-2*t)
        camera.position.lerpVectors(flight.from,flight.to,ease);orbit.target.lerpVectors(flight.targetFrom,flight.targetTo,ease)
        if(t===1){const key=flight.key;flight=null;orbit.enabled=true;if(isSection(key))callbacks.current.onFocused(key)}
      }
      orbit.update();renderer.render(scene,camera)
      for(const button of overlay.current?.querySelectorAll<HTMLButtonElement>('[data-hotspot]')??[]){
        const point=positions[button.dataset.hotspot as StudioSection]
        projected.copy(point).project(camera)
        button.style.left=`${(projected.x*.5+.5)*100}%`;button.style.top=`${(-projected.y*.5+.5)*100}%`
        const [labelX,labelY]=labels[button.dataset.hotspot as StudioSection]
        const dx=(labelX-(projected.x*.5+.5))*container.clientWidth+15,dy=(labelY-(-projected.y*.5+.5))*container.clientHeight+15
        button.style.setProperty('--label-x',`${dx}px`);button.style.setProperty('--label-y',`${dy}px`)
        button.style.setProperty('--leader-length',`${Math.hypot(dx-17,dy-17)}px`);button.style.setProperty('--leader-angle',`${Math.atan2(dy-17,dx-17)}rad`)
        button.style.visibility=projected.z>1||Math.abs(projected.x)>1.05||Math.abs(projected.y)>1.05?'hidden':'visible'
      }
    }
    frame=requestAnimationFrame(animate)
    const lost=(event:Event)=>{event.preventDefault();cancelAnimationFrame(frame);cancelFlight();setUnavailable(true)}
    renderer.domElement.addEventListener('webglcontextlost',lost)
    return ()=>{
      disposed=true;cancelAnimationFrame(frame);resize.disconnect();orbit.dispose();controls.current=null
      renderer.domElement.removeEventListener('pointerdown',cancelFlight,true);renderer.domElement.removeEventListener('webglcontextlost',lost)
      scene.traverse(item=>{if(item instanceof T.Mesh||item instanceof T.Line){item.geometry.dispose();for(const material of Array.isArray(item.material)?item.material:[item.material])material.dispose()}})
      environment.dispose();renderer.dispose();renderer.domElement.remove()
    }
  },[bodyType,paint])
  useEffect(()=>{
    if(!action)return
    if(unavailable){if(isSection(action.key))callbacks.current.onFocused(action.key);return}
    controls.current?.focus(action.key)
  },[action,unavailable])
  return <div className="vehicle-studio" ref={host}>
    {unavailable?<div className="studio-unavailable" role="status"><p>A 3D nézet ezen az eszközön nem érhető el.</p><span>A jármű összes engedélyezett funkciója a menüből használható.</span></div>:
      <><div className="studio-hotspots" ref={overlay}>{menus.map(menu=><button type="button" key={menu.key} data-hotspot={menu.key} className="studio-hotspot" aria-label={`3D pont: ${menu.label}`} onClick={()=>onSelect(menu.key)}><span aria-hidden="true"/><i aria-hidden="true"/><strong>{menu.label}</strong></button>)}</div>
      <div className="studio-camera-controls" role="group" aria-label="Kamera vezérlése">
        <button type="button" aria-label="Forgatás balra" onClick={()=>controls.current?.focus('left')}><ChevronLeft size={17}/></button>
        <button type="button" aria-label="Forgatás jobbra" onClick={()=>controls.current?.focus('right')}><ChevronRight size={17}/></button>
        <button type="button" aria-label="Kamera közelítése" onClick={()=>controls.current?.focus('closer')}><Plus size={17}/></button>
        <button type="button" aria-label="Kamera távolítása" onClick={()=>controls.current?.focus('farther')}><Minus size={17}/></button>
      </div></>}
  </div>
}
