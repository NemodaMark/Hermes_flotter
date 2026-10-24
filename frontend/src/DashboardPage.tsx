import { lazy, Suspense, useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CarFront, Gauge, Wrench, FileText, CalendarDays, RotateCcw, Building2, Camera, MapPin, LayoutDashboard, CircleAlert, List } from 'lucide-react'
import { dashboardApi } from './dashboardApi'
import type { DashboardCar } from './dashboardApi'
import type { Session, Tenant } from './api'
import type { StudioAction, StudioMenu, StudioSection } from './VehicleStudio'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Badge } from './ui/Badge'
import { QueryMessage } from './FleetFields'
import { VehiclePage } from './VehiclePage'
import { AccessDialog } from './AccessDialog'
import { bodyNames, vehiclePaint } from './vehicleAppearance'
import './dashboard.css'

const VehicleStudio=lazy(()=>import('./VehicleStudio'))
const daysUntil=(date:string|null,today=new Date())=>date?Math.round((Date.parse(`${date}T12:00:00Z`)-Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate(),12))/86400000):null
function dashboardDeadlines(cars:DashboardCar[]) {
  return cars.filter(car=>car.vehicle.status!=='Archived').flatMap(car=>[
    { kind:'inspection',label:'Műszaki vizsga',date:car.inspectionDueDate },
    { kind:'insurance',label:'Biztosítás',date:car.insuranceDueDate },
    { kind:'service',label:'Szerviz',date:car.nextServiceDate },
  ].flatMap(item=>{const days=daysUntil(item.date);return days!==null&&days<=30?[{...item,days,car}]:[]})).sort((a,b)=>a.days-b.days)
}
export function DashboardPage({ user,tenant,siteId,onFleet,onVehicle }: { user:Session;tenant:Tenant;siteId:string;onFleet:(status?:string)=>void;onVehicle:(id:string)=>void }) {
  const dashboard=useQuery({queryKey:['dashboard',user.id,tenant.id],queryFn:({signal})=>dashboardApi.read(tenant.id,signal),retry:false,refetchInterval:30000})
  const [override,setOverride]=useState<'Overview'|'Vehicle'|null>(null)
  const cars=(dashboard.data?.vehicles??[]).filter(car=>siteId==='all'||(siteId==='none'?!car.vehicle.siteId:car.vehicle.siteId===siteId))
  const mode=override??dashboard.data?.mode??'Overview'
  return <section className="dashboard-page" aria-label="Kezdőlap">
    <QueryMessage pending={dashboard.isPending} error={dashboard.error} retry={()=>void dashboard.refetch()}/>
    {dashboard.data&&<>
      <div className="dashboard-heading"><div><p>{tenant.name}</p><h2>{mode==='Vehicle'?'Járműközpont':'Flotta áttekintés'}</h2></div>
        <div className="dashboard-view-switch" role="group" aria-label="Dashboard nézete"><Button aria-pressed={mode==='Overview'} onClick={()=>setOverride('Overview')}><LayoutDashboard size={16}/>Áttekintő</Button><Button aria-pressed={mode==='Vehicle'} onClick={()=>setOverride('Vehicle')}><CarFront size={17}/>Autós</Button></div>
      </div>
      {!dashboard.data.canReadVehicles?<p className="notice">Nincs jogosultságod járműadatok megtekintéséhez. A többi elérhető funkciót az oldalsó menüben találod.</p>:
        mode==='Overview'?<Overview cars={cars} onFleet={onFleet} onVehicle={onVehicle}/>:<CarDashboard key={`${tenant.id}:${siteId}`} cars={cars} user={user} tenant={tenant} onFleet={onFleet}/>}
    </>}
  </section>
}
function Overview({cars,onFleet,onVehicle}:{cars:DashboardCar[];onFleet:(status?:string)=>void;onVehicle:(id:string)=>void}) {
  const deadlines=dashboardDeadlines(cars),current=cars.filter(car=>car.vehicle.status!=='Archived')
  const totals=[{label:'Jármű a flottában',value:cars.length,icon:CarFront,status:undefined},{label:'Aktív jármű',value:cars.filter(car=>car.vehicle.status==='Active').length,icon:Gauge,status:'Active'},{label:'Szervizben',value:cars.filter(car=>car.vehicle.status==='Maintenance').length,icon:Wrench,status:'Maintenance'},{label:'30 napon belüli határidő',value:deadlines.length,icon:CalendarDays,status:null}]
  return <>
    <div className="dashboard-totals">{totals.map(total=><div key={total.label} className="dashboard-total"><total.icon size={21}/><strong>{total.value}</strong><span>{total.label}</span>{total.status!==null&&<Button aria-label={`${total.label} megnyitása`} className="text-button" onClick={()=>onFleet(total.status)}><ArrowRight size={17}/></Button>}</div>)}</div>
    <div className="dashboard-overview-columns">
      <section className="access-panel dashboard-deadlines"><div className="dashboard-section-heading"><h3>Közelgő és lejárt határidők</h3><span>{deadlines.length} tétel</span></div>
        {deadlines.length?<ul>{deadlines.slice(0,12).map(item=><li key={`${item.car.vehicle.id}-${item.kind}`}><span className={item.days<0?'deadline-icon overdue':'deadline-icon'}><CircleAlert size={18}/></span><div><Button className="text-button" onClick={()=>onVehicle(item.car.vehicle.id)}>{item.car.vehicle.registration}</Button><span>{item.label} · {new Date(`${item.date}T12:00:00`).toLocaleDateString('hu-HU')}</span></div><Badge tone={item.days<0?'danger':'warning'}>{item.days<0?`${-item.days} napja lejárt`:item.days===0?'Ma esedékes':`${item.days} nap múlva`}</Badge></li>)}</ul>:<p className="dashboard-empty">Nincs lejárt vagy 30 napon belüli határidő.</p>}
        {deadlines.length>12&&<p className="field-hint">A 12 legközelebbi határidő látható. A további adatokat a járműlistában érheted el.</p>}
      </section>
      <section className="access-panel dashboard-distribution"><div className="dashboard-section-heading"><h3>Telephelyek</h3><Building2 size={19}/></div>
        {Array.from(current.reduce((counts,car)=>{const name=car.vehicle.siteName??'Telephely nélkül';counts.set(name,(counts.get(name)??0)+1);return counts},new Map<string,number>())).map(([name,count])=><div className="dashboard-site-line" key={name}><div><span>{name}</span><strong>{count}</strong></div><div className="dashboard-site-bar"><span style={{width:`${count/Math.max(1,current.length)*100}%`}}/></div></div>)}
        {!current.length&&<p className="dashboard-empty">Még nincs jármű ezen a munkaterületen.</p>}
        <Button className="secondary-button" onClick={()=>onFleet()}><List size={16}/>Járműlista megnyitása</Button>
      </section>
    </div>
  </>
}
const icons={data:CarFront,history:Gauge,services:Wrench,documents:FileText,leases:FileText,site:MapPin,photos:Camera}
function CarDashboard({cars,user,tenant,onFleet}:{cars:DashboardCar[];user:Session;tenant:Tenant;onFleet:()=>void}) {
  const eligible=cars.filter(car=>car.vehicle.status!=='Archived')
  const [selected,setSelected]=useState<string|null>(null)
  const [action,setAction]=useState<StudioAction|null>(null)
  const [opened,setOpened]=useState<StudioSection|null>(null)
  const [flight,setFlight]=useState(false)
  const car=eligible.find(car=>car.vehicle.id===selected)??eligible.find(car=>car.isAssignedToMe)??eligible[0]
  const can=(code:string)=>!!car?.vehicle.permissions?.includes(code)
  const menus:StudioMenu[]=[{key:'data',label:'Járműadatok'},{key:'history',label:'Kilométerállás'},
    ...(can('vehicles.service.read')||can('vehicles.service.manage')?[{key:'services' as const,label:'Szerviz'}]:[]),
    ...(can('vehicles.documents.read')||can('vehicles.documents.manage')?[{key:'documents' as const,label:'Dokumentumok'}]:[]),
    ...(can('vehicles.leasing.read')||can('vehicles.leasing.manage')?[{key:'leases' as const,label:'Lízing'}]:[]),{key:'site',label:'Telephely és használó'},{key:'photos',label:'Képek'}]
  const focus=(key:StudioSection)=>{setOpened(null);setFlight(true);setAction(previous=>({key,sequence:(previous?.sequence??0)+1}))}
  const focused=useCallback((key:StudioSection)=>{setFlight(false);setOpened(key)},[setFlight,setOpened])
  const cancelled=useCallback(()=>setFlight(false),[setFlight])
  if(!car)return <section className="access-panel dashboard-no-car"><CarFront size={36}/><h3>Nincs megjeleníthető jármű</h3><p>Válassz másik telephelyet, vagy nyisd meg a járműlistát.</p><Button className="primary-button" onClick={onFleet}>Járműlista</Button></section>
  const paint=vehiclePaint(car.color)
  return <>
    <section className="car-dashboard" aria-label="Autós dashboard">
      <div className="car-dashboard-toolbar"><div><span className="car-registration">{car.vehicle.registration}</span><span className="car-dashboard-model">{car.vehicle.make} {car.vehicle.model}</span></div><label className="car-picker"><span>Jármű kiválasztása</span><Select value={car.vehicle.id} onChange={event=>{setSelected(event.target.value);setAction(null);setOpened(null);setFlight(false)}}>{eligible.map(item=><option key={item.vehicle.id} value={item.vehicle.id}>{item.vehicle.registration}{item.isAssignedToMe?' · Nálam lévő jármű':''}</option>)}</Select></label></div>
      <div className="car-stage-wrap">
        <Suspense fallback={<div className="vehicle-studio studio-loading" role="status">3D nézet betöltése…</div>}><VehicleStudio key={car.vehicle.id} bodyType={car.bodyType} color={car.color} menus={menus} action={action} onSelect={focus} onFocused={focused} onCancelled={cancelled}/></Suspense>
        <div className="car-stage-meta"><span>{bodyNames[car.bodyType]??'Egyéb karosszéria'}<i style={{backgroundColor:paint.hex}}/>{car.color??'Szín nincs megadva'}</span><Button className="studio-reset" aria-label="Kamera alaphelyzetbe" onClick={()=>{setFlight(false);setOpened(null);setAction(previous=>({key:'home',sequence:(previous?.sequence??0)+1}))}}><RotateCcw size={16}/>Alapnézet</Button></div>
        <div className="car-stage-instrument"><Gauge size={20}/><strong>{car.vehicle.odometerKm?.toLocaleString('hu-HU')??'–'}</strong><span>km</span></div>
        {flight&&<span className="studio-flight-status" role="status">Nézet beállítása…</span>}
      </div>
      <nav className="car-menu" aria-label="Jármű gyorsmenü">{menus.map(menu=>{const Icon=icons[menu.key];return <Button key={menu.key} onClick={()=>focus(menu.key)}><Icon size={20}/><span>{menu.label}</span><ArrowRight size={14}/></Button>})}</nav>
      <div className="car-dashboard-footer"><span><MapPin size={14}/>{car.vehicle.siteName??'Telephely nélkül'}</span><span>{car.isAssignedToMe?'Hozzám rendelt jármű':'Céges jármű'} · {car.vehicle.status==='Maintenance'?'Szervizben':car.vehicle.status==='Active'?'Aktív':'Inaktív'}</span></div>
    </section>
    {!paint.matched&&car.color&&<p className="field-hint">A „{car.color}” színhez semleges árnyalat látható. A jármű színét ismert színnévvel vagy #RRGGBB kóddal pontosíthatod az adatlapon.</p>}
    {opened&&<AccessDialog title={`${car.vehicle.registration} · ${menus.find(menu=>menu.key===opened)?.label??'Jármű'}`} pending={false} onClose={()=>setOpened(null)} className="studio-vehicle-dialog"><VehiclePage key={`${car.vehicle.id}:${opened}`} user={user} tenant={tenant} id={car.vehicle.id} initialTab={opened} onBack={()=>setOpened(null)}/></AccessDialog>}
  </>
}
