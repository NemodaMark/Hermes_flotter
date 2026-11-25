import { Button } from './ui/Button'
import { lazy, Suspense, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, Building2, CarFront, Camera, Gauge, Pencil, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import type { Session, Tenant } from './api'
import { peopleApi } from './peopleApi'
import { ProtectedImage } from './ProtectedImage'
import { initials } from './peopleDisplay'
import { UserProfileEditor } from './UserProfileEditor'
import { GroupAssignmentDialog } from './PermissionGroups'
import { QueryMessage } from './FleetFields'
import { ProfileCompanyAccess } from './ProfileCompanyAccess'
import { TabButton } from './ui/TabButton'
import { EntraConnection } from './EntraConnection'
import { mileageApi } from './mileageApi'
import { ProfileMileageSummary } from './ProfileMileageSummary'
import './profiles.css'

const ProfileMileageLedger = lazy(() => import('./MileagePanel').then(module => ({ default: module.MileageLedgerPanel })))

export function UserProfilePage({ id, actor, tenant, onBack, onVehicle }: {
  id: string; actor: Session; tenant?: Tenant; onBack: () => void; onVehicle?: (id: string) => void
}) {
  const client = useQueryClient()
  const [groups, setGroups] = useState(false)
  const [editing, setEditing] = useState(false)
  const profile = useQuery({ queryKey: ['person-profile', actor.id, tenant?.id, id, actor.systemPermissions?.join(','), tenant?.permissions.join(',')], queryFn: ({ signal }) => peopleApi.profile(id, tenant?.id, signal), retry: false })
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['person-profile'] }), client.invalidateQueries({ queryKey: ['user-profile'] }),
      client.invalidateQueries({ queryKey: ['people-list'] }), client.invalidateQueries({ queryKey: ['members'] }),
      client.invalidateQueries({ queryKey: ['system-users'] }), client.invalidateQueries({ queryKey: ['session'] }),
      client.invalidateQueries({ queryKey: ['profile-member'] }), client.invalidateQueries({ queryKey: ['tenants'] }),
    ])
  }
  const avatar = useMutation({ mutationFn: (file: File | null) => file ? peopleApi.avatar(id, file, profile.data!.version) : peopleApi.deleteAvatar(id, profile.data!.version), onSuccess: refresh })
  const editSelf = useMutation({ mutationFn: (body: { displayName: string; phoneNumber: string | null }) => peopleApi.editSelf({ ...body, version: profile.data!.version }), onSuccess: refresh })
  const person = profile.isError ? undefined : profile.data?.person
  const systemManager = actor.systemPermissions?.includes('system.manage') ?? false
  const canManageAccount = systemManager && !!person && !!profile.data?.canManageAccount
  const ownProfile = id === actor.id
  const canEdit = !!person && !!profile.data?.canEdit && (ownProfile || canManageAccount)
  const canReadMileage = !!person && !!tenant && (tenant.permissions.includes('mileage.manage') || ownProfile && tenant.permissions.includes('mileage.record'))
  const mileage = useQuery({
    queryKey: ['mileage', tenant?.id, id, 'current', actor.id],
    queryFn: ({ signal }) => mileageApi.current(tenant!.id, id, signal),
    enabled: canReadMileage, retry: false,
  })
  const canManageGroups = systemManager || !!tenant?.permissions.includes('permissions.manage')
  const canManageAccess = canManageGroups || !!(tenant?.permissions.includes('members.update') && tenant.permissions.includes('members.read'))
  return <section className="profile-page" aria-label="Felhasználói profil">
    <Button className="text-button org-back" onClick={onBack}><ArrowLeft size={16} />Vissza a felhasználókhoz</Button>
    <QueryMessage pending={profile.isPending} error={profile.error} retry={() => void profile.refetch()} />
    {profile.data && person &&
      <section className="profile-summary">
        <ProtectedImage path={peopleApi.avatarPath(id)} tenantId={tenant?.id} revision={person.avatarRevision} alt={`${person.displayName} profilképe`} fallback={initials(person.displayName)} className="profile-portrait" />
        <div className="profile-identity"><h2>{person.displayName}</h2><p>@{person.id}</p></div>
        {tenant && <div className="profile-company-context"><Building2 size={17} aria-hidden="true" /><span>{tenant.name}</span></div>}
      </section>}
    {(person || canManageAccess) && <ProfileSections sections={[
      { id: 'data', label: 'Profiladatok', icon: <UserRound size={16} aria-hidden="true" />, content: (_, openTab) => profile.data && person && <div className="profile-workspace" data-with-mileage={canReadMileage || undefined}>
        {canReadMileage && <section className="profile-card profile-month" aria-label="Aktuális havi km-állás">
          <h3>Aktuális havi km-állás</h3>
          <QueryMessage pending={mileage.isPending} error={mileage.error} retry={() => void mileage.refetch()} />
          {mileage.data && !mileage.isError && <ProfileMileageSummary report={mileage.data} onOpen={() => openTab('mileage')} />}
        </section>}
        <div className="profile-sidebar">
          <section className="profile-card" aria-label="Kapcsolattartási adatok">
            <div className="profile-card-heading"><h3>Kapcsolattartási adatok</h3>
              {canEdit && <Button type="button" variant="secondary" aria-expanded={editing} disabled={editSelf.isPending || avatar.isPending}
                onClick={() => { editSelf.reset(); setEditing(value => !value) }}><Pencil size={15} aria-hidden="true" />{editing ? 'Bezárás' : 'Szerkesztés'}</Button>}
            </div>
            {editing && canEdit ? <>
              <div className="profile-photo-actions">
                <label className="secondary-button photo-file-button"><Camera size={16} aria-hidden="true" />Profilkép feltöltése<input aria-label="Profilkép feltöltése" type="file" accept="image/jpeg,image/png" disabled={avatar.isPending} onChange={e => { const file = e.target.files?.[0]; if (file) avatar.mutate(file); e.target.value = '' }} /></label>
                {person.avatarRevision && <Button type="button" variant="ghost" className="danger-text" disabled={avatar.isPending} onClick={() => avatar.mutate(null)}><Trash2 size={15} aria-hidden="true" />Kép eltávolítása</Button>}
                <span className="field-hint">JPG vagy PNG · legfeljebb 5 MB</span>
                {avatar.isPending && <span role="status">Kép mentése…</span>}
                {avatar.error && <p className="form-error" role="alert">{avatar.error.message}</p>}
              </div>
              {canManageAccount ? <UserProfileEditor id={id} actor={actor} section="profile" /> :
                <form className="account-form" key={JSON.stringify([person.displayName, person.phoneNumber])} onSubmit={e => {
                  e.preventDefault()
                  const data = new FormData(e.currentTarget)
                  editSelf.mutate({ displayName: String(data.get('name')), phoneNumber: String(data.get('phone')) || null })
                }}>
                  <label>Teljes név<input name="name" defaultValue={person.displayName} required maxLength={120} disabled={editSelf.isPending} /></label>
                  <label>Telefonszám<input name="phone" type="tel" defaultValue={person.phoneNumber ?? ''} maxLength={40} disabled={editSelf.isPending} /></label>
                  {editSelf.error && <p className="form-error" role="alert">{editSelf.error.message}</p>}
                  {editSelf.isSuccess && <p role="status">A profiladatok elmentve.</p>}
                  <div className="dialog-actions"><Button className="primary-button" loading={editSelf.isPending}>Profil mentése</Button></div>
                </form>}
            </> : <dl className="profile-contact">
              <div><dt>E-mail-cím</dt><dd><a href={`mailto:${person.email}`}>{person.email}</a></dd></div>
              <div><dt>Telefonszám</dt><dd>{person.phoneNumber ? <a href={`tel:${person.phoneNumber}`}>{person.phoneNumber}</a> : 'Nincs megadva'}</dd></div>
            </dl>}
          </section>
          {tenant && <section className="profile-card" aria-label="Aktuális járművek"><h3>Aktuális járművek</h3>
            {profile.data.vehicles.length ? <ul className="profile-vehicles">{profile.data.vehicles.map(car => <li key={car.id}>
              <CarFront size={20} aria-hidden="true" /><div><strong>{car.registration}</strong><p>{car.make} {car.model}</p>{car.siteName && <small>{car.siteName}</small>}</div>
              {onVehicle && <Button type="button" variant="ghost" aria-label={`Jármű megnyitása: ${car.registration}`} onClick={() => onVehicle(car.id)}><ArrowUpRight size={18} aria-hidden="true" /></Button>}
            </li>)}</ul> : <p className="field-hint">Nincs megtekinthető jármű.</p>}
          </section>}
        </div>
      </div> },
      ...(canReadMileage && tenant ? [{ id: 'mileage', label: 'Havi km-elszámolás', icon: <Gauge size={16} aria-hidden="true" />,
        content: (_: boolean, _openTab: (id: string) => void, opened: boolean) => opened && <section className="profile-card profile-ledger">
          <h3>Havi km-elszámolás</h3>
          <QueryMessage pending={mileage.isPending} error={mileage.error} retry={() => void mileage.refetch()} />
          {mileage.data && !mileage.isError && <Suspense fallback={<p className="notice" role="status">Elszámolás betöltése…</p>}>
            <ProfileMileageLedger tenant={tenant} user={actor} subjectId={id} initialMonth={mileage.data.month} latestMonth={mileage.data.month} />
          </Suspense>}
        </section> }] : []),
      ...(canManageAccess ? [{ id: 'access', label: 'Céges hozzáférések', icon: <Building2 size={16} aria-hidden="true" />, content: () => <section className="profile-card" aria-label="Céges hozzáférések kezelése">
        <div className="profile-access-heading"><h3>Céges hozzáférések</h3>
          {canManageGroups && <Button className="secondary-button" onClick={() => setGroups(true)}>Céges hozzáférések és csoportok</Button>}
        </div>
        {tenant && <ProfileCompanyAccess key={tenant.id} user={actor} tenant={tenant} id={id} onChanged={refresh} />}
      </section> }] : []),
      ...(canManageAccount || ownProfile ? [{ id: 'security', label: 'Fiókbiztonság', icon: <ShieldCheck size={16} aria-hidden="true" />, content: (active: boolean) => <section className="profile-card">
        {canManageAccount && <UserProfileEditor id={id} actor={actor} section="security" active={active} />}
        {ownProfile && active && <EntraConnection userId={id} />}
      </section> }] : []),
    ]} />}
    {groups && <GroupAssignmentDialog user={actor} userId={id} onClose={() => { setGroups(false); void refresh() }} />}
  </section>
}

