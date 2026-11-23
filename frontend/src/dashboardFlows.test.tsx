import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { DashboardPage } from './DashboardPage'
import { dashboardApi } from './dashboardApi'
import type { Dashboard, DashboardCar } from './dashboardApi'
import { api } from './api'
import { PermissionGroups } from './PermissionGroups'
import { chooseOption } from './selectTestUtils'
import { vehiclePaint } from './vehicleAppearance'
vi.mock('./VehicleTaskPanel',()=>({VehicleTaskPanel:({section}:{section:string})=><div aria-label="Járműfeladat">Megnyitott rész: {section}</div>}))
afterEach(()=>vi.restoreAllMocks())
beforeEach(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
})
const user={id:'anna',displayName:'Anna',email:'anna@example.test'}
const tenant={id:'company',name:'Duna',permissions:['vehicles.read','vehicles.leasing.read']}
const car:DashboardCar={vehicle:{id:'first',registration:'AAA-001',make:'Ford',model:'Focus',status:'Active',siteId:'bp',siteName:'Budapest',odometerKm:14000,permissions:['vehicles.read','vehicles.odometer.create']},bodyType:'Estate',color:'Kék',inspectionDueDate:'2026-10-15',insuranceDueDate:null,nextServiceDate:null,nextServiceKm:20000,isAssignedToMe:true}
function mount(data:Partial<Dashboard>={},siteId='all') {
  const today = '2026-10-24'
  const vehicles = data.vehicles ?? [car]
  vi.spyOn(dashboardApi,'read').mockResolvedValue({ mode:'Overview', priority:10, sourceGroup:'Sofőrök',
    canReadVehicles:true, canReadOverview:true, today, vehicles, ...data })
  const loadOverview = vi.spyOn(dashboardApi, 'overview').mockResolvedValue({
    today, vehicles: vehicles.filter(({ vehicle }) => siteId === 'all' || vehicle.siteId === siteId),
    monthlyMileage: [{ month: '2026-09-01', kilometers: 214 }, { month: '2026-10-01', kilometers: null }],
    topVehicles: [{ vehicleId: car.vehicle.id, registration: car.vehicle.registration, make: car.vehicle.make, model: car.vehicle.model, kilometers: 214 }],
  })
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  const onFleet=vi.fn(),onVehicle=vi.fn()
  render(<QueryClientProvider client={client}><DashboardPage user={user} tenant={tenant} siteId={siteId} onFleet={onFleet} onVehicle={onVehicle}/></QueryClientProvider>)
  return {onFleet,onVehicle,loadOverview}
}
it('summarizes only the selected site and opens a due vehicle through its authorized ID',async()=>{
  vi.setSystemTime(new Date('2026-10-24T09:00:00Z'))
  try {
    const {onVehicle,loadOverview}=mount({vehicles:[car,{...car,vehicle:{...car.vehicle,id:'other',siteId:'other',registration:'BBB-002'}}]},'bp')
    await screen.findByRole('heading',{name:'Havi futásteljesítmény'})
    expect(loadOverview).toHaveBeenCalledWith('company', 'bp', expect.any(AbortSignal))
    expect(screen.queryByText('BBB-002')).not.toBeInTheDocument()
    expect(screen.getByText('9 napja lejárt')).toBeInTheDocument()
    expect(screen.getByRole('listitem', { name: /október · nincs mérhető adat/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'AAA-001 · 214 km' }))
    expect(onVehicle).toHaveBeenLastCalledWith('first')
    await userEvent.click(screen.getByRole('button',{name:'AAA-001 · Műszaki vizsga'}))
    expect(onVehicle).toHaveBeenCalledWith('first')
  } finally { vi.useRealTimers() }
})
it('grants a personal garage without ever requesting fleet statistics for an ordinary driver', async () => {
  const { loadOverview } = mount({ mode: 'Overview', canReadOverview: false })
  expect(await screen.findByRole('region', { name: 'Autós dashboard' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Áttekintő' })).not.toBeInTheDocument()
  expect(loadOverview).not.toHaveBeenCalled()
})
it('surfaces service deadlines and lets an authorized driver record a missing odometer reading', async () => {
  mount({ canReadOverview: false, vehicles: [{ ...car, nextServiceDate: '2026-10-27', vehicle: {
    ...car.vehicle, odometerKm: undefined, version: 4, permissions: ['vehicles.read', 'vehicles.service.read', 'vehicles.odometer.create'],
  } }] })
  const tasks = await screen.findByRole('region', { name: 'Jármű teendői' })
  await userEvent.click(within(tasks).getByRole('button', { name: /Következő szerviz.*3 nap múlva/ }))
  expect(await screen.findByText('Megnyitott rész: services')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Bezárás' }))
  await userEvent.click(within(tasks).getByRole('button', { name: 'Rögzítendő kilométerállás' }))
  expect(await screen.findByRole('dialog', { name: 'Kilométerállás rögzítése' })).toBeInTheDocument()
})
it('makes every deadline reachable beyond the compact initial list', async () => {
  vi.setSystemTime(new Date('2026-10-24T09:00:00Z'))
  try {
    const vehicles = Array.from({ length: 13 }, (_, index) => ({ ...car,
      vehicle: { ...car.vehicle, id: `car-${index + 1}`, registration: `CAR-${String(index + 1).padStart(3, '0')}` },
    }))
    const { onVehicle } = mount({ vehicles })
    await screen.findByRole('heading', { name: 'Határidők (13)' })
    expect(screen.getAllByRole('button', { name: /CAR-\d+ · Műszaki vizsga/ })).toHaveLength(6)
    await userEvent.click(screen.getByRole('button', { name: 'További határidők (7)' }))
    expect(screen.getAllByRole('button', { name: /CAR-\d+ · Műszaki vizsga/ })).toHaveLength(12)
    await userEvent.click(screen.getByRole('button', { name: 'További határidők (1)' }))
    await userEvent.click(screen.getByRole('button', { name: 'CAR-013 · Műszaki vizsga' }))
    expect(onVehicle).toHaveBeenCalledWith('car-13')
    expect(screen.queryByRole('button', { name: /További határidők/ })).not.toBeInTheDocument()
  } finally { vi.useRealTimers() }
})
it('keeps status shortcuts connected to the corresponding fleet filter', async () => {
  const { onFleet } = mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Aktív jármű megnyitása' }))
  expect(onFleet).toHaveBeenLastCalledWith('Active')
  await userEvent.click(screen.getByRole('button', { name: 'Szervizben megnyitása' }))
  expect(onFleet).toHaveBeenLastCalledWith('Maintenance')
  await userEvent.click(screen.getByRole('button', { name: 'Járműlista megnyitása' }))
  expect(onFleet).toHaveBeenLastCalledWith()
})
it('offers one empty state and fleet navigation when the selected site has no vehicles', async () => {
  const { onFleet } = mount({}, 'empty-site')
  expect(await screen.findByText('Ezen a munkaterületen még nincs jármű.')).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Határidők/ })).not.toBeInTheDocument()
  expect(screen.queryByText(/Járművek telephelyenként/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Járműlista megnyitása' }))
  expect(onFleet).toHaveBeenCalledOnce()
})
it('chooses an assigned active vehicle and keeps unauthorized menus hidden even with company-wide aggregate rights',async()=>{
  mount({mode:'Vehicle',vehicles:[{...car,isAssignedToMe:false},{...car,vehicle:{...car.vehicle,id:'mine',registration:'MINE-002'},isAssignedToMe:true}]})
  const region=await screen.findByRole('region',{name:'Autós dashboard'})
  expect(within(region).getByRole('heading', { name: 'MINE-002' })).toBeInTheDocument()
  const menu=within(region).getByRole('navigation',{name:'Jármű gyorsmenü'})
  expect(within(menu).queryByRole('button',{name:'Lízing'})).not.toBeInTheDocument()
  expect(within(menu).queryByRole('button',{name:'Szerviz'})).not.toBeInTheDocument()
  await screen.findByText('A 3D nézet ezen az eszközön nem érhető el.')
  await userEvent.click(within(menu).getByRole('button',{name:'Kilométerállás: MINE-002'}))
  expect(await screen.findByRole('dialog',{name:'Kilométerállás rögzítése'})).toBeInTheDocument()
  expect(screen.queryByLabelText('Járműadatlap')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button',{name:'Bezárás'}))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('changes the selected car, body and operation menus without reusing the previous car permissions',async()=>{
  mount({mode:'Vehicle',vehicles:[car,{...car,vehicle:{...car.vehicle,id:'second',registration:'SECOND-002',permissions:['vehicles.read','vehicles.service.read']},bodyType:'Van',color:'#cc1122'}]})
  const picker=await screen.findByRole('combobox',{name:'Jármű kiválasztása'})
  const styles = document.documentElement.style
  expect(styles.getPropertyValue('--vehicle-paint')).toBe('#214d81')
  await chooseOption(picker,'second')
  expect(styles.getPropertyValue('--vehicle-paint')).toBe('#cc1122')
  expect(styles.getPropertyValue('--vehicle-accent-light')).not.toBe(styles.getPropertyValue('--vehicle-accent-dark'))
  expect(await screen.findByText(/Furgon/)).toBeInTheDocument()
  const menu=screen.getByRole('navigation',{name:'Jármű gyorsmenü'})
  await userEvent.click(within(menu).getByText('Továbbiak'))
  expect(within(menu).getByRole('button',{name:'Szerviz'})).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button',{name:'Áttekintő'}))
  expect(await screen.findByRole('heading',{name:'Flotta áttekintés'})).toBeInTheDocument()
  expect(styles.getPropertyValue('--vehicle-paint')).toBe('')
})
it('keeps a single recording group through repeated car switches, dialogs and permission changes', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  const permissions = ['vehicles.read', 'vehicles.odometer.create', 'vehicles.fuel.manage']
  const first = { ...car, vehicle: { ...car.vehicle, permissions } }
  const second = { ...first, vehicle: { ...first.vehicle, id: 'second', registration: 'BBB-002' } }
  const reader = { ...car, vehicle: { ...car.vehicle, id: 'reader', registration: 'READ-003', permissions: ['vehicles.read'] } }
  mount({ mode: 'Vehicle', vehicles: [first, second, reader] })
  const picker = await screen.findByRole('combobox', { name: 'Jármű kiválasztása' })
  const menu = within(screen.getByRole('navigation', { name: 'Jármű gyorsmenü' }))
  for (const current of [second, first, reader, second, reader, first]) {
    await chooseOption(picker, current.vehicle.id)
    const writable = current.vehicle.id !== 'reader'
    expect(menu.queryAllByRole('group', { name: 'Gyors rögzítés' })).toHaveLength(writable ? 1 : 0)
    expect(menu.queryAllByRole('button', { name: /^Tankolás rögzítése:/ })).toHaveLength(writable ? 1 : 0)
    expect(menu.queryAllByRole('button', { name: /^Kilométerállás:/ })).toHaveLength(writable ? 1 : 0)
    if (writable) {
      await userEvent.click(menu.getByRole('button', { name: `Kilométerállás: ${current.vehicle.registration}` }))
      expect(await screen.findByRole('dialog', { name: 'Kilométerállás rögzítése' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Bezárás' }))
      await userEvent.click(menu.getByRole('button', { name: `Tankolás rögzítése: ${current.vehicle.registration}` }))
      expect(await screen.findByRole('dialog', { name: 'Tankolás rögzítése' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Bezárás' }))
    }
  }
  expect(errors.mock.calls.filter(args => args.some(arg => String(arg).includes('same key')))).toHaveLength(0)
})
it('shows no vehicle summary or studio when vehicle reading is forbidden',async()=>{
  mount({mode:'Vehicle',canReadVehicles:false,vehicles:[]})
  await screen.findByText(/Nincs jogosultságod járműadatok/)
  expect(screen.queryByRole('region',{name:'Autós dashboard'})).not.toBeInTheDocument()
  expect(screen.queryByText('AAA-001')).not.toBeInTheDocument()
})
it('edits the protected admin dashboard without exposing protected name or permission editing',async()=>{
  vi.spyOn(api,'groups').mockResolvedValue([{id:'admin-group',name:'admin',createdBy:'system',version:7,isAdmin:true,allPermissions:true,permissions:['vehicles.read'],companies:[],memberCount:1,canAssign:true,canEdit:false,canConfigureDashboard:true,dashboardMode:'Overview',dashboardPriority:0}])
  vi.spyOn(api,'groupCompanies').mockResolvedValue([])
  vi.spyOn(api,'permissions').mockResolvedValue([])
  const configure=vi.spyOn(dashboardApi,'configure').mockResolvedValue({})
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}})
  render(<QueryClientProvider client={client}><PermissionGroups user={user}/></QueryClientProvider>)
  await userEvent.click(await screen.findByRole('button',{name:'Kezdőnézet beállítása: admin'}))
  const dialog=within(screen.getByRole('dialog'))
  expect(dialog.queryByLabelText('Csoport neve')).not.toBeInTheDocument()
  await chooseOption(dialog.getByRole('combobox',{name:'Dashboard típusa'}),'Vehicle')
  await userEvent.clear(dialog.getByLabelText('Dashboard prioritása'))
  await userEvent.type(dialog.getByLabelText('Dashboard prioritása'),'50')
  await userEvent.click(dialog.getByRole('button',{name:'Kezdőnézet mentése'}))
  await waitFor(()=>expect(configure).toHaveBeenCalledWith('admin-group','Vehicle',50,7))
})
it('resolves Hungarian color names and hex values and identifies unknown colors honestly',()=>{
  expect(vehiclePaint('  Kék ').hex).toBe('#214d81')
  expect(vehiclePaint('#c01234')).toEqual({hex:'#c01234',matched:true})
  expect(vehiclePaint('Ismeretlen árnyalat').matched).toBe(false)
})

it('never offers an ordinary driver a car switcher or substitutes someone else’s vehicle', async () => {
  mount({ canReadOverview: false, vehicles: [{ ...car, isAssignedToMe: false }] })
  expect(await screen.findByRole('heading', { name: 'Nincs hozzád rendelt, megtekinthető jármű' })).toBeInTheDocument()
  expect(screen.queryByRole('combobox', { name: 'Jármű kiválasztása' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'AAA-001' })).not.toBeInTheDocument()
})
