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
  X,
} from 'lucide-react'
import { api, ApiError, resetCsrfToken, vehicleKey } from './api'
import type { NewVehicle, Session, Tenant, Vehicle } from './api'
import { AuthScreen, CompanyDialog, CompanyForm } from './AccountForms'
import './App.css'
import './accounts.css'

const roles: Record<string, string> = {
  Owner: 'Cégtulajdonos',
  FleetManager: 'Flottakezelő',
  Viewer: 'Megtekintő',
}
const statuses: Record<string, string> = {
  Active: 'Aktív',
  Maintenance: 'Szervizben',
  Inactive: 'Inaktív',
}

function VehicleForm({
  onClose,
  onSave,
  pending,
  error,
}: {
  onClose: () => void
  onSave: (vehicle: NewVehicle) => void
  pending: boolean
  error: string | null
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const registrationInput = useRef<HTMLInputElement>(null)
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
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>
            Mégse
          </button>
          <button className="primary-button" disabled={pending}>
            {pending ? <LoaderCircle size={17} className="spinning" /> : <Check size={17} />}Mentés
          </button>
        </div>
      </form>
    </dialog>
  )
}

function FleetTable({ vehicles }: { vehicles: Vehicle[] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Jármű</th>
            <th>Gyártó / modell</th>
            <th>Állapot</th>
          </tr>
        </thead>
        <tbody>
          {vehicles.map((vehicle) => (
            <tr key={vehicle.id}>
              <td>
                <span className="registration">
                  <CarFront size={19} aria-hidden="true" />
                  {vehicle.registration}
                </span>
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
}: {
  user: Session
  onLogout: () => void
  loggingOut: boolean
  logoutError: string | null
}) {
  const queryClient = useQueryClient()
  const [tenantId, setTenantId] = useState<string | null>(null)
  const [view, setView] = useState<'fleet' | 'organization'>('fleet')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [formOpen, setFormOpen] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [companyOpen, setCompanyOpen] = useState(false)
  const [companyError, setCompanyError] = useState<string | null>(null)
  const tenants = useQuery({
    queryKey: ['tenants', user.id],
    queryFn: ({ signal }) => api.tenants(signal),
    retry: false,
  })
  const tenant: Tenant | undefined =
    tenants.data?.find((item) => item.id === tenantId) ?? tenants.data?.[0]
  const vehicles = useQuery({
    queryKey: vehicleKey(user.id, tenant?.id),
    queryFn: ({ signal }) => api.vehicles(tenant!.id, signal),
    enabled: !!tenant,
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
  const canCreate = tenant?.role === 'Owner' || tenant?.role === 'FleetManager'

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
          <button
            className={view === 'fleet' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'fleet' ? 'page' : undefined}
            onClick={() => setView('fleet')}
          >
            <CarFront size={19} />
            Járművek
            <ArrowRight size={16} />
          </button>
          <button
            className={view === 'organization' ? 'nav-item active' : 'nav-item'}
            aria-current={view === 'organization' ? 'page' : undefined}
            onClick={() => setView('organization')}
          >
            <Building2 size={19} />
            Cégadatok
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
              <small>{tenant ? roles[tenant.role] : 'Nincs kiválasztott cég'}</small>
            </span>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Munkaterület <span className="breadcrumb-separator">/</span>{' '}
            {view === 'fleet' ? 'Járművek' : 'Cégadatok'}
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
              <p className="eyebrow">{tenant?.name ?? 'HERMES'}</p>
              <h1>
                {!tenant ? 'Saját munkaterület' : view === 'fleet' ? 'Járműállomány' : 'Cégadatok'}
              </h1>
              <p className="page-description">
                {!tenant
                  ? 'Hozd létre a cégedet a flottakezelés megkezdéséhez.'
                  : view === 'fleet'
                    ? 'A kiválasztott cég járművei, egy helyen.'
                    : 'Az aktuális munkaterület és hozzáférésed.'}
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
          {tenants.isError ? (
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
          ) : view === 'organization' ? (
            <section className="organization-panel" aria-label="Munkaterület adatai">
              <dl>
                <div>
                  <dt>Cég neve</dt>
                  <dd>{tenant.name}</dd>
                </div>
                <div>
                  <dt>Jogosultságod</dt>
                  <dd>{roles[tenant.role]}</dd>
                </div>
              </dl>
            </section>
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
                <FleetTable vehicles={visibleVehicles} />
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
                {visibleVehicles.length} megjelenített jármű<span>{roles[tenant.role]}</span>
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
      void queryClient.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
    }
  }, [queryClient, session.data])

  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (
          event.type === 'updated' &&
          event.query.queryKey[0] !== 'session' &&
          event.query.state.error instanceof ApiError &&
          event.query.state.error.status === 401
        ) {
          resetCsrfToken()
          void queryClient.cancelQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
          queryClient.setQueryData(['session'], null)
          queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
        }
      }),
    [queryClient],
  )

  async function changeSession(user: Session | null) {
    resetCsrfToken()
    await queryClient.cancelQueries()
    queryClient.setQueryData(['session'], user)
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
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
    <FleetWorkspace
      key={session.data.id}
      user={session.data}
      onLogout={() => void logout()}
      loggingOut={loggingOut}
      logoutError={logoutError}
    />
  ) : (
    <AuthScreen onAuthenticated={changeSession} />
  )
}