type ProfileSection = { id: string; label: string; icon: ReactNode; content: (active: boolean, openTab: (id: string) => void, opened: boolean) => ReactNode }

function ProfileSections({ sections }: { sections: ProfileSection[] }) {
  const uid = useId()
  const tabs = useRef<HTMLDivElement>(null)
  const [selection, setSelection] = useState({ id: 'data', opened: ['data'] })
  const active = sections.some(section => section.id === selection.id) ? selection.id : sections[0].id
  const openTab = (id: string, focus = true) => {
    setSelection(previous => ({ id, opened: previous.opened.includes(id) ? previous.opened : [...previous.opened, id] }))
    if (focus) tabs.current?.querySelector<HTMLButtonElement>(`[data-profile-tab="${id}"]`)?.focus()
  }
  return <section className="profile-tabbed-panel">
    <div className="profile-tabs" ref={tabs} role="tablist" aria-label="Felhasználói adatlap részei" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = sections.findIndex(section => section.id === active)
      const next = event.key === 'Home' ? sections[0] : event.key === 'End' ? sections[sections.length - 1]
        : sections[(index + (event.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length]
      openTab(next.id)
    }}>
      {sections.map(section => <TabButton key={section.id} role="tab" id={`${uid}-${section.id}-tab`} data-profile-tab={section.id}
        aria-selected={active === section.id} aria-controls={`${uid}-${section.id}`} tabIndex={active === section.id ? 0 : -1}
        onClick={() => openTab(section.id, false)}>{section.icon}{section.label}</TabButton>)}
    </div>
    {sections.map(section => <div key={section.id} role="tabpanel" className="profile-tab-panel" id={`${uid}-${section.id}`}
      aria-labelledby={`${uid}-${section.id}-tab`} hidden={active !== section.id} tabIndex={0}>{section.content(active === section.id, openTab, selection.opened.includes(section.id))}</div>)}
  </section>
}
