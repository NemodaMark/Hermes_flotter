import * as T from 'three'

type Point = [number, number]
export type VehicleShape = { length: number; width: number; roof: number; frontAxle: number; rearAxle: number }
export function buildVehicle(bodyType: string, color: string): { model: T.Group; shape: VehicleShape } {
  const model = new T.Group()
  const commercial = ['Van', 'Box', 'ChassisCab', 'Tipper'].includes(bodyType)
  const tall = commercial || ['Suv', 'Minivan', 'Pickup'].includes(bodyType)
  const length = commercial ? 5.35 : bodyType === 'Coupe' || bodyType === 'Convertible' ? 4.35 : 4.6
  const width = commercial ? 2.02 : tall ? 1.95 : 1.84
  const roof = commercial ? 2.38 : bodyType === 'Minivan' ? 1.92 : tall ? 1.82 : ['Coupe','Convertible'].includes(bodyType) ? 1.4 : 1.53
  const frontAxle = length * .31, rearAxle = -length * .31
  const paint = new T.MeshPhysicalMaterial({ color, metalness: .72, roughness: .25, clearcoat: 1, clearcoatRoughness: .2 })
  const glass = new T.MeshPhysicalMaterial({ color: '#142631', metalness: .35, roughness: .12, clearcoat: 1 })
  const trim = new T.MeshStandardMaterial({ color: '#1d242a', roughness: .55, metalness: .2 })
  const alloy = new T.MeshStandardMaterial({ color: '#b9c3cb', metalness: .9, roughness: .25 })
  const rubber = new T.MeshStandardMaterial({ color: '#171c20', roughness: .95 })
  const light = new T.MeshStandardMaterial({ color: '#f4f6ec', emissive: '#d5efff', emissiveIntensity: .8, metalness: .3, roughness: .18 })
  const rearLight = new T.MeshStandardMaterial({ color: '#a5111d', emissive: '#a5111d', emissiveIntensity: .65, roughness: .25 })
  function mesh(geometry: T.BufferGeometry, material: T.Material, x = 0, y = 0, z = 0) {
    const item = new T.Mesh(geometry, material); item.position.set(x, y, z); item.castShadow = true; item.receiveShadow = true; model.add(item); return item
  }
  function box(x: number, y: number, z: number, sx: number, sy: number, sz: number, material: T.Material) { return mesh(new T.BoxGeometry(sx, sy, sz), material, x, y, z) }
  function profile(points: Point[], depth: number, material: T.Material, z = -depth / 2, bevel = .035) {
    const shape = new T.Shape(); points.forEach(([x,y], i) => i ? shape.lineTo(x,y) : shape.moveTo(x,y)); shape.closePath()
    return mesh(new T.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: bevel > 0, bevelSegments: 3, bevelSize: bevel, bevelThickness: bevel, curveSegments: 16 }), material, 0, 0, z)
  }
  const half = length / 2
  profile([[-half,.48],[-half,.85],[-half+.16,1.02],[half-.6,1.03],[half-.12,.9],[half,.68],[half-.07,.47]], width - .08, paint)
  box(0,.36,0,length-.3,.16,width-.12,trim)
  const cabRear = bodyType === 'Hatchback' ? -1.4 : ['Estate','Suv','Minivan','Van'].includes(bodyType) ? -half+.22 : commercial ? -.48 : bodyType === 'Pickup' ? -.6 : -1.18
  const roofRear = commercial ? cabRear+.12 : cabRear+.25
  const roofFront = commercial ? half-.8 : .48
  const windscreenBase = commercial ? half-.23 : 1.21
  if (bodyType === 'Convertible') {
    profile([[.48,1.03],[.48,roof],[.55,roof],[windscreenBase,1.03]], width-.21, paint)
  } else if (bodyType !== 'ChassisCab' && bodyType !== 'Tipper' && bodyType !== 'Box') {
    profile([[cabRear,1.03],[roofRear,roof-.03],[roofFront,roof],[windscreenBase,1.03]], width-.21, paint)
  } else {
    profile([[-.5,1.03],[-.5,2.05],[half-.85,2.05],[half-.25,1.03]], width-.18, paint)
    if (bodyType !== 'ChassisCab') {
      const material = bodyType === 'Box' ? new T.MeshStandardMaterial({ color, roughness: .45, metalness: .25 }) : paint
      box(-1.1,bodyType === 'Box' ? 1.42 : 1.05,0,2.7,bodyType === 'Box' ? 1.95 : .56,width+.1,material)
      if (bodyType === 'Tipper') { box(-1.1,1.34,-width/2,2.7,.22,.08,alloy); box(-1.1,1.34,width/2,2.7,.22,.08,alloy) }
    }
  }
  if (bodyType === 'Pickup') {
    box(-1.65,1.12,0,1.1,.18,width-.1,paint); box(-1.65,1.24,0,1,.08,width-.35,trim)
  }
  if (bodyType === 'Convertible') {
    box(-.22,1.31,0,1.8,.37,width-.42,trim)
    for (const z of [-.42,.42]) box(-.4,1.47,z,.45,.35,.36,trim)
  }
  // Tinted glazing sits on the actual cabin sides; pillars and a painted roof remain visible.
  const windowRear = commercial && ['ChassisCab','Box','Tipper'].includes(bodyType) ? -.43 : cabRear+.15
  const windowTop = commercial && ['ChassisCab','Box','Tipper'].includes(bodyType) ? 1.94 : roof-.12
  for (const side of [-1,1]) {
    const z = side * ((width-.21)/2+.038)
    const rear = commercial ? Math.max(windowRear, -.5) : windowRear
    profile([[rear,1.11],[Math.max(rear+.12,roofRear+.09),windowTop],[roofFront-.07,windowTop],[windscreenBase-.18,1.11]], .008, glass, z, 0)
    if (!commercial && !['Coupe','Convertible'].includes(bodyType)) box(-.28,(windowTop+1.1)/2,z,.065,windowTop-1.1,.024,trim)
    box(.78,1.03,side*(width/2+.09),.21,.13,.2,paint)
    box(.43,.97,side*(width/2+.025),.19,.032,.025,alloy)
    if (!['Coupe','Convertible'].includes(bodyType) && !commercial) box(-.8,.97,side*(width/2+.025),.19,.032,.025,alloy)
    const seam = new T.BufferGeometry().setFromPoints([new T.Vector3(.19,.48,z),new T.Vector3(.19,1.02,z)])
    model.add(new T.Line(seam,new T.LineBasicMaterial({color:'#38444c',transparent:true,opacity:.4})))
  }
  // Front windscreen, explicitly oriented across the width rather than a flat side graphic.
  const pane = new T.BufferGeometry()
  const paneRoof = commercial && ['Box','ChassisCab','Tipper'].includes(bodyType) ? 2.0 : roof-.09
  pane.setAttribute('position',new T.Float32BufferAttribute([roofFront+.06,paneRoof,-width*.38, windscreenBase+.04,1.1,-width*.41, windscreenBase+.04,1.1,width*.41, roofFront+.06,paneRoof,width*.38],3))
  pane.setIndex([0,1,2,0,2,3]); pane.computeVertexNormals(); const windshield=glass.clone(); windshield.side=T.DoubleSide; mesh(pane,windshield)
  for (const x of [frontAxle,rearAxle]) for (const side of [-1,1]) {
    const z = side*(width/2+.02), radius = commercial ? .43 : .37
    const tire = mesh(new T.CylinderGeometry(radius,radius,.24,40),rubber,x,.43,z); tire.rotation.x=Math.PI/2
    const rim = mesh(new T.CylinderGeometry(radius*.67,radius*.67,.25,32),alloy,x,.43,z); rim.rotation.x=Math.PI/2
    const hub = mesh(new T.CylinderGeometry(.08,.08,.27,24),trim,x,.43,z); hub.rotation.x=Math.PI/2
    for(let spoke=0;spoke<5;spoke++) {
      const a=spoke*Math.PI*2/5
      const cut=box(x+Math.sin(a)*radius*.37,.43+Math.cos(a)*radius*.37,z+side*.134,.065,radius*.4,.012,trim);cut.rotation.z=-a
    }
  }
  box(half+.01,.62,0,.035,.22,width*.55,trim)
  for (const side of [-1,1]) {
    box(half-.015,.86,side*width*.33,.05,.11,.42,light)
    box(-half-.01,.86,side*width*.37,.04,.19,.23,rearLight)
    box(half-.03,.43,side*width*.37,.08,.07,.25,trim)
  }
  box(half+.037,.52,0,.015,.12,.43,new T.MeshStandardMaterial({color:'#eeeeea',roughness:.4}))
  box(-half-.05,.54,0,.015,.12,.43,new T.MeshStandardMaterial({color:'#eeeeea',roughness:.4}))
  return { model, shape: { length, width, roof, frontAxle, rearAxle } }
}
