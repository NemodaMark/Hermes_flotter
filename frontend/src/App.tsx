import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { MainNavigation } from './MainNavigation'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Building2,
  CarFront,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  LoaderCircle,
  LogOut,
  Plus,
  MailPlus,
  Menu,
  ShieldCheck,
  Settings,
  Search,
  Users,
  LayoutDashboard,
} from 'lucide-react'
import { api, ApiError, resetCsrfToken, vehicleKey } from './api'
import type { Session, Tenant, Vehicle } from './api'
import { AuthScreen, CompanyDialog, CompanyForm } from './AccountForms'
import { AccountRecoveryScreen } from './AccountRecoveryScreen'
import { clearAccountToken, readAccountLink } from './accountLink'
import { CompaniesPage } from './CompaniesPage'
import { PartnersPage } from './PartnersPage'
import { VehiclePage } from './VehiclePage'
import { ViewModeSwitch } from './ViewModeSwitch'
const FleetParking = lazy(() => import('./FleetParking'))
import { MembersPage } from './MembersPage'
import { PermissionGroups } from './PermissionGroups'
import { ListToolbar } from './ListToolbar'
import { SystemPage } from './SystemPage'
import { UserProfilePage } from './UserProfilePage'
import { PeopleList } from './PeopleList'
import { VehicleCreatePage } from './VehicleCreatePage'
import { PasswordChangeScreen } from './PasswordChangeScreen'
import { InvitationScreen } from './InvitationScreen'
import { clearInvitation, readInvitation } from './invitationLink'
import './App.css'
import './accounts.css'
import { Badge } from './ui/Badge'
import { ClickableRow, TableFrame } from './ui/Table'
import { Disclosure } from './ui/Disclosure'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { peopleApi } from './peopleApi'
import { ProtectedImage } from './ProtectedImage'
import { initials } from './peopleDisplay'
import { DashboardPage } from './DashboardPage'
import { isText, personalKey, readPersonal, writePersonal } from './personalStorage'
import { dateText } from './fleetApi'
import { consumeEntraResult } from './entra'

const entraResult = consumeEntraResult()

const statuses: Record<string, string> = {
  Active: 'Aktív',
  Maintenance: 'Szervizben',
  Inactive: 'Inaktív',
  Archived: 'Archivált',
}

function parkingCapacity() {
  return window.innerWidth <= 600 ? 1 : window.innerWidth <= 1000 || navigator.hardwareConcurrency <= 4 ? 2 : 4
}

type WorkspaceView = 'dashboard' | 'fleet' | 'organization' | 'members' | 'system' | 'partners' | 'profile' | 'invitations' | 'groups'
function profileFromHash() {
  const match = /^#\/profile\/([^/?#]+)$/.exec(window.location.hash)
  try { return match ? decodeURIComponent(match[1]) : null } catch { return null }
}

const workspacePaths: Record<Exclude<WorkspaceView, 'profile'>, string> = { dashboard: '/dashboard', fleet: '/vehicles', members: '/users', invitations: '/invitations', groups: '/permission-groups', organization: '/companies', partners: '/partners', system: '/system' }
function viewFromHash(): WorkspaceView {
  if (profileFromHash()) return 'profile'
  if (vehicleLinkFromHash()) return 'fleet'
  return (Object.entries(workspacePaths).find(([, path]) => window.location.hash === `#${path}`)?.[0] as WorkspaceView | undefined) ?? 'dashboard'
}
function vehicleLinkFromHash() {
  const match = /^#\/vehicles\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i.exec(window.location.hash)
  return match ? { tenantId: match[1], id: match[2] } : null
}

