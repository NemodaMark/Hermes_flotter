import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Building2,
  CarFront,
  ChevronDown,
  CircleHelp,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Users,
} from 'lucide-react'
import { api, ApiError, resetCsrfToken, vehicleKey } from './api'
import type { Session, Tenant, Vehicle } from './api'
import { VehicleActions } from './VehicleActions'
import { AuthScreen, CompanyDialog, CompanyForm } from './AccountForms'
import { CompaniesPage } from './CompaniesPage'
import { PartnersPage } from './PartnersPage'
import { VehiclePage } from './VehiclePage'
import { MembersPage } from './MembersPage'
import { SystemPage } from './SystemPage'
import { UserProfilePage } from './UserProfilePage'
import { PeopleList } from './PeopleList'
import { VehicleCreatePage } from './VehicleCreatePage'
import { PasswordChangeScreen } from './PasswordChangeScreen'
import { InvitationScreen } from './InvitationScreen'
import { clearInvitation, readInvitation } from './invitationLink'
import './App.css'
import './accounts.css'

const statuses: Record<string, string> = {
  Active: 'Aktív',
  Maintenance: 'Szervizben',
  Inactive: 'Inaktív',
  Archived: 'Archivált',
}

type WorkspaceView = 'fleet' | 'organization' | 'members' | 'system' | 'partners' | 'profile'
function profileFromHash() {
  const match = /^#\/profile\/([^/?#]+)$/.exec(window.location.hash)
  try { return match ? decodeURIComponent(match[1]) : null } catch { return null }
}

