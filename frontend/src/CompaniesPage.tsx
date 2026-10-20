import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, RefreshCw } from 'lucide-react'
import type { Session } from './api'
import { AccessDialog } from './AccessDialog'
import {
  CompanyForm,
  ContactDialog,
  DialogActions,
  SiteDialog,
  StatusDialog,
} from './OrganizationForms'
import { companyStatusName, organizationApi } from './organizationApi'
import type { CompanyRow, Contact, Site, SiteVehicle } from './organizationApi'
import './organizations.css'
import { OrganizationAuditChanges } from './OrganizationAuditChanges'

export function PageButtons({
  page,
  total,
  pending,
  onPage,
}: {
  page: number
  total: number
  pending: boolean
  onPage: (page: number) => void
}) {
  return (
    <div className="table-footer access-pagination">
      <span>
        {total} találat · {page}. oldal
      </span>
      <div>
        <button
          className="secondary-button"
          disabled={pending || page === 1}
          onClick={() => onPage(page - 1)}
        >
          Előző oldal
        </button>
        <button
          className="secondary-button"
          disabled={pending || page * 25 >= total}
          onClick={() => onPage(page + 1)}
        >
          Következő oldal
        </button>
      </div>
    </div>
  )
}
export function CompaniesPage({
  user,
  initialCompanyId,
  onNewCompany,
}: {
  user: Session
  initialCompanyId?: string
  onNewCompany: () => void
}) {
  const [selected, setSelected] = useState<CompanyRow | null>(null)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState('Active')
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const companies = useQuery({
    queryKey: ['companies', user.id, page, search, status],
    queryFn: ({ signal }) => organizationApi.companies(page, search, status, signal),
    retry: false,
  })
  if (selected)
    return (
      <CompanyWorkspace
        key={selected.id}
        user={user}
        company={selected}
        onBack={() => {
          setSelected(null)
          void companies.refetch()
        }}
      />
    )
  return (
    <section className="access-panel" aria-label="Cégek kezelése">
      <div className="org-toolbar">
        <div>
          <h2>Cégek</h2>
          <p>A hozzáférhető cégek és telephelyeik.</p>
        </div>
        <div className="member-actions">
          <button
            className="icon-button"
            aria-label="Céglista frissítése"
            disabled={companies.isFetching}
            onClick={() => void companies.refetch()}
          >
            <RefreshCw size={17} />
          </button>
          <button className="primary-button" onClick={onNewCompany}>
            <Plus size={16} />
            Új cég
          </button>
        </div>
      </div>
      <form
        className="access-search system-user-search"
        onSubmit={(e) => {
          e.preventDefault()
          setSearch(draft.trim())
          setPage(1)
        }}
      >
        <input
          className="system-search"
          aria-label="Cég keresése"
          placeholder="Cégnév"
          value={draft}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
        />
        <label>
          Állapot
          <select
            aria-label="Cégek szűrése állapot szerint"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value)
              setPage(1)
            }}
          >
            <option value="Active">Aktív cégek</option>
            <option value="Suspended">Felfüggesztett cégek</option>
            <option value="Archived">Archivált cégek</option>
            <option value="all">Minden állapot</option>
          </select>
        </label>
        <button className="secondary-button">Keresés</button>
      </form>
      {companies.isError ? (
        <p role="alert" className="notice error">
          {companies.error.message}
        </p>
      ) : companies.isPending ? (
        <p className="notice">Cégek betöltése…</p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="org-table org-company-table">
              <thead>
                <tr>
                  <th>Cég</th>
                  <th>Állapot</th>
                  <th>Művelet</th>
                </tr>
              </thead>
              <tbody>
                {companies.data.items.map((company) => (
                  <tr key={company.id}>
                    <td>
                      <strong>{company.name}</strong>
                      {company.id === initialCompanyId && (
                        <span className="member-email">Kiválasztott munkaterület</span>
                      )}
                    </td>
                    <td>
                      <CompanyStatus status={company.status} />
                    </td>
                    <td>
                      <button
                        className="secondary-button"
                        aria-label={`Cég megnyitása: ${company.name}`}
                        onClick={() => setSelected(company)}
                      >
                        Megnyitás
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {companies.data.total === 0 && (
            <p className="notice">Nincs találat vagy nincs céges kezelési jogosultságod.</p>
          )}
          <PageButtons
            page={page}
            total={companies.data.total}
            pending={companies.isFetching}
            onPage={setPage}
          />
        </>
      )}
    </section>
  )
}
function CompanyStatus({ status }: { status: string }) {
  return (
    <span
      className={`status ${status === 'Active' ? 'status-active' : status === 'Suspended' ? 'status-maintenance' : 'status-inactive'}`}
    >
      <span />
      {companyStatusName(status)}
    </span>
  )
}
function CompanyWorkspace({
  user,
  company,
  onBack,
}: {
  user: Session
  company: CompanyRow
  onBack: () => void
}) {
  const client = useQueryClient()
  const has = (permission: string) => company.permissions.includes(permission)
  const tabs = [
    ...(has('companies.read') || has('companies.status')
      ? [{ id: 'company', name: 'Cégadatok' }]
      : []),
    ...(has('companies.read') || has('companies.update')
      ? [{ id: 'contacts', name: 'Kapcsolattartók' }]
      : []),
    ...(has('sites.read') || has('sites.create') ? [{ id: 'sites', name: 'Telephelyek' }] : []),
    ...(has('sites.read') && has('vehicles.read')
      ? [{ id: 'vehicles', name: 'Járművek telephelyei' }]
      : []),
    ...(has('audit.read') ? [{ id: 'audit', name: 'Módosítási napló' }] : []),
  ]
  const [tab, setTab] = useState(tabs[0]?.id ?? '')
  const [showArchived, setShowArchived] = useState(false)
  const [auditPage, setAuditPage] = useState(1)
  const [notice, setNotice] = useState('')
  const [dialog, setDialog] = useState<
    | { kind: 'contact'; contact: Contact | null }
    | { kind: 'site'; site: Site | null }
    | { kind: 'contact-status'; contact: Contact }
    | { kind: 'site-status'; site: Site }
    | { kind: 'company-status' }
    | { kind: 'vehicle'; vehicle: SiteVehicle }
    | null
  >(null)
  const key = ['organization', user.id, company.id]
  const profile = useQuery({
    queryKey: [...key, 'profile'],
    queryFn: ({ signal }) => organizationApi.company(company.id, signal),
    enabled: has('companies.read'),
    retry: false,
  })
  const state = useQuery({
    queryKey: [...key, 'state'],
    queryFn: ({ signal }) => organizationApi.companyState(company.id, signal),
    enabled: has('companies.status'),
    retry: false,
  })
  const contacts = useQuery({
    queryKey: [...key, 'contacts', showArchived],
    queryFn: ({ signal }) => organizationApi.contacts(company.id, showArchived, signal),
    enabled: has('companies.read') && ['contacts', 'sites'].includes(tab),
    retry: false,
  })
  const sites = useQuery({
    queryKey: [...key, 'sites', showArchived],
    queryFn: ({ signal }) => organizationApi.sites(company.id, showArchived, signal),
    enabled: has('sites.read') && ['sites', 'vehicles'].includes(tab),
    retry: false,
  })
  const vehicles = useQuery({
    queryKey: [...key, 'vehicles'],
    queryFn: ({ signal }) => organizationApi.vehicles(company.id, signal),
    enabled: has('sites.read') && has('vehicles.read') && tab === 'vehicles',
    retry: false,
  })
  const audit = useQuery({
    queryKey: [...key, 'audit', auditPage],
    queryFn: ({ signal }) => organizationApi.audit(company.id, auditPage, signal),
    enabled: has('audit.read') && tab === 'audit',
    retry: false,
  })
  const companyStatus = state.data?.status ?? profile.data?.status ?? company.status
  const active = companyStatus === 'Active'
  const companyName = profile.data?.data.name ?? company.name
  async function refresh(saved = false) {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: ['companies', user.id] }),
      client.invalidateQueries({ queryKey: ['tenants', user.id] }),
      client.invalidateQueries({ queryKey: ['vehicles', user.id, company.id] }),
      client.invalidateQueries({ queryKey: ['system-audit'] }),
    ])
    if (saved) setNotice('A változás mentve és naplózva.')
  }
  const changed = () => refresh(true)
  const error =
    tab === 'contacts'
      ? contacts.error
      : tab === 'sites'
        ? sites.error
        : tab === 'vehicles'
          ? (vehicles.error ?? sites.error)
          : tab === 'audit'
            ? audit.error
            : (profile.error ?? state.error)
  return (
    <div className="org-workspace">
      <button className="text-button org-back" onClick={onBack}>
        <ArrowLeft size={16} />
        Vissza a cégekhez
      </button>
      <section className="access-panel" aria-label="Cég és telephelyek">
        <div className="org-toolbar">
          <div>
            <h2>{companyName}</h2>
            <CompanyStatus status={companyStatus} />
          </div>
          <button
            className="icon-button"
            aria-label="Cégadatok frissítése"
            onClick={() => {
              setNotice('')
              void refresh()
            }}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        {!active && (
          <p className="notice">
            A cég {companyStatusName(companyStatus).toLocaleLowerCase('hu-HU')}. Az adatok
            megtekinthetők; a módosításhoz aktív állapot szükséges.
            {(state.data?.reason ?? profile.data?.statusReason) &&
              ` Indok: ${state.data?.reason ?? profile.data?.statusReason}`}
          </p>
        )}
        <div className="access-tabs org-tabs" role="tablist" aria-label="Cég kezelése">
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => {
                setTab(item.id)
                setNotice('')
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
        {notice && (
          <p className="notice success" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error.message}
          </p>
        )}
        {tab === 'company' && (
          <>
            <div className="org-section-tools">
              {has('companies.status') && (
                <button
                  className="secondary-button"
                  disabled={!state.data}
                  onClick={() => setDialog({ kind: 'company-status' })}
                >
                  Cég állapotának kezelése
                </button>
              )}
            </div>
            {profile.isPending && has('companies.read') ? (
              <p className="notice">Cégadatok betöltése…</p>
            ) : profile.data ? (
              <CompanyForm
                key={`${company.id}:${profile.data.data.version}`}
                company={profile.data}
                tenantId={company.id}
                canEdit={has('companies.update')}
                onSaved={changed}
                onReload={() => void refresh()}
              />
            ) : (
              !has('companies.read') && (
                <p className="notice">A cég törzsadatainak megtekintéséhez nincs jogosultságod.</p>
              )
            )}
          </>
        )}
        {tab === 'sites' && (
          <p className="notice">
            A cég fizikai helyszínei, például irodák, raktárak vagy garázsok.
            A járműveket a Járművek telephelyei fülön rendelheted hozzájuk.
          </p>
        )}
        {(tab === 'contacts' || tab === 'sites') && (
          <div className="org-section-tools">
            <label className="org-checkbox">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
              />
              Archiváltak megjelenítése
            </label>
            {active && (tab === 'contacts' ? has('companies.update') : has('sites.create')) && (
              <button
                className="primary-button"
                onClick={() =>
                  tab === 'contacts'
                    ? setDialog({ kind: 'contact', contact: null })
                    : setDialog({ kind: 'site', site: null })
                }
              >
                <Plus size={16} />
                {tab === 'contacts' ? 'Új kapcsolattartó' : 'Új telephely'}
              </button>
            )}
          </div>
        )}
        {tab === 'contacts' &&
          (!has('companies.read') ? (
            <p className="notice">A meglévő kapcsolattartók megtekintéséhez nincs jogosultságod.</p>
          ) : contacts.isPending ? (
            <p className="notice">Kapcsolattartók betöltése…</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>Kapcsolattartó</th>
                      <th>Elérhetőség</th>
                      <th>Állapot</th>
                      <th>Műveletek</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.data?.map((contact) => (
                      <tr key={contact.id}>
                        <td>
                          <strong>{contact.data.name}</strong>
                          <span className="member-email">{contact.data.position ?? '–'}</span>
                        </td>
                        <td>
                          {contact.data.email ?? '–'}
                          <span className="member-email">{contact.data.phone ?? '–'}</span>
                        </td>
                        <td>{contact.isArchived ? 'Archivált' : 'Aktív'}</td>
                        <td>
                          <div className="member-actions">
                            {active && has('companies.update') && (
                              <>
                                {!contact.isArchived && (
                                  <button
                                    className="secondary-button"
                                    aria-label={`Kapcsolattartó szerkesztése: ${contact.data.name}`}
                                    onClick={() => setDialog({ kind: 'contact', contact })}
                                  >
                                    Szerkesztés
                                  </button>
                                )}
                                <button
                                  className="secondary-button"
                                  aria-label={`Kapcsolattartó állapota: ${contact.data.name}`}
                                  onClick={() => setDialog({ kind: 'contact-status', contact })}
                                >
                                  {contact.isArchived ? 'Visszaállítás' : 'Archiválás'}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {contacts.data?.length === 0 && <p className="notice">Még nincs kapcsolattartó.</p>}
            </>
          ))}
        {tab === 'sites' &&
          (!has('sites.read') ? (
            <p className="notice">A meglévő telephelyek megtekintéséhez nincs jogosultságod.</p>
          ) : sites.isPending ? (
            <p className="notice">Telephelyek betöltése…</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>Telephely</th>
                      <th>Cím / elérhetőség</th>
                      <th>Kapcsolattartó</th>
                      <th>Járművek</th>
                      <th>Műveletek</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sites.data?.map((site) => (
                      <tr key={site.id}>
                        <td>
                          <strong>{site.data.name}</strong>
                          <span className="member-email">
                            {site.data.code} · {site.isArchived ? 'Archivált' : 'Aktív'}
                          </span>
                        </td>
                        <td>
                          {[
                            site.data.address.postalCode,
                            site.data.address.city,
                            site.data.address.addressLine1,
                            site.data.address.addressLine2,
                          ]
                            .filter(Boolean)
                            .join(' ') || 'Nincs címadat'}
                          <span className="member-email">
                            {[site.data.email, site.data.phone].filter(Boolean).join(' · ')}
                          </span>
                        </td>
                        <td>{site.contactName ?? '–'}</td>
                        <td>{site.vehicleCount}</td>
                        <td>
                          <div className="member-actions">
                            {active && !site.isArchived && has('sites.update') && (
                              <button
                                className="secondary-button"
                                aria-label={`Telephely szerkesztése: ${site.data.name}`}
                                onClick={() => setDialog({ kind: 'site', site })}
                              >
                                Szerkesztés
                              </button>
                            )}
                            {active && has('sites.archive') && (
                              <button
                                className="secondary-button"
                                aria-label={`Telephely állapota: ${site.data.name}`}
                                onClick={() => setDialog({ kind: 'site-status', site })}
                              >
                                {site.isArchived ? 'Visszaállítás' : 'Archiválás'}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sites.data?.length === 0 && (
                <p className="notice">
                  Ennél a cégnél még nincs telephely rögzítve.
                </p>
              )}
            </>
          ))}
        {tab === 'vehicles' &&
          (vehicles.isPending ? (
            <p className="notice">Járművek betöltése…</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>Jármű</th>
                      <th>Telephely</th>
                      <th>Művelet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.data?.map((vehicle) => (
                      <tr key={vehicle.id}>
                        <td>
                          <strong>{vehicle.registration}</strong>
                          <span className="member-email">
                            {vehicle.make} {vehicle.model}
                          </span>
                        </td>
                        <td>{vehicle.siteName ?? 'Nincs hozzárendelve'}</td>
                        <td>
                          {active && has('sites.vehicles.assign') && (
                            <button
                              className="secondary-button"
                              aria-label={`Telephely-hozzárendelés: ${vehicle.registration}`}
                              onClick={() => setDialog({ kind: 'vehicle', vehicle })}
                            >
                              Telephely módosítása
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {vehicles.data?.length === 0 && <p className="notice">Nincs jármű ennél a cégnél.</p>}
            </>
          ))}
        {tab === 'audit' &&
          (audit.isPending ? (
            <p className="notice">Napló betöltése…</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="org-table">
                  <thead>
                    <tr>
                      <th>Időpont / művelet</th>
                      <th>Módosító</th>
                      <th>Változás</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.data?.items.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          {new Date(entry.createdAt).toLocaleString('hu-HU')}
                          <span className="member-email">{auditAction(entry.action)}</span>
                        </td>
                        <td>{entry.actorSubject}</td>
                        <td>
                          <details>
                            <summary>Részletek</summary>
                            <OrganizationAuditChanges details={entry.details} />
                            {entry.originalActorSubject && (
                              <p className="org-metadata">
                                Korábbi naplóazonosító: {entry.originalActorSubject}
                              </p>
                            )}
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {audit.data && (
                <PageButtons
                  page={auditPage}
                  total={audit.data.total}
                  pending={audit.isFetching}
                  onPage={setAuditPage}
                />
              )}
            </>
          ))}
        {!tab && (
          <p className="notice">
            A részletek megtekintéséhez cég- vagy telephely-megtekintési jog szükséges.
          </p>
        )}
      </section>
      {dialog?.kind === 'contact' && (
        <ContactDialog
          tenantId={company.id}
          contact={dialog.contact}
          onClose={() => setDialog(null)}
          onSaved={changed}
        />
      )}
      {dialog?.kind === 'site' && (
        <SiteDialog
          tenantId={company.id}
          site={dialog.site}
          contacts={contacts.data ?? []}
          onClose={() => setDialog(null)}
          onSaved={changed}
        />
      )}
      {dialog?.kind === 'company-status' && state.data && (
        <StatusDialog
          title="Cég állapotának kezelése"
          currentStatus={state.data.status}
          onClose={() => setDialog(null)}
          onSave={async (reason, status) => {
            await organizationApi.companyStatus(company.id, status, reason, state.data!.version)
            await changed()
          }}
        />
      )}
      {dialog?.kind === 'contact-status' && (
        <StatusDialog
          title={`${dialog.contact.isArchived ? 'Kapcsolattartó visszaállítása' : 'Kapcsolattartó archiválása'}: ${dialog.contact.data.name}`}
          onClose={() => setDialog(null)}
          onSave={async (reason) => {
            await organizationApi.contactStatus(company.id, dialog.contact, reason)
            await changed()
          }}
        />
      )}
      {dialog?.kind === 'site-status' && (
        <StatusDialog
          title={`${dialog.site.isArchived ? 'Telephely visszaállítása' : 'Telephely archiválása'}: ${dialog.site.data.name}`}
          onClose={() => setDialog(null)}
          onSave={async (reason) => {
            await organizationApi.siteStatus(company.id, dialog.site, reason)
            await changed()
          }}
        />
      )}
      {dialog?.kind === 'vehicle' && (
        <VehicleSiteDialog
          tenantId={company.id}
          vehicle={dialog.vehicle}
          sites={sites.data ?? []}
          onClose={() => setDialog(null)}
          onSaved={changed}
        />
      )}
    </div>
  )
}
function VehicleSiteDialog({
  tenantId,
  vehicle,
  sites,
  onClose,
  onSaved,
}: {
  tenantId: string
  vehicle: SiteVehicle
  sites: Site[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [siteId, setSiteId] = useState(vehicle.siteId ?? '')
  const save = useMutation({
    mutationFn: () => organizationApi.assignVehicle(tenantId, vehicle, siteId || null),
  })
  return (
    <AccessDialog
      title={`Jármű telephelye: ${vehicle.registration}`}
      pending={save.isPending}
      onClose={onClose}
    >
      <form
        className="org-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save
            .mutateAsync()
            .then(async () => {
              onClose()
              await onSaved()
            })
            .catch(() => {})
        }}
      >
        <label className="org-field">
          <span>Telephely</span>
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">Nincs hozzárendelve</option>
            {sites
              .filter((x) => !x.isArchived)
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.data.name} ({site.data.code})
                </option>
              ))}
          </select>
        </label>
        {save.isError && (
          <p className="notice error" role="alert">
            {save.error.message}
          </p>
        )}
        <DialogActions pending={save.isPending} onClose={onClose} />
      </form>
    </AccessDialog>
  )
}
function auditAction(action: string) {
  return (
    (
      {
        'company.created': 'Cég létrehozása',
        'company.updated': 'Cégadatok módosítása',
        'company.status_changed': 'Cég állapotváltozása',
        'contact.created': 'Kapcsolattartó létrehozása',
        'contact.updated': 'Kapcsolattartó módosítása',
        'contact.status_changed': 'Kapcsolattartó állapotváltozása',
        'site.created': 'Telephely létrehozása',
        'site.updated': 'Telephely módosítása',
        'site.status_changed': 'Telephely állapotváltozása',
        'site.vehicle_assigned': 'Jármű telephelyének módosítása',
      } as Record<string, string>
    )[action] ?? action
  )
}
