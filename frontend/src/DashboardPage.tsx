import { lazy, Suspense, useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, CalendarDays, Camera, CarFront, Ellipsis, FileText, Fuel, Gauge, Handshake, MapPin, Wrench } from 'lucide-react'
import type { Dashboard, DashboardCar, useDashboard } from './dashboardApi'
import { dashboardDeadlines, deadlineState } from './dashboardDeadlines'
import type { DashboardDeadline } from './dashboardDeadlines'
import type { Session, Tenant } from './api'
import type { StudioAction, StudioSection } from './VehicleStudio'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Badge } from './ui/Badge'
import { Disclosure } from './ui/Disclosure'
import { LiquidGlass } from './ui/LiquidGlass'
import { QueryMessage } from './FleetFields'
import { VehicleTaskPanel } from './VehicleTaskPanel'
import { vehicleTaskNames } from './vehicleDetailModel'
import { VehicleRecordingActions } from './VehicleActions'
import type { VehicleRecordingMode } from './VehicleActions'
import { VehicleGarage } from './VehicleGarage'
import { AccessDialog } from './AccessDialog'
import { useVehicleAccent } from './useVehicleAccent'
import './dashboard.css'
import './garage-hud.css'
const DashboardOverview = lazy(() => import('./DashboardOverview').then(module => ({ default: module.DashboardOverview })))

export function DashboardPage({ user, tenant, siteId, sites = [], canUnassigned = true, onFleet, onVehicle,
  dashboard, mode, compact, editing, onEditingChange, mileageOpen, onMileage }: {
  user: Session; tenant: Tenant; siteId: string; onFleet: (status?: string) => void; onVehicle: (id: string) => void
  sites?: { id: string; name: string }[]; canUnassigned?: boolean
  dashboard: ReturnType<typeof useDashboard>; mode: Dashboard['mode']; compact: boolean; editing: boolean
  onEditingChange: (editing: boolean) => void; mileageOpen: boolean; onMileage?: () => void
}) {
  const data = dashboard.error ? null : dashboard.data
  const cars = (data?.vehicles ?? []).filter(car => data?.canReadOverview || car.isAssignedToMe).filter(({ vehicle }) =>
    siteId === 'all' || (siteId === 'none' ? !vehicle.siteId : vehicle.siteId === siteId))
  return <section className="dashboard-page" aria-label="Kezdőlap">
    <QueryMessage pending={dashboard.isPending} error={dashboard.error} retry={() => void dashboard.refetch()} />
    {data && <>
      <h2 className="sr-only">{mode === 'Vehicle' ? 'Járműközpont' : data.canReadOverview ? 'Flotta áttekintés' : 'Saját áttekintés'}</h2>
      {mode === 'Overview' ? <Suspense fallback={<p role="status">Áttekintő betöltése…</p>}>
        <DashboardOverview key={user.id} user={user} tenant={tenant} siteId={siteId} sites={sites} canUnassigned={canUnassigned}
          canOverview={data.canReadOverview} canVehicles={data.canReadVehicles} canReadMileage={data.canReadMileage === true} onVehicle={onVehicle} onFleet={onFleet}
          onMileage={onMileage} dueMonth={data.mileageDueMonth} compact={compact} editing={editing} onEditingChange={onEditingChange} />
      </Suspense> : !data.canReadVehicles ? <p className="notice">Nincs jogosultságod járműadatok megtekintéséhez.</p>
        : <CarDashboard key={siteId} cars={cars} user={user} tenant={tenant} today={data.today} onFleet={onFleet}
          mileageOpen={mileageOpen} onProfile={onVehicle} onMileage={onMileage} dueMonth={data.mileageDueMonth} />}
    </>}
  </section>
}

const icons = { data: CarFront, history: Gauge, services: Wrench, documents: FileText, leases: FileText,
  site: MapPin, photos: Camera, bookings: CalendarDays, fuel: Fuel, handovers: Handshake }
type VehicleTab = keyof typeof icons

