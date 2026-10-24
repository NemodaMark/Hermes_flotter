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
vi.mock('./VehiclePage',()=>({VehiclePage:({initialTab}:{initialTab:string})=><div aria-label="Járműadatlap">Megnyitott rész: {initialTab}</div>}))
afterEach(()=>vi.restoreAllMocks())
beforeEach(()=>{
  HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','')}
  HTMLDialogElement.prototype.close=function(){this.removeAttribute('open')}
})
const user={id:'anna',displayName:'Anna',email:'anna@example.test'}
const tenant={id:'company',name:'Duna',permissions:['vehicles.read','vehicles.leasing.read']}
const car:DashboardCar={vehicle:{id:'first',registration:'AAA-001',make:'Ford',model:'Focus',status:'Active',siteId:'bp',siteName:'Budapest',odometerKm:14000,permissions:['vehicles.read','vehicles.odometer.create']},bodyType:'Estate',color:'Kék',inspectionDueDate:'2026-10-15',insuranceDueDate:null,nextServiceDate:null,nextServiceKm:20000,isAssignedToMe:false}
function mount(data:Partial<Dashboard>={},siteId='all') {
  vi.spyOn(dashboardApi,'read').mockResolvedValue({mode:'Overview',priority:10,sourceGroup:'Sofőrök',canReadVehicles:true,vehicles:[car],...data})
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})
  const onFleet=vi.fn(),onVehicle=vi.fn()
  render(<QueryClientProvider client={client}><DashboardPage user={user} tenant={tenant} siteId={siteId} onFleet={onFleet} onVehicle={onVehicle}/></QueryClientProvider>)
  return {onFleet,onVehicle}
}
it('summarizes only the selected site and opens a due vehicle through its authorized ID',async()=>{
  vi.setSystemTime(new Date('2026-10-24T09:00:00Z'))
  try {
    const {onVehicle}=mount({vehicles:[car,{...car,vehicle:{...car.vehicle,id:'other',siteId:'other',registration:'BBB-002'}}]},'bp')
    await screen.findByRole('heading',{name:'Flotta áttekintés'})
    expect(screen.queryByText('BBB-002')).not.toBeInTheDocument()
    expect(screen.getByText('9 napja lejárt')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button',{name:'AAA-001'}))
    expect(onVehicle).toHaveBeenCalledWith('first')
  } finally { vi.useRealTimers() }
})
it('chooses an assigned active vehicle and keeps unauthorized menus hidden even with company-wide aggregate rights',async()=>{
  mount({mode:'Vehicle',vehicles:[car,{...car,vehicle:{...car.vehicle,id:'mine',registration:'MINE-002'},isAssignedToMe:true}]})
  const region=await screen.findByRole('region',{name:'Autós dashboard'})
  expect(within(region).getByText('MINE-002')).toBeInTheDocument()
  const menu=within(region).getByRole('navigation',{name:'Jármű gyorsmenü'})
  expect(within(menu).queryByRole('button',{name:'Lízing'})).not.toBeInTheDocument()
  expect(within(menu).queryByRole('button',{name:'Szerviz'})).not.toBeInTheDocument()
  await screen.findByText('A 3D nézet ezen az eszközön nem érhető el.')
  await userEvent.click(within(menu).getByRole('button',{name:'Kilométerállás'}))
  expect(await screen.findByRole('dialog',{name:'MINE-002 · Kilométerállás'})).toBeInTheDocument()
  expect(screen.getByText('Megnyitott rész: history')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button',{name:'Bezárás'}))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('changes the selected car, body and operation menus without reusing the previous car permissions',async()=>{
  mount({mode:'Vehicle',vehicles:[car,{...car,vehicle:{...car.vehicle,id:'second',registration:'SECOND-002',permissions:['vehicles.read','vehicles.service.read']},bodyType:'Van',color:'#cc1122'}]})
  const picker=await screen.findByRole('combobox',{name:'Jármű kiválasztása'})
  await chooseOption(picker,'second')
  expect(await screen.findByText(/Furgon/)).toBeInTheDocument()
  const menu=screen.getByRole('navigation',{name:'Jármű gyorsmenü'})
  expect(within(menu).getByRole('button',{name:'Szerviz'})).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button',{name:'Áttekintő'}))
  expect(await screen.findByRole('heading',{name:'Flotta áttekintés'})).toBeInTheDocument()
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
