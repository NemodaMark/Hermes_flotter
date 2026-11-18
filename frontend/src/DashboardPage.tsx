import { useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, CalendarDays, Camera, CarFront, Ellipsis, FileText, Fuel, Gauge, Handshake, LayoutDashboard, MapPin, Wrench } from 'lucide-react'
import { dashboardApi } from './dashboardApi'
import type { DashboardCar } from './dashboardApi'
import { dashboardDeadlines, deadlineState } from './dashboardDeadlines'
import type { DashboardDeadline } from './dashboardDeadlines'
import type { Session, Tenant } from './api'
import type { StudioAction, StudioSection } from './VehicleStudio'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { Badge } from './ui/Badge'
import { Disclosure } from './ui/Disclosure'
import { QueryMessage } from './FleetFields'
import { VehiclePage } from './VehiclePage'
import { VehicleActions } from './VehicleActions'
import { VehicleGarage } from './VehicleGarage'
import { FleetDashboardOverview } from './FleetDashboardOverview'
import { AccessDialog } from './AccessDialog'
import { useVehicleAccent } from './useVehicleAccent'
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
const extraTabNames = { assignees: 'Használati előzmények', audit: 'Módosítási napló' }
const quickLabels: Partial<Record<VehicleTab, string>> = { data: 'Adatlap', history: 'Km-állás', site: 'Telephely', photos: 'Képek' }

function CarDashboard({ cars, user, tenant, today, onFleet, viewSwitch }: {
  cars: DashboardCar[]; user: Session; tenant: Tenant; today: string; onFleet: () => void; viewSwitch: ReactNode
}) {
  const eligible = cars.filter(car => car.vehicle.status !== 'Archived')
  const [selected, setSelected] = useState<string | null>(null)
  const [action, setAction] = useState<StudioAction | null>(null)
  const [opened, setOpened] = useState<StudioSection | null>(null)
  const car = eligible.find(car => car.vehicle.id === selected) ?? eligible.find(car => car.isAssignedToMe) ?? eligible[0]
  useVehicleAccent(car?.color ?? null)
  const can = (code: string) => !!car?.vehicle.permissions?.includes(code)
  const canService = can('vehicles.service.read') || can('vehicles.service.manage')
  const canDocuments = can('vehicles.documents.read') || can('vehicles.documents.manage')
  const points: { key: VehicleTab; label: string }[] = [
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
    setOpened(key)
    setAction(previous => ({ key, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const moveCamera = (key: 'resume' | 'home') => {
    setOpened(null)
    setAction(previous => ({ key, sequence: (previous?.sequence ?? 0) + 1 }))
  }
  const closeDrawer = () => moveCamera('resume')
  if (!car) return <section className="access-panel dashboard-no-car">
    <CarFront size={28} aria-hidden="true" /><h3>Nincs megjeleníthető jármű</h3>
    <Button className="primary-button" onClick={onFleet}>Járműlista</Button>
  </section>

  const deadlines = dashboardDeadlines([car], today)
  const missingOdometer = car.vehicle.odometerKm == null && can('vehicles.odometer.create')
  const openDeadline = ({ kind }: DashboardDeadline) => {
    if (kind === 'inspection' || kind === 'insurance') focus(canDocuments ? 'documents' : 'data')
    else focus(canService ? 'services' : 'data')
  }
  return <>
    <section className="car-dashboard" aria-label="Autós dashboard">
      <VehicleGarage car={car.vehicle} bodyType={car.bodyType} color={car.color} menus={points} action={action} immersive
        onSelect={focus} paused={opened !== null} onReset={() => moveCamera('home')}
        overlay={<>
          <div className="car-dashboard-toolbar">
            <div className="car-identity">
              <h3 className="car-registration">{car.vehicle.registration}</h3>
              <span className="car-dashboard-model">{car.vehicle.make} {car.vehicle.model}</span>
              <span className="car-location"><MapPin size={13} aria-hidden="true" />{car.vehicle.siteName ?? 'Telephely nélkül'}
                {car.isAssignedToMe && <Badge tone="success" dot={false}>Hozzám rendelve</Badge>}
                {car.vehicle.status === 'Inactive' && <Badge tone="neutral" dot={false}>Inaktív</Badge>}
              </span>
            </div>
            {(viewSwitch || eligible.length > 1) && <div className="car-dashboard-actions">
              {viewSwitch}
              {eligible.length > 1 && <label className="car-picker"><span className="sr-only">Jármű kiválasztása</span>
                <Select value={car.vehicle.id} onChange={event => { setSelected(event.target.value); moveCamera('home') }}>
                  {eligible.map(item => <option key={item.vehicle.id} value={item.vehicle.id}>
                    {item.vehicle.registration}
                  </option>)}
                </Select>
              </label>}
            </div>}
          </div>
          {(missingOdometer || deadlines.length > 0 || car.vehicle.status === 'Maintenance') && <section className="car-attention" aria-label="Jármű teendői">
            {car.vehicle.status === 'Maintenance' && <div className="car-attention-notice"><Wrench size={17} aria-hidden="true" />Szervizben</div>}
            {missingOdometer && <div className="car-attention-notice"><Gauge size={17} aria-hidden="true" />
              <span>Rögzítendő kilométerállás</span><VehicleActions key={car.vehicle.id} user={user} tenant={tenant} vehicle={car.vehicle} allowEditing={false} />
            </div>}
            {deadlines.map(item => {
              const state = deadlineState(item)
              return <Button key={item.kind} className="car-attention-notice" onClick={() => openDeadline(item)}>
                <CalendarClock size={17} aria-hidden="true" /><span>{item.label}</span>
                {item.kind === 'appointment' && car.serviceAppointmentAt && <time dateTime={car.serviceAppointmentAt}>{car.serviceAppointmentAt.slice(11, 16)}</time>}
                <Badge tone={state.tone} dot={false}>{state.label}</Badge>
              </Button>
            })}
          </section>}
        </>}>
        <nav className="car-menu" aria-label="Jármű gyorsmenü">{menus.filter(menu => quickLabels[menu.key]).map(menu => {
          const Icon = icons[menu.key]
          return <Button key={menu.key} aria-label={menu.label} onClick={() => focus(menu.key)}>
            <Icon size={18} aria-hidden="true" /><span>{quickLabels[menu.key]}</span>
          </Button>
        })}
          <Disclosure className="car-menu-more" key={car.vehicle.id}
            trigger={<><Ellipsis size={18} aria-hidden="true" /><span>Továbbiak</span></>}>
            <div>{menus.filter(menu => !quickLabels[menu.key]).map(menu => {
              const Icon = icons[menu.key]
              return <Button key={menu.key} onClick={() => focus(menu.key)}><Icon size={17} aria-hidden="true" />{menu.label}</Button>
            })}</div>
          </Disclosure>
        </nav>
      </VehicleGarage>
    </section>
    {opened && <AccessDialog title={`${car.vehicle.registration} · ${opened === 'assignees' || opened === 'audit' ? extraTabNames[opened] : menus.find(menu => menu.key === opened)?.label ?? 'Jármű'}`}
      pending={false} onClose={closeDrawer} className="studio-vehicle-dialog">
      <VehiclePage key={car.vehicle.id} user={user} tenant={tenant} id={car.vehicle.id} initialTab={opened}
        onBack={closeDrawer} showGarage={false} embedded onSectionChange={focus} />
    </AccessDialog>}
  </>
}