function CarDashboard({ cars, user, tenant, today, onFleet, onMileage, dueMonth, mileageOpen, onProfile }: {
  cars: DashboardCar[]; user: Session; tenant: Tenant; today: string; onFleet: () => void
  onMileage?: () => void; dueMonth?: string | null; mileageOpen: boolean
  onProfile: (id: string) => void
}) {
  const eligible = cars.filter(car => car.vehicle.status !== 'Archived')
  const [selected, setSelected] = useState<string | null>(null)
  const [action, setAction] = useState<StudioAction | null>(null)
  const [opened, setOpened] = useState<StudioSection | null>(null)
  const [recording, setRecording] = useState<VehicleRecordingMode | null>(null)
  const [allAttention, setAllAttention] = useState(false)
  const taskPending = useIsMutating() > 0
  const car = eligible.find(car => car.vehicle.id === selected) ?? eligible.find(car => car.isAssignedToMe) ?? eligible[0]
  useVehicleAccent(car?.color ?? null)
  const can = (code: string) => !!car?.vehicle.permissions?.includes(code)
  const canService = can('vehicles.service.read') || can('vehicles.service.manage')
  const canDocuments = can('vehicles.documents.read') || can('vehicles.documents.manage')
  const canBook = car?.bookingEnabled === true && (can('vehicles.bookings.read') || can('vehicles.bookings.manage'))
  const quickLabels: Partial<Record<VehicleTab, string>> = { data: 'Adatlap', ...(canBook ? { bookings: 'Foglalások' } : { photos: 'Képek' }),
    ...(!can('vehicles.odometer.create') ? { history: 'Km-állás' } : {}),
    ...(!can('vehicles.fuel.manage') && can('vehicles.fuel.read') ? { fuel: 'Tankolások' } : {}),
  }
  const points: { key: VehicleTab; label: string }[] = [
    { key: 'data', label: 'Járműadatok' }, { key: 'history', label: 'Kilométerállás' },
    ...(can('vehicles.fuel.manage') || can('vehicles.fuel.read') ? [{ key: 'fuel' as const, label: 'Tankolás' }] : []),
    ...(canService ? [{ key: 'services' as const, label: 'Szerviz' }] : []),
    ...(canDocuments ? [{ key: 'documents' as const, label: 'Dokumentumok' }] : []),
    ...(can('vehicles.leasing.read') || can('vehicles.leasing.manage') ? [{ key: 'leases' as const, label: 'Lízing' }] : []),
    { key: 'site', label: 'Telephely és használó' }, { key: 'photos', label: 'Képek' },
  ]
  const menus: { key: VehicleTab; label: string }[] = [
    ...points,
    ...(canBook ? [{ key: 'bookings' as const, label: 'Foglalások' }] : []),
    { key: 'handovers', label: 'Átadás-átvétel' },
  ]
  const focus = (key: StudioSection) => {
    setAllAttention(false)
    if (key === 'fuel' && can('vehicles.fuel.manage')) { changeRecording('fuel'); return }
    if (key === 'history' && can('vehicles.odometer.create')) { changeRecording('odometer'); return }
    setOpened(key)
    setAction(previous => ({ key, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const moveCamera = (key: 'resume' | 'home') => {
    setOpened(null)
    setRecording(null)
    setAction(previous => ({ key, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const closeDrawer = () => moveCamera('resume')
  const changeRecording = (mode: VehicleRecordingMode | null) => {
    setRecording(mode)
    setAction(previous => ({ key: mode === 'fuel' ? 'fuel' : mode === 'odometer' ? 'history' : 'resume', sequence: (previous?.sequence ?? 0) + 1 }))
  }
  if (!car) return <section className="access-panel dashboard-no-car">
    <CarFront size={28} aria-hidden="true" /><h3>Nincs hozzád rendelt, megtekinthető jármű</h3>
    <Button className="primary-button" onClick={onFleet}>Járműlista</Button>
  </section>

  const deadlines = dashboardDeadlines([car], today)
  const missingOdometer = car.vehicle.odometerKm == null && can('vehicles.odometer.create')
  const openDeadline = ({ kind }: DashboardDeadline) => {
    if (kind === 'inspection' || kind === 'insurance') focus(canDocuments ? 'documents' : 'data')
    else focus(canService ? 'services' : 'data')
  }
  const notices = [
    ...(dueMonth && onMileage ? [<Button key="month" className="car-attention-notice" onClick={() => { setAllAttention(false); onMileage() }}><Gauge size={17} aria-hidden="true" /><span>Havi km-elszámolás</span><Badge tone="danger" dot={false}>{dueMonth.slice(0, 7)} lezárandó</Badge></Button>] : []),
    ...(missingOdometer ? [<Button key="odometer" className="car-attention-notice" onClick={() => { setAllAttention(false); changeRecording('odometer') }}><Gauge size={17} aria-hidden="true" /><span>Rögzítendő kilométerállás</span></Button>] : []),
    ...deadlines.map(item => {
      const state = deadlineState(item)
      return <Button key={item.kind} className="car-attention-notice" onClick={() => openDeadline(item)}>
        <CalendarClock size={17} aria-hidden="true" /><span>{item.label}</span>
        {item.kind === 'appointment' && car.serviceAppointmentAt && <time dateTime={car.serviceAppointmentAt}>{car.serviceAppointmentAt.slice(11, 16)}</time>}
        <Badge tone={state.tone} dot={false}>{state.label}</Badge>
      </Button>
    }),
  ]
  return <>
    <section className="car-dashboard car-dashboard--studio" aria-label="Autós dashboard" data-task-open={opened !== null || recording !== null || mileageOpen || allAttention}>
      <VehicleGarage car={car.vehicle} bodyType={car.bodyType} color={car.color} menus={points} action={action} immersive
        onSelect={focus} paused={opened !== null || recording !== null || mileageOpen || allAttention} onReset={() => moveCamera('home')}
        overlay={<>
          <div className="car-dashboard-toolbar">
            <div className="car-identity">
              <div className="car-identity-heading"><h3 className="car-registration">{car.vehicle.registration}</h3>
                <span className="car-dashboard-model">{car.vehicle.make} {car.vehicle.model}</span></div>
              <div className="car-identity-detail">
                <Button className="car-mileage" aria-label={can('vehicles.odometer.create') ? `Kilométerállás rögzítése: ${car.vehicle.registration}` : 'Kilométerelőzmények megnyitása'} onClick={() => focus('history')}>
                  <Gauge size={17} aria-hidden="true" /><strong>{car.vehicle.odometerKm?.toLocaleString('hu-HU') ?? '—'}</strong><span>km</span>
                </Button>
                {car.vehicle.status === 'Maintenance' && <Badge tone="warning" dot={false}>Szervizben</Badge>}
                {car.vehicle.status === 'Inactive' && <Badge tone="neutral" dot={false}>Inaktív</Badge>}
              </div>
            </div>
            {eligible.length > 1 && <div className="car-dashboard-actions">
              <label className="car-picker"><span className="sr-only">Jármű kiválasztása</span>
                <Select liquidGlass value={car.vehicle.id} onChange={event => { setSelected(event.target.value); moveCamera('home') }}>
                  {eligible.map(item => <option key={item.vehicle.id} value={item.vehicle.id}>
                    {item.vehicle.registration}
                  </option>)}
                </Select>
              </label>
            </div>}
          </div>
          {notices.length > 0 && <section className="car-attention glass-surface liquid-glass" aria-label="Jármű teendői">
            {notices.slice(0, 2)}
            {notices.length > 2 && <Button className="car-attention-more" onClick={() => setAllAttention(true)}>Minden teendő ({notices.length})<ArrowRight size={14} aria-hidden="true" /></Button>}
          </section>}
        </>}>
        <LiquidGlass as="nav" className="car-menu" aria-label="Jármű gyorsmenü">
          <VehicleRecordingActions key={`recording:${car.vehicle.id}`} user={user} tenant={tenant} vehicle={car.vehicle} mode={recording} onModeChange={changeRecording} />
          {menus.filter(menu => quickLabels[menu.key]).map(menu => {
          const Icon = icons[menu.key]
          return <Button key={menu.key} aria-label={menu.label} onClick={() => focus(menu.key)}>
            <Icon size={18} aria-hidden="true" /><span>{quickLabels[menu.key]}</span>
          </Button>
        })}
          <Disclosure className="car-menu-more" key={`more:${car.vehicle.id}`}
            trigger={<><Ellipsis size={18} aria-hidden="true" /><span>Továbbiak</span></>}>
            <div className="glass-surface liquid-glass">{onMileage && <Button onClick={onMileage}><Gauge size={17} aria-hidden="true" />Havi km-elszámolás</Button>}{menus.filter(menu => !quickLabels[menu.key]).map(menu => {
              const Icon = icons[menu.key]
              return <Button key={menu.key} onClick={() => focus(menu.key)}><Icon size={17} aria-hidden="true" />{menu.label}</Button>
            })}</div>
          </Disclosure>
        </LiquidGlass>
      </VehicleGarage>
    </section>
    {allAttention && <AccessDialog title={`${car.vehicle.registration} · Teendők`} pending={false} onClose={() => setAllAttention(false)} className="car-attention-dialog"><div className="car-attention-list">{notices}</div></AccessDialog>}
    {opened && <AccessDialog title={`${car.vehicle.registration} · ${vehicleTaskNames[opened]}`}
      pending={taskPending} onClose={closeDrawer} className={`studio-vehicle-dialog vehicle-focused-task task-${opened}`}>
      <VehicleTaskPanel key={`${car.vehicle.id}:${opened}`} user={user} tenant={tenant} id={car.vehicle.id} section={opened} />
      {opened === 'data' && <div className="vehicle-task-footer"><Button variant="outline" onClick={() => onProfile(car.vehicle.id)}>Teljes járműadatlap</Button></div>}
    </AccessDialog>}
  </>
}
