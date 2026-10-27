import { Button } from './ui/Button'
import { useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CarFront, Camera, Trash2 } from 'lucide-react'
import type { Session, Tenant } from './api'
import { peopleApi } from './peopleApi'
import { ProtectedImage } from './ProtectedImage'
import { initials } from './peopleDisplay'
import { UserProfileEditor } from './UserProfileEditor'
import { GroupAssignmentDialog } from './PermissionGroups'
import { QueryMessage } from './FleetFields'
import { ProfileCompanyAccess } from './ProfileCompanyAccess'
import { TabButton } from './ui/TabButton'
import './profiles.css'

export function UserProfilePage({ id, actor, tenant, onBack, onVehicle }: {
  id: string; actor: Session; tenant?: Tenant; onBack: () => void; onVehicle?: (id: string) => void
}) {
  const client = useQueryClient()
  const [groups, setGroups] = useState(false)
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
  const person = profile.data?.person
  const systemManager = actor.systemPermissions?.includes('system.manage') ?? false
  const canManageAccount = systemManager && !!profile.data?.canManageAccount
  const canManageGroups = systemManager || !!tenant?.permissions.includes('permissions.manage')
  const canManageAccess = canManageGroups || !!(tenant?.permissions.includes('members.update') && tenant.permissions.includes('members.read'))
  return <section className="profile-page" aria-label="Felhasználói profil">
    <Button className="text-button org-back" onClick={onBack}><ArrowLeft size={16} />Vissza a felhasználókhoz</Button>
    <QueryMessage pending={profile.isPending} error={profile.error} retry={() => void profile.refetch()} />
    {profile.data && person &&
      <section className="profile-summary">
        <ProtectedImage path={peopleApi.avatarPath(id)} tenantId={tenant?.id} revision={person.avatarRevision} alt={`${person.displayName} profilképe`} fallback={initials(person.displayName)} className="profile-portrait" />
        <div className="profile-identity"><h2>{person.displayName}</h2><p>@{person.id}</p><a href={`mailto:${person.email}`}>{person.email}</a>{person.phoneNumber && <a href={`tel:${person.phoneNumber}`}>{person.phoneNumber}</a>}</div>
        {profile.data.canEdit && <div className="profile-photo-actions">
          <label className="secondary-button photo-file-button"><Camera size={16} />Profilkép feltöltése<input aria-label="Profilkép feltöltése" type="file" accept="image/jpeg,image/png" disabled={avatar.isPending} onChange={e => { const file = e.target.files?.[0]; if (file) avatar.mutate(file); e.target.value = '' }} /></label>
          {person.avatarRevision && <Button className="text-button danger-text" disabled={avatar.isPending} onClick={() => avatar.mutate(null)}><Trash2 size={15} />Kép eltávolítása</Button>}
          <span className="field-hint">JPG vagy PNG · legfeljebb 5 MB</span>
          {avatar.isPending && <span role="status">Kép mentése…</span>}
          {avatar.error && <p className="form-error" role="alert">{avatar.error.message}</p>}
        </div>}
      </section>}
    {(person || canManageAccess) && <ProfileSections sections={[
      { id: 'data', label: 'Profiladatok', content: () => profile.data && person && <div className="profile-columns">
        <section className="profile-section"><h3>Kapcsolattartási adatok</h3>
          {canManageAccount ? <UserProfileEditor id={id} actor={actor} section="profile" /> : profile.data.canEdit && id === actor.id ?
            <form className="account-form" key={JSON.stringify([person.displayName, person.phoneNumber])} onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); editSelf.mutate({ displayName: String(data.get('name')), phoneNumber: String(data.get('phone')) || null }) }}>
              <label>Teljes név<input name="name" defaultValue={person.displayName} required maxLength={120} disabled={editSelf.isPending} /></label>
              <label>Telefonszám<input name="phone" type="tel" defaultValue={person.phoneNumber ?? ''} maxLength={40} disabled={editSelf.isPending} /></label>
              {editSelf.error && <p className="form-error" role="alert">{editSelf.error.message}</p>}
              {editSelf.isSuccess && <p role="status">A profiladatok elmentve.</p>}
              <Button className="primary-button" disabled={editSelf.isPending}>Profil mentése</Button>
            </form> : <dl className="profile-details"><div><dt>E-mail-cím</dt><dd>{person.email}</dd></div><div><dt>Telefonszám</dt><dd>{person.phoneNumber || 'Nincs megadva'}</dd></div>{tenant && <div><dt>Kiválasztott cég</dt><dd>{tenant.name}</dd></div>}</dl>}
        </section>
        <section className="profile-section"><h3>Aktuális járművek</h3>
          {profile.data.vehicles.length ? <ul className="profile-vehicles">{profile.data.vehicles.map(car => <li key={car.id}><CarFront size={21} /><div><Button className="text-button" disabled={!onVehicle} onClick={() => onVehicle?.(car.id)}>{car.registration}</Button><p>{car.make} {car.model}</p><span className="field-hint">{car.siteName ?? 'Telephely nélkül'}</span></div></li>)}</ul> : <p className="field-hint">Nincs megtekinthető jármű.</p>}
        </section>
      </div> },
      ...(canManageAccess ? [{ id: 'access', label: 'Céges hozzáférések', content: () => <section className="profile-section" aria-label="Céges hozzáférések kezelése">
        <div className="profile-access-heading"><h3>Céges hozzáférések</h3>
          {canManageGroups && <Button className="secondary-button" onClick={() => setGroups(true)}>Céges hozzáférések és csoportok</Button>}
        </div>
        {tenant && <ProfileCompanyAccess key={tenant.id} user={actor} tenant={tenant} id={id} onChanged={refresh} />}
      </section> }] : []),
      ...(canManageAccount ? [{ id: 'security', label: 'Fiókbiztonság', content: (active: boolean) => <section className="profile-section"><UserProfileEditor id={id} actor={actor} section="security" active={active} /></section> }] : []),
    ]} />}
    {groups && <GroupAssignmentDialog user={actor} userId={id} onClose={() => { setGroups(false); void refresh() }} />}
  </section>
}

function ProfileSections({ sections }: { sections: { id: string; label: string; content: (active: boolean) => ReactNode }[] }) {
  const uid = useId()
  const tabs = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState('data')
  const active = sections.some(section => section.id === selected) ? selected : 'data'
  return <section className="access-panel profile-tabbed-panel">
    <div className="profile-tabs" ref={tabs} role="tablist" aria-label="Felhasználói adatlap részei" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = sections.findIndex(section => section.id === active)
      const next = event.key === 'Home' ? sections[0] : event.key === 'End' ? sections[sections.length - 1]
        : sections[(index + (event.key === 'ArrowRight' ? 1 : sections.length - 1)) % sections.length]
      setSelected(next.id)
      tabs.current?.querySelector<HTMLButtonElement>(`[data-profile-tab="${next.id}"]`)?.focus()
    }}>
      {sections.map(section => <TabButton key={section.id} role="tab" id={`${uid}-${section.id}-tab`} data-profile-tab={section.id}
        aria-selected={active === section.id} aria-controls={`${uid}-${section.id}`} tabIndex={active === section.id ? 0 : -1}
        onClick={() => setSelected(section.id)}>{section.label}</TabButton>)}
    </div>
    {sections.map(section => <div key={section.id} role="tabpanel" className="profile-tab-panel" id={`${uid}-${section.id}`}
      aria-labelledby={`${uid}-${section.id}-tab`} hidden={active !== section.id} tabIndex={0}>{section.content(active === section.id)}</div>)}
  </section>
}
