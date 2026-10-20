import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Building2,
  CarFront,
  Check,
  ChevronDown,
  CircleHelp,
  LoaderCircle,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Users,
  X,
} from 'lucide-react'
import { api, ApiError, resetCsrfToken, vehicleKey } from './api'
import type { NewVehicle, Session, Tenant, Vehicle } from './api'
import { VehicleActions } from './VehicleActions'
import { AuthScreen, CompanyDialog, CompanyForm } from './AccountForms'
import { CompaniesPage } from './CompaniesPage'
import { MembersPage } from './MembersPage'
import { SystemPage } from './SystemPage'
import { PasswordChangeScreen } from './PasswordChangeScreen'
import { InvitationScreen } from './InvitationScreen'
import { clearInvitation, readInvitation } from './invitationLink'
import './App.css'
import './accounts.css'

const statuses: Record<string, string> = {
  Active: 'Aktív',
  Maintenance: 'Szervizben',
  Inactive: 'Inaktív',
}

function VehicleForm({
  tenantId,
  onClose,
  onSave,
  pending,
  error,
}: {
  tenantId: string
  onClose: () => void
  onSave: (vehicle: NewVehicle) => void
  pending: boolean
  error: string | null
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const registrationInput = useRef<HTMLInputElement>(null)
  const siteOptions = useQuery({
    queryKey: ['vehicle-create-options', tenantId],
    queryFn: ({ signal }) => api.vehicleCreationOptions(tenantId, signal), retry: false,
  })
  useEffect(() => {
    dialog.current?.showModal()
    registrationInput.current?.focus()
  }, [])
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    onSave({
      registration: String(values.get('registration')),
      make: String(values.get('make')),
      model: String(values.get('model')),
      ...(values.get('siteId') ? { siteId: String(values.get('siteId')) } : {}),
    })
  }
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        if (pending) event.preventDefault()
        else onClose()
      }}
      aria-labelledby="vehicle-form-title"
    >
      <div className="dialog-heading">
        <h2 id="vehicle-form-title">Új jármű</h2>
        <button className="icon-button" aria-label="Bezárás" onClick={onClose} disabled={pending}>
          <X size={20} />
        </button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="registration">Rendszám</label>
        <input
          ref={registrationInput}
          id="registration"
          name="registration"
          required
          maxLength={16}
          placeholder="AA-BB-123"
          disabled={pending}
        />
        <label htmlFor="make">Gyártó</label>
        <input
          id="make"
          name="make"
          required
          maxLength={64}
          placeholder="Például Škoda"
          disabled={pending}
        />
        <label htmlFor="model">Modell</label>
        <input
          id="model"
          name="model"
          required
          maxLength={64}
          placeholder="Például Octavia"
          disabled={pending}
        />
        <label htmlFor="vehicle-site">Telephely</label>
        <select id="vehicle-site" name="siteId" required={!siteOptions.data?.canCreateUnassigned}
          disabled={pending || !siteOptions.data} defaultValue="">
          <option value="">{siteOptions.data?.canCreateUnassigned ? 'Nincs telephelyhez rendelve' : 'Válassz telephelyet'}</option>
          {siteOptions.data?.sites.map((site) => <option key={site.id} value={site.id}>{site.name} ({site.code})</option>)}
        </select>
        {siteOptions.isError && <p className="form-error" role="alert">{siteOptions.error.message}</p>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>
            Mégse
          </button>
          <button className="primary-button" disabled={pending || !siteOptions.data}>
            {pending ? <LoaderCircle size={17} className="spinning" /> : <Check size={17} />}
            Mentés
          </button>
        </div>
      </form>
    </dialog>
  )
}