function FleetTable({
  vehicles,
  tenant,
  onOpen,
  message,
}: {
  vehicles: Vehicle[]
  tenant: Tenant
  onOpen: (id: string) => void
  message?: string
}) {
  return (
    <TableFrame hasRows={vehicles.length > 0}>
      <table className="responsive-list">
        <thead>
          <tr>
            <th>Jármű</th>
            <th>Gyártó / modell</th>
            <th>Km-állás</th>
            <th>Állapot</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => (
            <ClickableRow key={`${tenant.id}:${vehicle.id}`} onOpen={() => onOpen(vehicle.id)} aria-label={`Jármű: ${vehicle.registration}`}>
              <td data-label="Jármű">
                <span className="registration">
                  <CarFront size={19} aria-hidden="true" />
                  <Button type="button" className="row-title" tabIndex={-1} aria-label={`Jármű adatlapja: ${vehicle.registration}`} onClick={() => onOpen(vehicle.id)}>{vehicle.registration}</Button>
                </span>
                {vehicle.siteName && <span className="member-email">{vehicle.siteName}</span>}
                {vehicle.bookingAvailability && <span className="member-email">
                  {vehicle.bookingAvailability.currentUser && `Használó: ${vehicle.bookingAvailability.currentUser} · `}
                  Foglalható: {dateText(vehicle.bookingAvailability.availableFrom)}
                </span>}
              </td>
              <td data-label="Gyártó / modell">
                <span className="vehicle-make">{vehicle.make}</span>
                <span className="vehicle-model">{vehicle.model}</span>
              </td>
              <td data-label="Km-állás">{vehicle.odometerKm?.toLocaleString('hu-HU') ?? '—'}</td>
              <td data-label="Állapot">
                <Badge tone={vehicle.status === 'Active' ? 'success' : vehicle.status === 'Maintenance' ? 'warning' : 'neutral'}>
                  {statuses[vehicle.status] ?? vehicle.status}
                </Badge>
              </td>
            </ClickableRow>
          ))}
          {!vehicles.length && <tr><td colSpan={4} className="table-empty">{message ?? 'Nincs találat. Próbálj másik keresést vagy szűrőt.'}</td></tr>}
        </tbody>
      </table>
    </TableFrame>
  )
}

