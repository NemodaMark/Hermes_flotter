import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, CalendarDays, Camera, CarFront, FileText, Fuel, Gauge, Handshake, LayoutDashboard, MapPin, Wrench } from 'lucide-react'
import { dashboardApi } from './dashboardApi'
import type { DashboardCar } from './dashboardApi'
import { dashboardDeadlines, deadlineState } from './dashboardDeadlines'
import type { DashboardDeadline } from './dashboardDeadlines'
import type { Session, Tenant } from './api'
import type { StudioAction, StudioMenu, StudioSection } from './VehicleStudio'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Badge } from './ui/Badge'
import { QueryMessage } from './FleetFields'
import { VehiclePage } from './VehiclePage'
import { VehicleActions } from './VehicleActions'
import { VehicleGarage } from './VehicleGarage'
import { FleetDashboardOverview } from './FleetDashboardOverview'
import { AccessDialog } from './AccessDialog'
import './dashboard.css'

export function DashboardPage({ user, tenant, siteId, onFleet, onVehicle }: {
  user: Session; tenant: Tenant; siteId: string; onFleet: (status?: string) => void; onVehicle: (id: string) => void
}) {
  const dashboard = useQuery({ queryKey: ['dashboard', user.id, tenant.id],
    queryFn: ({ signal }) => dashboardApi.read(tenant.id, signal), retry: false, refetchInterval: 30000 })
  const [override, setOverride] = useState<'Overview' | 'Vehicle' | null>(null)
  const data = dashboard.error ? null : dashboard.data
  const cars = (data?.vehicles ?? []).filter(({ vehicle }) =>
    siteId === 'all' || (siteId === 'none' ? !vehicle.siteId : vehicle.siteId === siteId))
  const mode = data?.canReadOverview ? override ?? data.mode : 'Vehicle'
  const viewSwitch = data?.canReadOverview && <div className="dashboard-view-switch" role="group" aria-label="Kezdőlap nézete">
    <Button aria-pressed={mode === 'Overview'} onClick={() => setOverride('Overview')}><LayoutDashboard size={16} aria-hidden="true" />Áttekintő</Button>
    <Button aria-pressed={mode === 'Vehicle'} onClick={() => setOverride('Vehicle')}><CarFront size={17} aria-hidden="true" />Autós</Button>
  </div>
  const fullStudio = mode === 'Vehicle' && data?.canReadVehicles && cars.some(car => car.vehicle.status !== 'Archived')
  return <section className={fullStudio ? 'dashboard-page dashboard-studio' : 'dashboard-page'} aria-label="Kezdőlap">
    <QueryMessage pending={dashboard.isPending} error={dashboard.error} retry={() => void dashboard.refetch()} />
    {data && <>
      <h2 className="sr-only">{mode === 'Vehicle' ? 'Járműközpont' : 'Flotta áttekintés'}</h2>
      {!fullStudio && viewSwitch && <div className="dashboard-heading">{viewSwitch}
        {mode === 'Overview' && <Button className="secondary-button" aria-label="Járműlista megnyitása" onClick={() => onFleet()}>
          Járműlista<ArrowRight size={16} aria-hidden="true" />
        </Button>}
      </div>}
      {!data.canReadVehicles ? <p className="notice">Nincs jogosultságod járműadatok megtekintéséhez.</p>
        : mode === 'Overview' ? <FleetDashboardOverview userId={user.id} tenantId={tenant.id} siteId={siteId} onFleet={onFleet} onVehicle={onVehicle} />
        : <CarDashboard key={siteId} cars={cars} user={user} tenant={tenant} today={data.today} onFleet={onFleet} viewSwitch={viewSwitch} />}
    </>}
  </section>
}

const icons = { data: CarFront, history: Gauge, services: Wrench, documents: FileText, leases: FileText,
  site: MapPin, photos: Camera, bookings: CalendarDays, fuel: Fuel, handovers: Handshake }
type VehicleTab = keyof typeof icons