function FleetTable({
  vehicles,
  user,
  tenant,
  onOpen,
}: {
  vehicles: Vehicle[]
  user: Session
  tenant: Tenant
  onOpen: (id: string) => void
}) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Jármű</th>
            <th>Gyártó / modell</th>
            <th>Állapot</th>
            <th>Km-állás</th>
            <th>Művelet</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => (
            <tr key={`${tenant.id}:${vehicle.id}`}>
              <td>
                <span className="registration">
                  <CarFront size={19} aria-hidden="true" />
                  {vehicle.registration}
                </span>
                {vehicle.siteName && <span className="member-email">{vehicle.siteName}</span>}
              </td>
              <td>
                <span className="vehicle-make">{vehicle.make}</span>
                <span className="vehicle-model">{vehicle.model}</span>
              </td>
              <td>
                <span className={`status status-${vehicle.status.toLowerCase()}`}>
                  <span />
                  {statuses[vehicle.status] ?? vehicle.status}
                </span>
              </td>
              <td>{vehicle.odometerKm?.toLocaleString('hu-HU') ?? '—'}</td>
              <td>
                <div className="member-actions"><button className="secondary-button" aria-label={`Jármű adatlapja: ${vehicle.registration}`} onClick={() => onOpen(vehicle.id)}>Adatlap</button>
                  <VehicleActions user={user} tenant={tenant} vehicle={vehicle} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FleetWorkspace({
  user,
  onLogout,
  loggingOut,
  logoutError,
  initialTenantId,
}: {
  user: Session
  onLogout: () => void
  loggingOut: boolean
  logoutError: string | null
  initialTenantId: string | null
}) {
  const queryClient = useQueryClient()
  const [tenantId, setTenantId] = useState<string | null>(initialTenantId)
  const [view, setView] = useState<WorkspaceView>(() => profileFromHash() ? 'profile' : 'fleet')
  const [profileId, setProfileId] = useState<string | null>(profileFromHash)
  const profileReturn = useRef<WorkspaceView>('members')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const read = () => {
      const id = profileFromHash(); setProfileId(id)
      if (id) setView(current => { if (current !== 'profile') profileReturn.current = current; return 'profile' })
      else setView(current => current === 'profile' ? 'members' : current)
    }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  function changeView(next: WorkspaceView) {
    if (busy) return
    if (profileFromHash()) window.history.replaceState(null, '', window.location.pathname + window.location.search)
    setView(next)
  }
  function openProfile(id: string) { if (!busy) window.location.hash = `/profile/${encodeURIComponent(id)}` }
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const canManageSystem = user.systemPermissions?.includes('system.manage') ?? false
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
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
  const vehicles = useQuery({
    queryKey: vehicleKey(user.id, tenant?.id),
    queryFn: ({ signal }) => api.vehicles(tenant!.id, signal),
    enabled: !!tenant?.permissions.includes('vehicles.read'),
    retry: false,
  })
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => api.health(signal),
    refetchInterval: 30_000,
    retry: false,
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
  const allVehicles = vehicles.data ?? []
  const visibleVehicles = allVehicles.filter(
    (vehicle) =>
      `${vehicle.registration} ${vehicle.make} ${vehicle.model} ${(vehicle.previousRegistrations ?? []).join(' ')}`
        .toLocaleLowerCase('hu')
        .includes(search.toLocaleLowerCase('hu')) &&
      (status === 'all' || vehicle.status === status),
  )
  const canCreate = tenant?.permissions.includes('vehicles.create') ?? false
  const canManageMembers = canManageSystem || !!tenant
  const viewTitle =
    view === 'profile' ? 'Felhasználói adatlap' : view === 'fleet'
      ? 'Járművek'
      : view === 'partners'
        ? 'Partnerek'
      : view === 'members'
        ? 'Felhasználók'
        : view === 'system'
          ? 'Rendszerkezelés'
          : 'Cégek és telephelyek'

  function changeTenant(value: string) {
    setTenantId(value)
    changeView('fleet')
    setSelectedVehicleId(null)
    setSearch('')
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
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="HERMES kezdőlap">
          <span className="brand-mark">H</span>
          <span>
            HERMES<span className="brand-caption">Flottakezelés</span>
          </span>
        </a>
        <div className="workspace-selector">
          <label htmlFor="company">Munkaterület</label>
          <div className="select-wrap">
            <Building2 size={17} />
            <select
              id="company"
              aria-label="Munkaterület"
              value={tenant?.id ?? ''}
              disabled={
                !tenants.data?.length || busy || createCompany.isPending || loggingOut
              }
              onChange={(event) => changeTenant(event.target.value)}
            >
              {!tenant && <option value="">Cég kiválasztása</option>}
              {tenants.data?.map((company) => (
                <option value={company.id} key={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} />
          </div>
          {tenant && (
            <button
              className="new-company-button"
              onClick={() => {
                setCompanyError(null)
                setCompanyOpen(true)
              }}
              disabled={busy || loggingOut}
            >
              <Plus size={14} />
              Új cég
            </button>
          )}
        </div>
        <nav aria-label="Fő navigáció">
          <button
            className={view === 'fleet' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'fleet' ? 'page' : undefined}
            onClick={() => changeView('fleet')}
          >
            <CarFront size={19} />
            Járművek
            <ArrowRight size={16} />
          </button>
          {tenant?.permissions.some(code => code.startsWith('partners.')) && <button
            className={view === 'partners' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'partners' ? 'page' : undefined}
            onClick={() => changeView('partners')}
          ><Building2 size={19} />Partnerek<ArrowRight size={16} /></button>}
          {canManageMembers && (
            <button
              className={view === 'members' ? 'nav-item active' : 'nav-item'}
              aria-current={view === 'members' ? 'page' : undefined}
              onClick={() => changeView('members')}
            >
              <Users size={19} />
              Felhasználók
              <ArrowRight size={16} />
            </button>
          )}
          <button
            className={view === 'organization' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'organization' ? 'page' : undefined}
            onClick={() => changeView('organization')}
          >
            <Building2 size={19} />
            Cégek és telephelyek
            <ArrowRight size={16} />
          </button>
          {canManageSystem && <details className="admin-navigation"><summary>Beállítások</summary><button className={view === 'system' ? 'nav-item active' : 'nav-item'} aria-current={view === 'system' ? 'page' : undefined} onClick={() => changeView('system')}><Users size={18} />Rendszerkezelés</button></details>}
        </nav>
        <div className="sidebar-bottom">
          <span className={`connection ${health.isSuccess ? 'online' : ''}`}>
            <span />
            {health.isSuccess
              ? 'Rendszer elérhető'
              : health.isPending
                ? 'Kapcsolódás…'
                : 'Nincs kapcsolat'}
          </span>
          <button className="profile profile-button" aria-label="Saját profil megnyitása" onClick={() => openProfile(user.id)} disabled={busy}>
            <span className="avatar">
              {user.displayName
                .split(/\s+/)
                .map((part) => part[0])
                .slice(0, 2)
                .join('')
                .toUpperCase()}
            </span>
            <span>
              {user.displayName}
              <small>
                {tenant ? `${tenant.permissions.length} jogosultság` : 'Nincs kiválasztott cég'}
              </small>
            </span>
          </button>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Munkaterület <span className="breadcrumb-separator">/</span> {viewTitle}
          </span>
          <button
            className="logout-button"
            onClick={onLogout}
            disabled={loggingOut || busy || createCompany.isPending}
          >
            <LogOut size={16} />
            {loggingOut ? 'Kilépés…' : 'Kijelentkezés'}
          </button>
        </header>
        <div className="page-content">
          {logoutError && (
            <p className="notice error" role="alert">
              {logoutError}
            </p>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {view === 'organization' ? 'HERMES' : (tenant?.name ?? 'HERMES')}
              </p>
              <h1>
                {view === 'system' || view === 'organization' || view === 'profile'
                  ? viewTitle
                  : !tenant
                    ? 'Saját munkaterület'
                    : view === 'fleet'
                      ? 'Járműállomány'
                      : viewTitle}
              </h1>
              <p className="page-description">
                {view === 'profile' ? 'Profil és kapcsolattartási adatok.' : view === 'organization'
                  ? 'Cégtörzs, kapcsolattartók, telephelyek és változásnapló.'
                  : view === 'system'
                    ? 'Rendszerszintű módosítási napló és beállítások.'
                    : !tenant
                      ? 'Hozd létre a cégedet a flottakezelés megkezdéséhez.'
                      : view === 'fleet'
                        ? 'A kiválasztott cég járművei, egy helyen.'
                        : view === 'members'
                          ? canManageSystem
                            ? 'Összes felhasználó, céges hozzáférések és meghívások.'
                            : 'Céges tagok, meghívások és hozzáférések.'
                          : view === 'partners' ? 'Lízingbeadók, szervizek és kapcsolattartók.' : 'Cégtörzs, kapcsolattartók, telephelyek és változásnapló.'}
              </p>
            </div>
            {view === 'fleet' && !formOpen && !selectedVehicleId && canCreate && (
              <button
                className="primary-button"
                onClick={() => setFormOpen(true)}
              >
                <Plus size={18} />
                Új jármű
              </button>
            )}
          </div>
          {view === 'profile' && profileId ? (
            tenants.isPending ? <p className="notice">Profil betöltése…</p> : <UserProfilePage key={`${tenant?.id}:${profileId}`} id={profileId} actor={user} tenant={tenant} onBack={() => changeView(profileReturn.current)} onVehicle={id => { changeView('fleet'); setFormOpen(false); setSelectedVehicleId(id) }} />
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
              <SystemPage user={user} onUsers={() => changeView('members')} />
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
                <button className="text-button" onClick={() => void tenants.refetch()}>
                  Újrapróbálom
                </button>
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
          ) : view === 'members' ? (
            <MembersPage key={tenant.id} user={user} tenant={tenant} onProfile={openProfile} />
          ) : view === 'partners' ? (
            <PartnersPage key={tenant.id} tenant={tenant} />
          ) : formOpen ? (
            <VehicleCreatePage key={tenant.id} user={user} tenant={tenant} onBusyChange={setBusy} onBack={() => setFormOpen(false)} onCreated={car => { setFormOpen(false); setSelectedVehicleId(tenant.permissions.includes('vehicles.read') ? car.id : null) }} />
          ) : !tenant.permissions.includes('vehicles.read') ? (
            <p className="notice">Nincs jogosultságod a járműlista megtekintéséhez.</p>
          ) : selectedVehicleId ? (
            <VehiclePage key={`${tenant.id}:${selectedVehicleId}`} user={user} tenant={tenant} id={selectedVehicleId} onBack={() => setSelectedVehicleId(null)} />
          ) : (
            <section className="fleet-panel" aria-label="Járműlista">
              <div className="fleet-summary">
                <span>
                  <strong>{allVehicles.length}</strong> jármű a flottában
                </span>
                <span className="summary-detail">
                  {allVehicles.filter((vehicle) => vehicle.status === 'Active').length} aktív ·{' '}
                  {allVehicles.filter((vehicle) => vehicle.status === 'Maintenance').length}{' '}
                  szervizben
                </span>
                <button
                  className="icon-button refresh"
                  aria-label="Járműlista frissítése"
                  onClick={() => void vehicles.refetch()}
                  disabled={vehicles.isFetching}
                >
                  <RefreshCw size={17} className={vehicles.isFetching ? 'spinning' : ''} />
                </button>
              </div>
              <div className="table-toolbar">
                <div className="search-field">
                  <Search size={18} />
                  <input
                    aria-label="Jármű keresése"
                    placeholder="Rendszám, gyártó vagy modell"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <select
                  aria-label="Szűrés állapot szerint"
                  className="status-filter"
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="all">Minden állapot</option>
                  {Object.entries(statuses).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              {vehicles.isError ? (
                <div className="notice error" role="alert">
                  <p>
                    {vehicles.error instanceof ApiError
                      ? vehicles.error.message
                      : 'A járműlista nem tölthető be.'}
                  </p>
                  <button className="text-button" onClick={() => void vehicles.refetch()}>
                    Újrapróbálom
                  </button>
                </div>
              ) : vehicles.isPending ? (
                <div className="empty-state">
                  <LoaderCircle size={25} className="spinning" />
                  <p>Járművek betöltése…</p>
                </div>
              ) : visibleVehicles.length ? (
                <FleetTable vehicles={visibleVehicles} user={user} tenant={tenant!} onOpen={setSelectedVehicleId} />
              ) : (
                <div className="empty-state">
                  <CarFront size={34} />
                  <h2>{allVehicles.length ? 'Nincs találat' : 'Itt kezdődik a flotta'}</h2>
                  <p>
                    {allVehicles.length
                      ? 'Próbálj másik keresést vagy állapotot.'
                      : 'Az első jármű hozzáadása után itt jelennek meg az adatok.'}
                  </p>
                </div>
              )}
              <div className="table-footer">
                {visibleVehicles.length} megjelenített jármű
                <span>Céges hozzáférés</span>
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
          <button className="primary-button" onClick={() => void session.refetch()}>
            Újrapróbálom
          </button>
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
      />
    )
  ) : (
    <AuthScreen onAuthenticated={changeSession} invitationPending={!!invitation} />
  )
}