function FleetWorkspace({
  user,
  onLogout,
  loggingOut,
  logoutError,
  initialTenantId,
  accountNotice,
}: {
  user: Session
  onLogout: () => void
  loggingOut: boolean
  logoutError: string | null
  initialTenantId: string | null
  accountNotice?: { message: string; error: boolean } | null
}) {
  const queryClient = useQueryClient()
  const companyKey = personalKey(user.id, 'last-company')
  const [tenantId, setTenantId] = useState<string | null>(() => vehicleLinkFromHash()?.tenantId ?? initialTenantId ?? readPersonal(companyKey, isText) ?? null)
  const [view, setView] = useState<WorkspaceView>(viewFromHash)
  const [settingsOpen, setSettingsOpen] = useState(() => ['invitations', 'groups', 'system'].includes(view))
  const [profileId, setProfileId] = useState<string | null>(profileFromHash)
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(() => vehicleLinkFromHash()?.id ?? null)
  const profileReturn = useRef<WorkspaceView>('members')
  const [busy, setBusy] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const read = () => {
      setMobileNavOpen(false)
      const id = profileFromHash(); setProfileId(id)
      const link = vehicleLinkFromHash()
      if (link) { setTenantId(link.tenantId); setSelectedVehicleId(link.id) }
      if (id) setView(current => { if (current !== 'profile') profileReturn.current = current; return 'profile' })
      else setView(viewFromHash())
      if (['invitations', 'groups', 'system'].includes(viewFromHash())) setSettingsOpen(true)
    }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  function changeView(next: WorkspaceView) {
    if (busy) return
    setMobileNavOpen(false)
    if (next === 'profile') return
    if (['invitations', 'groups', 'system'].includes(next)) setSettingsOpen(true)
    window.location.hash = workspacePaths[next]
    setView(next)
  }
  function openProfile(id: string) {
    if (busy) return
    setMobileNavOpen(false)
    window.location.assign(`#/profile/${encodeURIComponent(id)}`)
  }
  const canManageSystem = user.systemPermissions?.includes('system.manage') ?? false
  const [search, setSearch] = useState('')
  const [vehicleQuery, setVehicleQuery] = useState({ search: '', page: 1 })
  const [pageSize, setPageSize] = useState(25)
  const [parking, setParking] = useState(false)
  const [parkingPageSize, setParkingPageSize] = useState(parkingCapacity)
  useEffect(() => {
    const update = () => setParkingPageSize(parkingCapacity())
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const effectivePageSize = parking ? parkingPageSize : pageSize
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const committed = search.trim()
      setVehicleQuery(current => current.search === committed ? current : { search: committed, page: 1 })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search])
  const [status, setStatus] = useState('all')
  const [siteSelection, setSiteSelection] = useState<{ company: string; site: string }>()
  const [formOpen, setFormOpen] = useState(false)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const tenants = useQuery({
    queryKey: ['tenants', user.id],
    queryFn: ({ signal }) => api.tenants(signal),
    refetchInterval: 30_000,
    retry: false,
  })
  const tenant: Tenant | undefined =
    tenants.data?.find((item) => item.id === tenantId) ?? tenants.data?.[0]
  const canReadVehicles = !!tenant?.permissions.includes('vehicles.read')
  const canReadUnassigned = tenant?.permissionScopes?.find(scope => scope.code === 'vehicles.read')?.allSites ?? true
  const workspaceSites = useQuery({
    queryKey: ['workspace-sites', user.id, tenant?.id],
    queryFn: ({ signal }) => api.vehicleSites(tenant!.id, signal),
    enabled: canReadVehicles, retry: false, refetchInterval: 30_000,
  })
  const siteKey = personalKey(user.id, 'last-site', tenant?.id)
  const savedSite = siteSelection && siteSelection.company === tenant?.id ? siteSelection.site : readPersonal(siteKey, isText)
  const currentSiteId = canReadVehicles && savedSite === 'none' && canReadUnassigned ? 'none'
    : canReadVehicles && workspaceSites.isSuccess && workspaceSites.data.some(site => site.id === savedSite) ? savedSite! : 'all'
  const restoringSite = canReadVehicles && !!savedSite && savedSite !== 'all' && savedSite !== 'none' && workspaceSites.isPending
  const currentSiteName = currentSiteId === 'none' ? 'Telephely nélkül' : workspaceSites.data?.find(site => site.id === currentSiteId)?.name ?? 'Összes telephely'
  const listQuery = { ...vehicleQuery, pageSize: effectivePageSize, status, siteId: currentSiteId }
  const vehicles = useQuery({
    queryKey: [...vehicleKey(user.id, tenant?.id), listQuery, tenant?.permissions, tenant?.permissionScopes],
    queryFn: ({ signal }) => api.searchVehicles(tenant!.id, listQuery, signal),
    enabled: view === 'fleet' && canReadVehicles && !restoringSite,
    retry: false,
  })
  const ownProfile = useQuery({
    queryKey: ['person-profile', user.id, 'sidebar'],
    queryFn: ({ signal }) => peopleApi.profile(user.id, undefined, signal), retry: false,
  })
  const createCompany = useMutation({
    mutationFn: (name: string) => api.createTenant(name),
    onSuccess: async (company) => {
      queryClient.setQueryData<Tenant[]>(['tenants', user.id], (previous) =>
        [...(previous ?? []), company].sort((a, b) => a.name.localeCompare(b.name, 'hu')),
      )
      changeTenant(company.id)
      setCompanyOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['tenants', user.id] })
      await queryClient.invalidateQueries({ queryKey: ['companies', user.id] })
    },
  })
  const visibleVehicles = vehicles.data?.items ?? []
  const vehicleTotal = vehicles.data?.total ?? 0
  const availableTotal = vehicles.data?.availableTotal ?? 0
  const vehiclePage = vehicles.data?.page ?? vehicleQuery.page
  const vehiclePages = Math.max(1, Math.ceil(vehicleTotal / effectivePageSize))
  const canCreate = tenant?.permissions.includes('vehicles.create') ?? false
  const canManageMembers = canManageSystem || !!tenant
  const canInvite = tenant?.permissions.includes('members.invite') ?? false
  const canReadGroups = canManageSystem || (tenants.data?.some(company => company.permissions.some(code => ['members.read', 'permissions.manage', 'permission-groups.manage'].includes(code))) ?? false)
  const viewTitle =
    view === 'dashboard' ? 'Kezdőlap' : view === 'invitations' ? 'Meghívások' : view === 'groups' ? 'Jogosultságcsoportok' : view === 'profile' ? 'Felhasználói adatlap' : view === 'fleet'
      ? 'Járművek'
      : view === 'partners'
        ? 'Partnerek'
      : view === 'members'
        ? 'Felhasználók'
        : view === 'system'
          ? 'Rendszerkezelés'
          : 'Cégek és telephelyek'
  const pageKey = view === 'fleet' ? `fleet:${formOpen ? 'create' : selectedVehicleId ?? 'list'}`
    : view === 'profile' ? `profile:${profileId}` : view

  function changeTenant(value: string) {
    setTenantId(value)
    writePersonal(companyKey, value)
    if (view === 'profile') changeView('members')
    setSelectedVehicleId(null)
    setSearch('')
    setVehicleQuery({ search: '', page: 1 })
    setStatus('all')
    setFormOpen(false)
  }
  async function saveCompany(name: string) {
    setCompanyError(null)
    try {
      await createCompany.mutateAsync(name)
    } catch (error) {
      setCompanyError(error instanceof Error ? error.message : 'A cég nem hozható létre.')
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); document.getElementById('main-content')?.focus() }}>Ugrás a tartalomra</a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="HERMES kezdőlap">
          <span className="brand-mark">H</span>
          <span>
            HERMES<span className="brand-caption">Flottakezelés</span>
          </span>
        </a>
        <div className="workspace-selector">
          <WorkspaceSwitcher company={tenant?.name ?? 'Cég kiválasztása'} site={canReadVehicles ? currentSiteName : undefined}
            disabled={!tenants.data?.length || busy || createCompany.isPending || loggingOut}>
            <label><span>Cég</span>
              <Select id="company" aria-label="Munkaterület" value={tenant?.id ?? ''}
                onChange={event => changeTenant(event.target.value)}>
                {!tenant && <option value="">Cég kiválasztása</option>}
                {tenants.data?.map(company => <option value={company.id} key={company.id}>{company.name}</option>)}
              </Select>
            </label>
            {canReadVehicles && <label><span>Telephely</span>
              <Select aria-label="Munkaterület telephelye" value={currentSiteId} disabled={workspaceSites.isPending}
                onChange={event => {
                  if (!tenant) return
                  const site = event.target.value
                  setSiteSelection({ company: tenant.id, site })
                  writePersonal(companyKey, tenant.id)
                  writePersonal(siteKey, site)
                  setVehicleQuery(current => ({ ...current, page: 1 }))
                  setSelectedVehicleId(null)
                  setFormOpen(false)
                }}>
                <option value="all">Összes telephely</option>
                {canReadUnassigned && <option value="none">Telephely nélkül</option>}
                {workspaceSites.data?.map(site => <option key={site.id} value={site.id}>{site.name} ({site.code})</option>)}
              </Select>
              {workspaceSites.isError && <Button type="button" variant="outline" size="sm" className="workspace-retry" onClick={() => void workspaceSites.refetch()}>Telephelyek újratöltése</Button>}
            </label>}
          </WorkspaceSwitcher>
        </div>
        <Button ref={mobileNavButton} className="mobile-nav-toggle" aria-label={mobileNavOpen ? 'Menü bezárása' : 'Menü megnyitása'} aria-expanded={mobileNavOpen} aria-controls="main-navigation" disabled={busy} onClick={() => setMobileNavOpen(open => !open)}><Menu size={21} aria-hidden="true" /></Button>
        <MainNavigation open={mobileNavOpen} busy={busy} onClose={() => setMobileNavOpen(false)}>
          <Button className={view === 'dashboard' ? 'nav-item active' : 'nav-item'} aria-current={view === 'dashboard' ? 'page' : undefined} onClick={() => changeView('dashboard')}><LayoutDashboard size={19}/>Kezdőlap<ArrowRight size={16}/></Button>
          <Button
            className={view === 'fleet' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'fleet' ? 'page' : undefined}
            onClick={() => changeView('fleet')}
          >
            <CarFront size={19} />
            Járművek
            <ArrowRight size={16} />
          </Button>
          {tenant?.permissions.some(code => code.startsWith('partners.')) && <Button
            className={view === 'partners' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'partners' ? 'page' : undefined}
            onClick={() => changeView('partners')}
          ><Building2 size={19} />Partnerek<ArrowRight size={16} /></Button>}
          {canManageMembers && (
            <Button
              className={view === 'members' ? 'nav-item active' : 'nav-item'}
              aria-current={view === 'members' ? 'page' : undefined}
              onClick={() => changeView('members')}
            >
              <Users size={19} />
              Felhasználók
              <ArrowRight size={16} />
            </Button>
          )}
          <Button
            className={view === 'organization' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'organization' ? 'page' : undefined}
            onClick={() => changeView('organization')}
          >
            <Building2 size={19} />
            Cégek és telephelyek
            <ArrowRight size={16} />
          </Button>
          {(canManageSystem || canInvite || canReadGroups) && <details className="admin-navigation" open={settingsOpen} onToggle={event => setSettingsOpen(event.currentTarget.open)}>
            <summary><Settings size={16} aria-hidden="true" />Beállítások<ChevronDown size={14} aria-hidden="true" /></summary>
            <div className="settings-links">
            {canInvite && <Button className={view === 'invitations' ? 'nav-item active' : 'nav-item'} aria-current={view === 'invitations' ? 'page' : undefined} onClick={() => changeView('invitations')}><MailPlus size={17} /><span>Meghívások</span></Button>}
            {canReadGroups && <Button className={view === 'groups' ? 'nav-item active' : 'nav-item'} aria-label="Jogosultságcsoportok" aria-current={view === 'groups' ? 'page' : undefined} onClick={() => changeView('groups')}><ShieldCheck size={17} /><span>Jogosultság<wbr />csoportok</span></Button>}
            {canManageSystem && <Button className={view === 'system' ? 'nav-item active' : 'nav-item'} aria-current={view === 'system' ? 'page' : undefined} onClick={() => changeView('system')}><Users size={17} /><span>Rendszerkezelés</span></Button>}
            </div>
          </details>}
        </MainNavigation>
        <Disclosure className="sidebar-bottom profile-navigation" summaryClassName="profile profile-button" label="Fiókmenü" trigger={<>
            <ProtectedImage path={peopleApi.avatarPath(user.id)} revision={ownProfile.data?.person?.avatarRevision}
              alt="Saját profilkép" className="avatar profile-avatar" fallback={initials(user.displayName)} />
            <span>{user.displayName}</span>
          </>}>
          <div className="profile-navigation-links">
            <Button onClick={() => openProfile(user.id)} disabled={busy}>Saját profil megnyitása</Button>
            <Button className="logout-button" onClick={onLogout} disabled={loggingOut || busy || createCompany.isPending}>
              <LogOut size={16} aria-hidden="true" />{loggingOut ? 'Kilépés…' : 'Kijelentkezés'}
            </Button>
          </div>
        </Disclosure>
      </aside>
      <main id="main-content" tabIndex={-1}>
        <header className="topbar">
          <span className="breadcrumb">
            <strong>{viewTitle}</strong>
          </span>
        </header>
        <div className="page-content page-content-compact" key={pageKey} data-view={view}>
          {accountNotice && <p className={accountNotice.error ? 'notice error' : 'notice'} role={accountNotice.error ? 'alert' : 'status'}>{accountNotice.message}</p>}
          {logoutError && (
            <p className="notice error" role="alert">
              {logoutError}
            </p>
          )}
          <h1 className="sr-only">{view === 'fleet' ? 'Járműállomány' : viewTitle}</h1>
          {view === 'profile' && profileId ? (
            tenants.isPending ? <p className="notice">Profil betöltése…</p> : <UserProfilePage key={`${tenant?.id}:${profileId}`} id={profileId} actor={user} tenant={tenant} onBack={() => changeView(profileReturn.current)} onVehicle={id => { changeView('fleet'); setFormOpen(false); setSelectedVehicleId(id) }} />
          ) : view === 'groups' ? (
            canReadGroups ? <section className="access-panel" aria-label="Jogosultságcsoportok kezelése"><PermissionGroups user={user} /></section> : tenants.isPending ? <p className="notice">Betöltés…</p> : <p className="notice">Nincs jogosultságod a jogosultságcsoportok megtekintéséhez.</p>
          ) : view === 'organization' ? (
            <CompaniesPage
              user={user}
              initialCompanyId={tenant?.id}
              onNewCompany={() => {
                setCompanyError(null)
                setCompanyOpen(true)
              }}
            />
          ) : view === 'system' ? (
            canManageSystem ? (
              <SystemPage user={user} />
            ) : (
              <p className="notice">Nincs rendszerszintű kezelési jogod.</p>
            )
          ) : view === 'members' && canManageSystem && !tenant ? (
            <section className="access-panel"><PeopleList user={user} onProfile={openProfile} /></section>
          ) : tenants.isError ? (
            <div className="notice error" role="alert">
              <CircleHelp size={22} />
              <div>
                <h2>A munkaterület nem tölthető be</h2>
                <p>{tenants.error.message}</p>
                <Button className="text-button" onClick={() => void tenants.refetch()}>
                  Újrapróbálom
                </Button>
              </div>
            </div>
          ) : tenants.isPending ? (
            <div className="empty-state">
              <LoaderCircle size={25} className="spinning" />
              <p>Munkaterületek betöltése…</p>
            </div>
          ) : !tenant ? (
            <section className="onboarding-panel" aria-labelledby="onboarding-title">
              <Building2 size={30} />
              <h2 id="onboarding-title">Hozd létre az első cégedet</h2>
              <p>Adj nevet a céges munkaterületnek, és elkezdheted felvenni a járműveket.</p>
              <CompanyForm
                onSave={(name) => void saveCompany(name)}
                pending={createCompany.isPending}
                error={companyError}
              />
            </section>
          ) : view === 'members' || view === 'invitations' ? (
            <MembersPage key={`${tenant.id}:${view}`} user={user} tenant={tenant} onProfile={openProfile} mode={view} />
          ) : view === 'dashboard' ? (
            restoringSite ? <p className="notice" role="status">Munkaterület betöltése…</p>
              : <DashboardPage key={tenant.id} user={user} tenant={tenant} siteId={currentSiteId} sites={workspaceSites.data ?? []} canUnassigned={canReadUnassigned}
                onFleet={nextStatus => { changeView('fleet'); setSelectedVehicleId(null); setStatus(nextStatus ?? 'all'); setVehicleQuery(current => ({ ...current, page: 1 })) }}
                onVehicle={id => { changeView('fleet'); setSelectedVehicleId(id) }} />
          ) : view === 'partners' ? (
            <PartnersPage key={tenant.id} tenant={tenant} />
          ) : formOpen ? (
            <VehicleCreatePage key={tenant.id} user={user} tenant={tenant} initialSiteId={currentSiteId} onBusyChange={setBusy} onBack={() => setFormOpen(false)} onCreated={car => { setFormOpen(false); setSelectedVehicleId(tenant.permissions.includes('vehicles.read') ? car.id : null) }} />
          ) : !tenant.permissions.includes('vehicles.read') ? (
            <section className="access-panel" aria-label="Járművek"><ListToolbar label="Járművek műveletei" actions={canCreate && <Button className="primary-button" onClick={() => setFormOpen(true)}><Plus size={18} />Új jármű</Button>} /><p className="notice">Nincs jogosultságod a járműlista megtekintéséhez.</p></section>
          ) : selectedVehicleId ? (
            <VehiclePage key={`${tenant.id}:${selectedVehicleId}`} user={user} tenant={tenant} id={selectedVehicleId} onBack={() => { setSelectedVehicleId(null); if (vehicleLinkFromHash()) changeView('fleet') }} />
          ) : (
            <section className={`fleet-panel${parking ? ' parking-panel' : ''}`} aria-label="Járműlista" aria-busy={vehicles.isFetching}>
              <ListToolbar label="Járművek keresése és műveletei" actions={<><ViewModeSwitch visual={parking} label="Parkoló" onChange={value => { setParking(value); setVehicleQuery(current => ({ ...current, page: 1 })) }} />{canCreate && <Button className="primary-button" onClick={() => setFormOpen(true)}><Plus size={18} />Új jármű</Button>}</>}>
                <div className="list-toolbar-form">
                  <div className="search-field"><Search size={18} /><input aria-label="Jármű keresése" placeholder="Rendszám, gyártó vagy modell" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} /></div>
                  <Select aria-label="Szűrés állapot szerint" className="status-filter" value={status} onChange={event => { setStatus(event.target.value); setVehicleQuery(current => ({ ...current, page: 1 })) }}><option value="all">Minden állapot</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
                </div>
              </ListToolbar>
              {vehicles.isError ? (
                <div className="notice error" role="alert">
                  <p>
                    {vehicles.error instanceof ApiError
                      ? vehicles.error.message
                      : 'A járműlista nem tölthető be.'}
                  </p>
                  <Button className="text-button" onClick={() => void vehicles.refetch()}>
                    Újrapróbálom
                  </Button>
                </div>
              ) : (
                parking ? visibleVehicles.length ? <Suspense fallback={<p className="notice" role="status">Parkoló betöltése…</p>}><FleetParking vehicles={visibleVehicles} onOpen={setSelectedVehicleId} /></Suspense> :
                  <div className="empty-state parking-empty" role="status"><CarFront size={28} /><h2>{vehicles.isPending ? 'Járművek betöltése…' : availableTotal ? 'Nincs találat' : 'Még nincs jármű'}</h2>
                    {!vehicles.isPending && (search || status !== 'all') && <Button variant="outline" onClick={() => { setSearch(''); setStatus('all'); setVehicleQuery({ search: '', page: 1 }) }}>Szűrők törlése</Button>}
                  </div> : <FleetTable vehicles={visibleVehicles} tenant={tenant!} onOpen={setSelectedVehicleId}
                  message={vehicles.isPending ? 'Járművek betöltése…' : availableTotal ? undefined : 'Még nincs jármű. Az Új jármű gombbal veheted fel az elsőt.'} />
              )}
              <div className="table-footer fleet-pagination">
                <span aria-live="polite">{vehicles.isPending ? 'Betöltés…' : vehicles.isError ? 'A találatszám nem elérhető' : `${vehicleTotal}${vehicleTotal !== availableTotal ? ` / ${availableTotal}` : ''} jármű`}</span>
                <div className="fleet-page-controls" role="group" aria-label="Járműlista lapozása">
                  {!parking && <Select aria-label="Járművek száma oldalanként" value={String(pageSize)} onChange={event => { setPageSize(Number(event.target.value)); setVehicleQuery(current => ({ ...current, page: 1 })) }}>
                    {[25, 50, 100].map(size => <option key={size} value={size}>{size} / oldal</option>)}
                  </Select>}
                  <span aria-live="polite">{vehicles.data ? `${vehiclePage} / ${vehiclePages}. oldal` : '—'}</span>
                  <Button className="secondary-button" aria-label="Előző oldal" disabled={vehicles.isFetching || vehicles.isError || vehiclePage <= 1} onClick={() => setVehicleQuery(current => ({ ...current, page: vehiclePage - 1 }))}>{parking && <ChevronLeft className="parking-page-icon" size={18} aria-hidden="true" />}<span className={parking ? 'parking-page-label' : undefined}>Előző oldal</span></Button>
                  <Button className="secondary-button" aria-label="Következő oldal" disabled={vehicles.isFetching || vehicles.isError || vehiclePage >= vehiclePages} onClick={() => setVehicleQuery(current => ({ ...current, page: vehiclePage + 1 }))}><span className={parking ? 'parking-page-label' : undefined}>Következő oldal</span>{parking && <ChevronRight className="parking-page-icon" size={18} aria-hidden="true" />}</Button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
      {companyOpen && (
        <CompanyDialog
          onClose={() => setCompanyOpen(false)}
          onSave={(name) => void saveCompany(name)}
          pending={createCompany.isPending}
          error={companyError}
        />
      )}

    </div>
  )
}