function FleetTable({
  vehicles,
  user,
  tenant,
}: {
  vehicles: Vehicle[]
  user: Session
  tenant: Tenant
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
                <VehicleActions user={user} tenant={tenant} vehicle={vehicle} />
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
  const [view, setView] = useState<'fleet' | 'organization' | 'members' | 'system'>('fleet')
  const canManageSystem = user.systemPermissions?.includes('system.manage') ?? false
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
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
  const create = useMutation({
    mutationFn: ({
      tenantId: company,
      input,
    }: {
      user: string
      tenantId: string
      input: NewVehicle
    }) => api.createVehicle(company, input),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({
        queryKey: vehicleKey(variables.user, variables.tenantId),
      })
    },
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
      `${vehicle.registration} ${vehicle.make} ${vehicle.model}`
        .toLocaleLowerCase('hu')
        .includes(search.toLocaleLowerCase('hu')) &&
      (status === 'all' || vehicle.status === status),
  )
  const canCreate = tenant?.permissions.includes('vehicles.create') ?? false
  const canManageMembers =
    (canManageSystem ||
      tenant?.permissions.some((code) =>
        [
          'members.read',
          'members.invite',
          'members.update',
          'permissions.manage',
          'permission-groups.manage',
        ].includes(code),
      )) ??
    false
  const viewTitle =
    view === 'fleet'
      ? 'Járművek'
      : view === 'members'
        ? 'Felhasználók'
        : view === 'system'
          ? 'Rendszerkezelés'
          : 'Cégek és telephelyek'

  function changeTenant(value: string) {
    setTenantId(value)
    setSearch('')
    setStatus('all')
    setFormOpen(false)
    setFormError(null)
  }
  async function saveCompany(name: string) {
    setCompanyError(null)
    try {
      await createCompany.mutateAsync(name)
    } catch (error) {
      setCompanyError(error instanceof Error ? error.message : 'A cég nem hozható létre.')
    }
  }
  async function saveVehicle(input: NewVehicle) {
    if (!tenant) return
    setFormError(null)
    try {
      await create.mutateAsync({ user: user.id, tenantId: tenant.id, input })
      setFormOpen(false)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'A mentés nem sikerült.')
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
                !tenants.data?.length || create.isPending || createCompany.isPending || loggingOut
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
              disabled={create.isPending || loggingOut}
            >
              <Plus size={14} />
              Új cég
            </button>
          )}
        </div>
        <nav aria-label="Fő navigáció">
          {canManageSystem && (
            <button
              className={view === 'system' ? 'nav-item active' : 'nav-item'}
              aria-current={view === 'system' ? 'page' : undefined}
              onClick={() => setView('system')}
            >
              <Users size={19} />
              Rendszerkezelés
              <ArrowRight size={16} />
            </button>
          )}
          <button
            className={view === 'fleet' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'fleet' ? 'page' : undefined}
            onClick={() => setView('fleet')}
          >
            <CarFront size={19} />
            Járművek
            <ArrowRight size={16} />
          </button>
          {canManageMembers && (
            <button
              className={view === 'members' ? 'nav-item active' : 'nav-item'}
              aria-current={view === 'members' ? 'page' : undefined}
              onClick={() => setView('members')}
            >
              <Users size={19} />
              Felhasználók
              <ArrowRight size={16} />
            </button>
          )}
          <button
            className={view === 'organization' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'organization' ? 'page' : undefined}
            onClick={() => setView('organization')}
          >
            <Building2 size={19} />
            Cégek és telephelyek
            <ArrowRight size={16} />
          </button>
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
          <div className="profile">
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
          </div>
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
            disabled={loggingOut || create.isPending || createCompany.isPending}
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
                {view === 'system' || view === 'organization'
                  ? viewTitle
                  : !tenant
                    ? 'Saját munkaterület'
                    : view === 'fleet'
                      ? 'Járműállomány'
                      : viewTitle}
              </h1>
              <p className="page-description">
                {view === 'organization'
                  ? 'Cégtörzs, kapcsolattartók, telephelyek és változásnapló.'
                  : view === 'system'
                    ? 'Összes felhasználó és rendszerszintű módosítási napló.'
                    : !tenant
                      ? 'Hozd létre a cégedet a flottakezelés megkezdéséhez.'
                      : view === 'fleet'
                        ? 'A kiválasztott cég járművei, egy helyen.'
                        : view === 'members'
                          ? canManageSystem
                            ? 'Összes felhasználó, céges hozzáférések és meghívások.'
                            : 'Céges tagok, meghívások és hozzáférések.'
                          : 'Cégtörzs, kapcsolattartók, telephelyek és változásnapló.'}
              </p>
            </div>
            {view === 'fleet' && canCreate && (
              <button
                className="primary-button"
                onClick={() => {
                  setFormError(null)
                  setFormOpen(true)
                }}
              >
                <Plus size={18} />
                Új jármű
              </button>
            )}
          </div>
          {view === 'organization' ? (
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
            <SystemPage user={user} usersOnly />
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
            <MembersPage key={tenant.id} user={user} tenant={tenant} />
          ) : !tenant.permissions.includes('vehicles.read') ? (
            <p className="notice">Nincs jogosultságod a járműlista megtekintéséhez.</p>
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
                <FleetTable vehicles={visibleVehicles} user={user} tenant={tenant!} />
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
      {formOpen && (
        <VehicleForm
          tenantId={tenant!.id}
          onClose={() => setFormOpen(false)}
          onSave={(input) => void saveVehicle(input)}
          pending={create.isPending}
          error={formError}
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
