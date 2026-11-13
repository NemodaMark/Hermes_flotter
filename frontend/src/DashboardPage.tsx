import { lazy, Suspense, useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CarFront, Gauge, Wrench, FileText, RotateCcw, Camera, MapPin, LayoutDashboard } from 'lucide-react'
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
import { vehicleModel } from './vehicleModels'
import './dashboard.css'

const VehicleStudio=lazy(()=>import('./VehicleStudio'))
const daysUntil=(date:string|null,today=new Date())=>date?Math.round((Date.parse(`${date}T12:00:00Z`)-Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate(),12))/86400000):null
function dashboardDeadlines(cars:DashboardCar[]) {
  return cars.filter(car => car.vehicle.status !== 'Archived').flatMap(car => {
    const dateItems = [
      { kind: 'inspection', label: 'Műszaki vizsga', date: car.inspectionDueDate },
      { kind: 'insurance', label: 'Biztosítás', date: car.insuranceDueDate },
      { kind: 'service', label: 'Szerviz', date: car.nextServiceDate },
      { kind: 'appointment', label: 'Szervizidőpont', date: car.serviceAppointmentAt?.slice(0, 10) ?? null },
    ].flatMap(item => {
      const days = daysUntil(item.date)
      return days !== null && days <= 30 ? [{ ...item, days, car, distance: null as number | null }] : []
    })
    const distance = car.nextServiceKm != null && car.vehicle.odometerKm != null ? car.nextServiceKm - car.vehicle.odometerKm : null
    if (distance !== null && distance <= 1000) dateItems.push({ kind: 'service-km', label: 'Szerviz kilométerhatára', date: null, days: 0, car, distance })
    return dateItems
  }).sort((a, b) => a.days - b.days)
}
export function DashboardPage({ user,tenant,siteId,onFleet,onVehicle }: { user:Session;tenant:Tenant;siteId:string;onFleet:(status?:string)=>void;onVehicle:(id:string)=>void }) {
  const dashboard=useQuery({queryKey:['dashboard',user.id,tenant.id],queryFn:({signal})=>dashboardApi.read(tenant.id,signal),retry:false,refetchInterval:30000})
  const [override,setOverride]=useState<'Overview'|'Vehicle'|null>(null)
  const cars=(dashboard.data?.vehicles??[]).filter(car=>siteId==='all'||(siteId==='none'?!car.vehicle.siteId:car.vehicle.siteId===siteId))
  const mode=override??dashboard.data?.mode??'Overview'
  return <section className="dashboard-page" aria-label="Kezdőlap">
    <QueryMessage pending={dashboard.isPending} error={dashboard.error} retry={()=>void dashboard.refetch()}/>
    {dashboard.data&&<>
      <div className="dashboard-heading"><h2 className="sr-only">{mode==='Vehicle'?'Járműközpont':'Flotta áttekintés'}</h2>
        <div className="dashboard-view-switch" role="group" aria-label="Dashboard nézete"><Button aria-pressed={mode==='Overview'} onClick={()=>setOverride('Overview')}><LayoutDashboard size={16}/>Áttekintő</Button><Button aria-pressed={mode==='Vehicle'} onClick={()=>setOverride('Vehicle')}><CarFront size={17}/>Autós</Button></div>
        {mode === 'Overview' && dashboard.data.canReadVehicles && <Button className="secondary-button" aria-label="Járműlista megnyitása" onClick={() => onFleet()}>Járműlista<ArrowRight size={16} aria-hidden="true" /></Button>}
      </div>
      {!dashboard.data.canReadVehicles?<p className="notice">Nincs jogosultságod járműadatok megtekintéséhez.</p>:
        mode==='Overview'?<Overview cars={cars} onFleet={onFleet} onVehicle={onVehicle}/>:<CarDashboard key={`${tenant.id}:${siteId}`} cars={cars} user={user} tenant={tenant} onFleet={onFleet}/>}
    </>}
  </section>
}
function Overview({ cars, onFleet, onVehicle }: {
  cars: DashboardCar[]
  onFleet: (status?: string) => void
  onVehicle: (id: string) => void
}) {
  const [visibleDeadlines, setVisibleDeadlines] = useState(6)
  const deadlines = dashboardDeadlines(cars)
  const current = cars.filter(car => car.vehicle.status !== 'Archived')
  const totals = [
    { label: 'Jármű a flottában', shortLabel: 'Jármű', value: cars.length, status: undefined },
    { label: 'Aktív jármű', shortLabel: 'Aktív', value: cars.filter(car => car.vehicle.status === 'Active').length, status: 'Active' },
    { label: 'Szervizben', shortLabel: 'Szervizben', value: cars.filter(car => car.vehicle.status === 'Maintenance').length, status: 'Maintenance' },
  ]
  const sites = Array.from(current.reduce((counts, car) => {
    const name = car.vehicle.siteName ?? 'Telephely nélkül'
    counts.set(name, (counts.get(name) ?? 0) + 1)
    return counts
  }, new Map<string, number>()))

  return <section className="access-panel dashboard-overview" aria-label="Flotta összegzése">
    <div className="dashboard-overview-toolbar">
      <div className="dashboard-summary" role="group" aria-label="Flotta állapota">
        {totals.map(total => <Button key={total.label} variant="ghost" className="dashboard-summary-button"
          aria-label={`${total.label} megnyitása`} onClick={() => onFleet(total.status)}>
          <strong>{total.value}</strong><span>{total.shortLabel}</span>
        </Button>)}
      </div>
    </div>
    {!cars.length ? <p className="dashboard-empty">Ezen a munkaterületen még nincs jármű.</p> : <>
      <section className="dashboard-deadlines" aria-labelledby="dashboard-deadlines-heading">
        <div className="dashboard-section-heading">
          <h3 id="dashboard-deadlines-heading">Határidők <span>({deadlines.length})</span></h3>
          <span>Lejárt és közelgő határidők</span>
        </div>
        {deadlines.length ? <ul>
          {deadlines.slice(0, visibleDeadlines).map(item => <li key={`${item.car.vehicle.id}-${item.kind}`}>
            <Button variant="ghost" className="dashboard-deadline" onClick={() => onVehicle(item.car.vehicle.id)}
              aria-label={`${item.car.vehicle.registration} · ${item.label}`}>
              <strong>{item.car.vehicle.registration}</strong>
              <span className="dashboard-deadline-detail"><span>{item.label}</span>
                {item.date && <time dateTime={item.kind === 'appointment' ? item.car.serviceAppointmentAt ?? item.date : item.date}>
                  {item.kind === 'appointment' && item.car.serviceAppointmentAt ? new Date(item.car.serviceAppointmentAt).toLocaleString('hu-HU') : new Date(`${item.date}T12:00:00`).toLocaleDateString('hu-HU')}
                </time>}
              </span>
              <Badge dot={false} tone={item.days < 0 || (item.distance ?? 0) < 0 ? 'danger' : item.days === 0 ? 'warning' : 'neutral'}>
                {item.distance !== null ? item.distance < 0 ? `${-item.distance} km túllépés` : item.distance === 0 ? 'Esedékes' : `${item.distance} km hátra`
                  : item.days < 0 ? `${-item.days} napja lejárt` : item.days === 0 ? 'Ma esedékes' : `${item.days} nap múlva`}
              </Badge>
            </Button>
          </li>)}
        </ul> : <p className="dashboard-empty">Nincs esedékes határidő.</p>}
        {deadlines.length > visibleDeadlines && <div className="dashboard-more">
          <Button className="secondary-button" onClick={() => setVisibleDeadlines(count => count + 6)}>
            További határidők ({deadlines.length - visibleDeadlines})
          </Button>
        </div>}
      </section>
      {sites.length > 0 && <details className="dashboard-sites">
        <summary>Járművek telephelyenként <span>({sites.length})</span></summary>
        <dl>{sites.map(([name, count]) => <div key={name}><dt>{name}</dt><dd>{count}</dd></div>)}</dl>
      </details>}
    </>}
  </section>
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
  const model=vehicleModel(car.bodyType)
  return <>
    <section className="car-dashboard" aria-label="Autós dashboard">
      <div className="car-dashboard-toolbar"><div><span className="car-registration">{car.vehicle.registration}</span><span className="car-dashboard-model">{car.vehicle.make} {car.vehicle.model}</span></div><label className="car-picker"><span>Jármű kiválasztása</span><Select value={car.vehicle.id} onChange={event=>{setSelected(event.target.value);setAction(null);setOpened(null);setFlight(false)}}>{eligible.map(item=><option key={item.vehicle.id} value={item.vehicle.id}>{item.vehicle.registration}{item.isAssignedToMe?' · Nálam lévő jármű':''}</option>)}</Select></label></div>
      <div className="car-stage-wrap">
        <Suspense fallback={<div className="vehicle-studio studio-loading" role="status">3D nézet betöltése…</div>}><VehicleStudio key={`${car.vehicle.id}:${model.key}`} model={model} color={car.color} menus={menus} action={action} onSelect={focus} onFocused={focused} onCancelled={cancelled} paused={opened !== null}/></Suspense>
        <div className="car-stage-meta"><span>{bodyNames[car.bodyType]??'Egyéb karosszéria'}<i style={{backgroundColor:paint.hex}}/>{car.color??'Szín nincs megadva'}</span><Button className="studio-reset" aria-label="Kamera alaphelyzetbe" onClick={()=>{setFlight(false);setOpened(null);setAction(previous=>({key:'home',sequence:(previous?.sequence??0)+1}))}}><RotateCcw size={16}/>Alapnézet</Button></div>
        <div className="car-stage-instrument"><Gauge size={20}/><strong>{car.vehicle.odometerKm?.toLocaleString('hu-HU')??'–'}</strong><span>km</span></div>
        {flight&&<span className="studio-flight-status" role="status">Nézet beállítása…</span>}
      </div>
      <nav className="car-menu" aria-label="Jármű gyorsmenü">{menus.map(menu=>{const Icon=icons[menu.key];return <Button key={menu.key} onClick={()=>focus(menu.key)}><Icon size={20}/><span>{menu.label}</span><ArrowRight size={14}/></Button>})}</nav>
      <div className="car-dashboard-footer"><span><MapPin size={14}/>{car.vehicle.siteName??'Telephely nélkül'}</span><span>{car.isAssignedToMe?'Hozzám rendelt jármű':'Céges jármű'} · {car.vehicle.status==='Maintenance'?'Szervizben':car.vehicle.status==='Active'?'Aktív':'Inaktív'}</span></div>
      <div className="studio-credit"><span>{model.fallback?'Általános bemutatómodell · ':''}Karosszériatípus szerinti illusztráció · </span><a href={`${import.meta.env.BASE_URL}${model.license}`} target="_blank" rel="noreferrer">{model.credit}</a></div>
    </section>
    {!paint.matched&&car.color&&<p className="field-hint">A „{car.color}” színhez semleges árnyalat látható. A jármű színét ismert színnévvel vagy #RRGGBB kóddal pontosíthatod az adatlapon.</p>}
    {opened&&<AccessDialog title={`${car.vehicle.registration} · ${menus.find(menu=>menu.key===opened)?.label??'Jármű'}`} pending={false} onClose={()=>setOpened(null)} className="studio-vehicle-dialog"><VehiclePage key={`${car.vehicle.id}:${opened}`} user={user} tenant={tenant} id={car.vehicle.id} initialTab={opened} onBack={()=>setOpened(null)}/></AccessDialog>}
  </>
}