export default function App() {
  const queryClient = useQueryClient()
  const [loggingOut, setLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [invitation, setInvitation] = useState(readInvitation)
  const [accountLink, setAccountLink] = useState(readAccountLink)
  useEffect(() => {
    if (accountLink) clearAccountToken()
    const read = () => {
      const link = readAccountLink()
      if (link) { setAccountLink(link); clearAccountToken() }
    }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [accountLink])
  const [acceptedTenantId, setAcceptedTenantId] = useState<string | null>(null)
  useEffect(() => {
    const read = () => setInvitation(readInvitation())
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) => api.session(signal),
    retry: false,
    staleTime: 0,
    refetchInterval: 60_000,
  })

  useEffect(() => {
    if (session.data === null) {
      resetCsrfToken()
      void queryClient.cancelQueries({
        predicate: (query) => query.queryKey[0] !== 'session',
      })
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== 'session',
      })
      queryClient.getMutationCache().clear()
    }
  }, [queryClient, session.data])

  useEffect(() => {
    const handleError = (error: unknown) => {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        queryClient.getQueryData(['session']) !== null
      ) {
        resetCsrfToken()
        queryClient.setQueryData(['session'], null)
        void queryClient.cancelQueries({
          predicate: (query) => query.queryKey[0] !== 'session',
        })
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] !== 'session',
        })
        queryClient.getMutationCache().clear()
      } else if (error instanceof ApiError && error.code === 'password_change_required') {
        queryClient.setQueryData<Session | null>(['session'], (previous) =>
          previous ? { ...previous, passwordChangeRequired: true } : previous,
        )
        void queryClient.cancelQueries({
          predicate: (query) => query.queryKey[0] !== 'session',
        })
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] !== 'session',
        })
        queryClient.getMutationCache().clear()
      } else if (error instanceof ApiError && error.status === 403) {
        void queryClient.invalidateQueries({ queryKey: ['tenants'] })
        void queryClient.invalidateQueries({ queryKey: ['session'] })
      }
    }
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (
        event.type === 'updated' &&
        event.action.type === 'error' &&
        event.query.queryKey[0] !== 'session' &&
        event.query.state.status === 'error'
      ) {
        if (
          event.query.queryKey[0] === 'tenants' &&
          event.query.state.error instanceof ApiError &&
          event.query.state.error.status === 403 &&
          event.query.state.error.code !== 'password_change_required'
        )
          return
        handleError(event.query.state.error)
      }
    })
    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type === 'updated' && event.action.type === 'error')
        handleError(event.mutation.state.error)
    })
    return () => {
      unsubscribeQueries()
      unsubscribeMutations()
    }
  }, [queryClient])

  async function changeSession(user: Session | null) {
    resetCsrfToken()
    await queryClient.cancelQueries()
    queryClient.setQueryData(['session'], user)
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'session',
    })
    queryClient.getMutationCache().clear()
    setLogoutError(null)
  }
  async function logout() {
    setLoggingOut(true)
    setLogoutError(null)
    try {
      await api.logout()
      await changeSession(null)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) await changeSession(null)
      else setLogoutError(error instanceof Error ? error.message : 'A kijelentkezés nem sikerült.')
    } finally {
      setLoggingOut(false)
    }
  }
  if (accountLink) return <AccountRecoveryScreen link={accountLink} onClose={() => {
    setAccountLink(null)
    window.location.hash = '/dashboard'
    void queryClient.invalidateQueries({ queryKey: ['session'] })
  }} />
  if (session.isPending)
    return (
      <main className="account-page">
        <div className="empty-state">
          <LoaderCircle className="spinning" size={28} />
          <p>Munkamenet ellenőrzése…</p>
        </div>
      </main>
    )
  if (session.isError)
    return (
      <main className="account-page">
        <section className="account-panel">
          <h1>A szerver nem érhető el</h1>
          <p className="account-description">{session.error.message}</p>
          <Button className="primary-button" onClick={() => void session.refetch()}>
            Újrapróbálom
          </Button>
        </section>
      </main>
    )
  return session.data ? (
    session.data.passwordChangeRequired ? (
      <PasswordChangeScreen
        user={session.data}
        onChanged={changeSession}
        onLogout={() => void logout()}
        loggingOut={loggingOut}
        logoutError={logoutError}
      />
    ) : invitation ? (
      <InvitationScreen
        request={invitation.request}
        user={session.data}
        onAccepted={(tenantId) => {
          clearInvitation()
          setInvitation(null)
          setAcceptedTenantId(tenantId)
          void queryClient.invalidateQueries({
            queryKey: ['tenants', session.data!.id],
          })
        }}
        onDismiss={() => {
          clearInvitation()
          setInvitation(null)
        }}
        onLogout={() => void logout()}
        loggingOut={loggingOut}
        logoutError={logoutError}
      />
    ) : (
      <FleetWorkspace
        key={`${session.data.id}:${acceptedTenantId ?? ''}`}
        user={session.data}
        onLogout={() => void logout()}
        loggingOut={loggingOut}
        logoutError={logoutError}
        initialTenantId={acceptedTenantId}
        accountNotice={entraResult}
      />
    )
  ) : (
    <AuthScreen onAuthenticated={async user => { if (!invitation) window.location.hash = '/dashboard'; await changeSession(user) }} invitationPending={!!invitation} entraError={entraResult?.error ? entraResult.message : null} />
  )
}