function CarDashboard({ cars, user, tenant, today, onFleet, viewSwitch }: {
  cars: DashboardCar[]; user: Session; tenant: Tenant; today: string; onFleet: () => void; viewSwitch: ReactNode
}) {
  const eligible = cars.filter(car => car.vehicle.status !== 'Archived')
  const [selected, setSelected] = useState<string | null>(null)
  const [action, setAction] = useState<StudioAction | null>(null)
  const [opened, setOpened] = useState<VehicleTab | null>(null)
  const [flight, setFlight] = useState(false)
  const car = eligible.find(car => car.vehicle.id === selected) ?? eligible.find(car => car.isAssignedToMe) ?? eligible[0]
  const can = (code: string) => !!car?.vehicle.permissions?.includes(code)
  const canService = can('vehicles.service.read') || can('vehicles.service.manage')
  const canDocuments = can('vehicles.documents.read') || can('vehicles.documents.manage')
  const points: StudioMenu[] = [
    { key: 'data', label: 'Járműadatok' }, { key: 'history', label: 'Kilométerállás' },
    ...(canService ? [{ key: 'services' as const, label: 'Szerviz' }] : []),
    ...(canDocuments ? [{ key: 'documents' as const, label: 'Dokumentumok' }] : []),
    ...(can('vehicles.leasing.read') || can('vehicles.leasing.manage') ? [{ key: 'leases' as const, label: 'Lízing' }] : []),
    { key: 'site', label: 'Telephely és használó' }, { key: 'photos', label: 'Képek' },
  ]
  const menus: { key: VehicleTab; label: string }[] = [
    ...points,
    ...(can('vehicles.bookings.read') || can('vehicles.bookings.manage') ? [{ key: 'bookings' as const, label: 'Foglalások' }] : []),
    ...(can('vehicles.fuel.read') || can('vehicles.fuel.manage') ? [{ key: 'fuel' as const, label: 'Tankolások' }] : []),
    { key: 'handovers', label: 'Átadás-átvétel' },
  ]
  const focus = (key: StudioSection) => {
    setOpened(null); setFlight(true)
    setAction(previous => ({ key, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const focused = useCallback((key: StudioSection) => { setFlight(false); setOpened(key) }, [setFlight, setOpened])
  const cancelled = useCallback(() => setFlight(false), [setFlight])
  if (!car) return <section className="access-panel dashboard-no-car">
    <CarFront size={28} aria-hidden="true" /><h3>Nincs megjeleníthető jármű</h3>
    <Button className="primary-button" onClick={onFleet}>Járműlista</Button>
  </section>

  const deadlines = dashboardDeadlines([car], today)
  const missingOdometer = car.vehicle.odometerKm == null && can('vehicles.odometer.create')
  const openDeadline = ({ kind }: DashboardDeadline) => {
    if (kind === 'inspection' || kind === 'insurance') setOpened(canDocuments ? 'documents' : 'data')
    else setOpened(canService ? 'services' : 'data')
  }
  return <>
    <section className="car-dashboard" aria-label="Autós dashboard">
      <div className="car-dashboard-toolbar">
        <div className="car-identity">
          <h3 className="car-registration">{car.vehicle.registration}</h3>
          <span className="car-dashboard-model">{car.vehicle.make} {car.vehicle.model}</span>
          {car.isAssignedToMe && <Badge tone="success" dot={false}>Hozzám rendelve</Badge>}
        </div>
        {(viewSwitch || eligible.length > 1) && <div className="car-dashboard-actions">
          {viewSwitch}
          {eligible.length > 1 && <label className="car-picker"><span className="sr-only">Jármű kiválasztása</span>
            <Select value={car.vehicle.id} onChange={event => { setSelected(event.target.value); setAction(null); setOpened(null); setFlight(false) }}>
              {eligible.map(item => <option key={item.vehicle.id} value={item.vehicle.id}>
                {item.vehicle.registration}{item.isAssignedToMe ? ' · Nálam lévő jármű' : ''}
              </option>)}
            </Select>
          </label>}
        </div>}
      </div>
      <section className="car-attention" aria-label="Jármű teendői">
        {car.vehicle.status === 'Maintenance' && <div className="car-attention-notice"><Wrench size={17} aria-hidden="true" />Szervizben</div>}
        {missingOdometer && <div className="car-attention-notice"><Gauge size={17} aria-hidden="true" />
          <span>Rögzítendő kilométerállás</span><VehicleActions key={car.vehicle.id} user={user} tenant={tenant} vehicle={car.vehicle} allowEditing={false} />
        </div>}
        {deadlines.map(item => {
          const state = deadlineState(item)
          return <Button key={item.kind} variant="ghost" className="car-attention-notice" onClick={() => openDeadline(item)}>
            <CalendarClock size={17} aria-hidden="true" /><span>{item.label}</span>
            {item.kind === 'appointment' && car.serviceAppointmentAt && <time dateTime={car.serviceAppointmentAt}>{car.serviceAppointmentAt.slice(11, 16)}</time>}
            <Badge tone={state.tone} dot={false}>{state.label}</Badge>
          </Button>
        })}
        {!missingOdometer && !deadlines.length && car.vehicle.status !== 'Maintenance' && <p>Nincs esedékes teendő.</p>}
      </section>
      <VehicleGarage car={car.vehicle} bodyType={car.bodyType} color={car.color} menus={points} action={action}
        onSelect={focus} onFocused={focused} onCancelled={cancelled} paused={opened !== null} flying={flight}
        onReset={() => {
          setFlight(false); setOpened(null)
          setAction(previous => ({ key: 'home', sequence: (previous?.sequence ?? 0) + 1 }))
        }}>
        <nav className="car-menu" aria-label="Jármű gyorsmenü">{menus.map(menu => {
          const Icon = icons[menu.key]
          return <Button key={menu.key} onClick={() => { setOpened(menu.key); setFlight(false) }}>
            <Icon size={18} aria-hidden="true" /><span>{menu.label}</span><ArrowRight size={14} aria-hidden="true" />
          </Button>
        })}</nav>
        <div className="car-dashboard-footer">
          <span><MapPin size={14} aria-hidden="true" />{car.vehicle.siteName ?? 'Telephely nélkül'}</span>
          <span>{car.vehicle.status === 'Maintenance' ? 'Szervizben' : car.vehicle.status === 'Active' ? 'Aktív' : 'Inaktív'}</span>
        </div>
      </VehicleGarage>
    </section>
    {opened && <AccessDialog title={`${car.vehicle.registration} · ${menus.find(menu => menu.key === opened)?.label ?? 'Jármű'}`}
      pending={false} onClose={() => setOpened(null)} className="studio-vehicle-dialog">
      <VehiclePage key={`${car.vehicle.id}:${opened}`} user={user} tenant={tenant} id={car.vehicle.id} initialTab={opened}
        onBack={() => setOpened(null)} showGarage={false} />
    </AccessDialog>}
  </>
}
