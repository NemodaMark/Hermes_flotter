import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { Toggle } from './ui/Toggle'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Building2, Plus, RefreshCw, Search } from 'lucide-react'
import { ClickableRow, TableFrame } from './ui/Table'
import { Badge } from './ui/Badge'
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
import { ListToolbar } from './ListToolbar'
import { OrganizationAuditChanges } from './OrganizationAuditChanges'
import { useListSearch } from './useListSearch'

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
        <Button
          className="secondary-button"
          disabled={pending || page === 1}
          onClick={() => onPage(page - 1)}
        >
          Előző oldal
        </Button>
        <Button
          className="secondary-button"
          disabled={pending || page * 25 >= total}
          onClick={() => onPage(page + 1)}
        >
          Következő oldal
        </Button>
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
  const { page, setPage, search, draft, setDraft } = useListSearch()
  const [status, setStatus] = useState('Active')
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
      <ListToolbar label="Cégek keresése és műveletei" actions={<>
        <Button className="icon-button" aria-label="Céglista frissítése" disabled={companies.isFetching} onClick={() => void companies.refetch()}><RefreshCw size={17} /></Button>
        <Button className="primary-button" onClick={onNewCompany}><Plus size={16} />Új cég</Button>
      </>}>
      <div className="list-toolbar-form">
        <div className="search-field">
          <Search size={18} />
          <input aria-label="Cég keresése" placeholder="Cégnév" value={draft} maxLength={100} onChange={(e) => setDraft(e.target.value)} />
        </div>
        <label className="compact-filter">
          <span className="sr-only">Állapot</span>
          <Select
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
          </Select>
        </label>
      </div>
      </ListToolbar>
      {companies.isError ? (
        <p role="alert" className="notice error">
          {companies.error.message}
        </p>
      ) : (
        <>
          <TableFrame hasRows={(companies.data?.items.length ?? 0) > 0}>
            <table className="org-table org-company-table responsive-list compact-list">
              <thead>
                <tr>
                  <th>Cég</th>
                  <th>Állapot</th>
                </tr>
              </thead>
              <tbody>
                {companies.data?.items.map((company) => (
                  <ClickableRow key={company.id} aria-label={`Cég: ${company.name}`} onOpen={() => setSelected(company)}>
                    <td data-label="Cég">
                      <div className="entity-cell"><span className="entity-icon" aria-hidden="true"><Building2 size={18} /></span><div><Button className="row-title" tabIndex={-1} aria-label={`Cég megnyitása: ${company.name}`} onClick={() => setSelected(company)}>{company.name}</Button>
                      {company.id === initialCompanyId && (
                        <span className="member-email">Kiválasztott munkaterület</span>
                      )}
                      </div></div>
                    </td>
                    <td data-label="Állapot">
                      <CompanyStatus status={company.status} />
                    </td>
                  </ClickableRow>
                ))}
                {!companies.data?.items.length && <tr><td colSpan={2} className="table-empty">{companies.isPending ? 'Cégek betöltése…' : 'Nincs találat vagy nincs céges kezelési jogosultságod.'}</td></tr>}
              </tbody>
            </table>
          </TableFrame>
          <PageButtons
            page={page}
            total={companies.data?.total ?? 0}
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
    <Badge tone={status === 'Active' ? 'success' : status === 'Suspended' ? 'warning' : 'neutral'}>
      {companyStatusName(status)}
    </Badge>
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
      <Button className="text-button org-back" onClick={onBack}>
        <ArrowLeft size={16} />
        Vissza a cégekhez
      </Button>
      <section className="access-panel organization-detail-panel" aria-label="Cég és telephelyek">
        <div className="org-toolbar organization-detail-header">
          <div>
            <h2>{companyName}</h2>
            <CompanyStatus status={companyStatus} />
          </div>
          <div className="member-actions">
          {tab === 'company' && has('companies.status') && <Button className="secondary-button" disabled={!state.data} onClick={() => setDialog({ kind: 'company-status' })}>Cég állapotának kezelése</Button>}
          <Button
            className="icon-button"
            aria-label="Cégadatok frissítése"
            onClick={() => {
              setNotice('')
              void refresh()
            }}
          >
            <RefreshCw size={17} />
          </Button>
          </div>
        </div>
        {!active && (
          <p className="notice">
            A cég {companyStatusName(companyStatus).toLocaleLowerCase('hu-HU')}. Az adatok
            megtekinthetők; a módosításhoz aktív állapot szükséges.
            {(state.data?.reason ?? profile.data?.statusReason) &&
              ` Indok: ${state.data?.reason ?? profile.data?.statusReason}`}
          </p>
        )}
        <div className="access-tabs org-tabs organization-tabs" role="tablist" aria-label="Cég kezelése" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const index = tabs.findIndex(item => item.id === tab)
          const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
          if (next) { setTab(next.id); setNotice(''); event.currentTarget.querySelector<HTMLButtonElement>(`[data-company-tab="${next.id}"]`)?.focus() }
        }}>
          {tabs.map((item) => (
            <Button
              key={item.id}
              role="tab"
              data-company-tab={item.id}
              tabIndex={tab === item.id ? 0 : -1}
              aria-selected={tab === item.id}
              onClick={() => {
                setTab(item.id)
                setNotice('')
              }}
            >
              {item.name}
            </Button>
          ))}
        </div>
        {tabs.length > 0 && <label className="org-field organization-picker"><span>Cégadatlap részei</span><Select value={tab} onChange={event => { setTab(event.target.value); setNotice('') }}>{tabs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>}
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
        <div hidden={tab !== 'company'}>
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
        </div>
        {(tab === 'contacts' || tab === 'sites') && (
          <div className="org-section-tools">
            <Toggle checked={showArchived} onChange={setShowArchived}>Archiváltak megjelenítése</Toggle>
            {active && (tab === 'contacts' ? has('companies.update') : has('sites.create') &&
              (!company.permissionScopes || company.permissionScopes.some((s) => s.code === 'sites.create' && s.allSites))) && (
              <Button
                className="primary-button"
                onClick={() =>
                  tab === 'contacts'
                    ? setDialog({ kind: 'contact', contact: null })
                    : setDialog({ kind: 'site', site: null })
                }
              >
                <Plus size={16} />
                {tab === 'contacts' ? 'Új kapcsolattartó' : 'Új telephely'}
              </Button>
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
                <table className="org-table responsive-list">
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
                        <td data-label="Kapcsolattartó">
                          <strong>{contact.data.name}</strong>
                          <span className="member-email">{contact.data.position ?? '–'}</span>
                        </td>
                        <td data-label="Elérhetőség">
                          {contact.data.email ?? '–'}
                          <span className="member-email">{contact.data.phone ?? '–'}</span>
                        </td>
                        <td data-label="Állapot">{contact.isArchived ? 'Archivált' : 'Aktív'}</td>
                        <td data-label="Műveletek">
                          <div className="member-actions">
                            {active && has('companies.update') && (
                              <>
                                {!contact.isArchived && (
                                  <Button
                                    className="secondary-button"
                                    aria-label={`Kapcsolattartó szerkesztése: ${contact.data.name}`}
                                    onClick={() => setDialog({ kind: 'contact', contact })}
                                  >
                                    Szerkesztés
                                  </Button>
                                )}
                                <Button
                                  className="secondary-button"
                                  aria-label={`Kapcsolattartó állapota: ${contact.data.name}`}
                                  onClick={() => setDialog({ kind: 'contact-status', contact })}
                                >
                                  {contact.isArchived ? 'Visszaállítás' : 'Archiválás'}
                                </Button>
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
                <table className="org-table responsive-list">
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
                        <td data-label="Telephely">
                          <strong>{site.data.name}</strong>
                          <span className="member-email">
                            {site.data.code} · {site.isArchived ? 'Archivált' : 'Aktív'}
                          </span>
                        </td>
                        <td data-label="Cím / elérhetőség">
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
                        <td data-label="Kapcsolattartó">{site.contactName ?? '–'}</td>
                        <td data-label="Járművek">{site.vehicleCount ?? '–'}</td>
                        <td data-label="Műveletek">
                          <div className="member-actions">
                            {active && !site.isArchived && (site.permissions ?? company.permissions).includes('sites.update') && (
                              <Button
                                className="secondary-button"
                                aria-label={`Telephely szerkesztése: ${site.data.name}`}
                                onClick={() => setDialog({ kind: 'site', site })}
                              >
                                Szerkesztés
                              </Button>
                            )}
                            {active && (site.permissions ?? company.permissions).includes('sites.archive') && (
                              <Button
                                className="secondary-button"
                                aria-label={`Telephely állapota: ${site.data.name}`}
                                onClick={() => setDialog({ kind: 'site-status', site })}
                              >
                                {site.isArchived ? 'Visszaállítás' : 'Archiválás'}
                              </Button>
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
                <table className="org-table responsive-list">
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
                        <td data-label="Jármű">
                          <strong>{vehicle.registration}</strong>
                          <span className="member-email">
                            {vehicle.make} {vehicle.model}
                          </span>
                        </td>
                        <td data-label="Telephely">{vehicle.siteName ?? 'Nincs hozzárendelve'}</td>
                        <td data-label="Műveletek">
                          {active && (vehicle.permissions ?? company.permissions).includes('sites.vehicles.assign') && (
                            <Button
                              className="secondary-button"
                              aria-label={`Telephely-hozzárendelés: ${vehicle.registration}`}
                              onClick={() => setDialog({ kind: 'vehicle', vehicle })}
                            >
                              Telephely módosítása
                            </Button>
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
                <table className="org-table responsive-list">
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
                        <td data-label="Időpont / művelet">
                          {new Date(entry.createdAt).toLocaleString('hu-HU')}
                          <span className="member-email">{auditAction(entry.action)}</span>
                        </td>
                        <td data-label="Módosító">{entry.actorSubject}</td>
                        <td data-label="Változás">
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
          <Select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {vehicle.canUnassign !== false && <option value="">Nincs hozzárendelve</option>}
            {sites
              .filter((x) => !x.isArchived && (!vehicle.assignableSiteIds || vehicle.assignableSiteIds.includes(x.id)))
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.data.name} ({site.data.code})
                </option>
              ))}
          </Select>
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
