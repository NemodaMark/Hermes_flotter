import { Button } from './ui/Button'
import { useState } from 'react'
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
  return <section className="profile-page" aria-label="Felhasználói profil">
    <Button className="text-button org-back" onClick={onBack}><ArrowLeft size={16} />Vissza a felhasználókhoz</Button>
    <QueryMessage pending={profile.isPending} error={profile.error} retry={() => void profile.refetch()} />
    {profile.data && person && <>
      <section className="access-panel profile-summary">
        <ProtectedImage path={peopleApi.avatarPath(id)} tenantId={tenant?.id} revision={person.avatarRevision} alt={`${person.displayName} profilképe`} fallback={initials(person.displayName)} className="profile-portrait" />
        <div className="profile-identity"><h2>{person.displayName}</h2><p>@{person.id}</p><a href={`mailto:${person.email}`}>{person.email}</a>{person.phoneNumber && <a href={`tel:${person.phoneNumber}`}>{person.phoneNumber}</a>}</div>
        {profile.data.canEdit && <div className="profile-photo-actions">
          <label className="secondary-button photo-file-button"><Camera size={16} />Profilkép feltöltése<input aria-label="Profilkép feltöltése" type="file" accept="image/jpeg,image/png" disabled={avatar.isPending} onChange={e => { const file = e.target.files?.[0]; if (file) avatar.mutate(file); e.target.value = '' }} /></label>
          {person.avatarRevision && <Button className="text-button danger-text" disabled={avatar.isPending} onClick={() => avatar.mutate(null)}><Trash2 size={15} />Kép eltávolítása</Button>}
          <span className="field-hint">JPG vagy PNG · legfeljebb 5 MB</span>
          {avatar.isPending && <span role="status">Kép mentése…</span>}
          {avatar.error && <p className="form-error" role="alert">{avatar.error.message}</p>}
        </div>}
      </section>
      <div className="profile-columns">
        <section className="access-panel profile-section"><h3>Jelenleg nála lévő járművek</h3>
          {profile.data.vehicles.length ? <ul className="profile-vehicles">{profile.data.vehicles.map(car => <li key={car.id}><CarFront size={21} /><div><Button className="text-button" disabled={!onVehicle} onClick={() => onVehicle?.(car.id)}>{car.registration}</Button><p>{car.make} {car.model}</p><span className="field-hint">{car.siteName ?? 'Telephely nélkül'}</span></div></li>)}</ul> : <p className="field-hint">Nincs számodra megtekinthető aktuális jármű-hozzárendelés.</p>}
        </section>
        <section className="access-panel profile-section"><h3>Kapcsolattartási adatok</h3>
          {profile.data.canEdit && id === actor.id && !profile.data.canManageAccount ? <form className="account-form" key={profile.data.version} onSubmit={e => { e.preventDefault(); const data = new FormData(e.currentTarget); editSelf.mutate({ displayName: String(data.get('name')), phoneNumber: String(data.get('phone')) || null }) }}>
            <label>Teljes név<input name="name" defaultValue={person.displayName} required maxLength={120} disabled={editSelf.isPending} /></label>
            <label>Telefonszám<input name="phone" type="tel" defaultValue={person.phoneNumber ?? ''} maxLength={40} disabled={editSelf.isPending} /></label>
            {editSelf.error && <p className="form-error" role="alert">{editSelf.error.message}</p>}
            <Button className="primary-button" disabled={editSelf.isPending}>Profil mentése</Button>
          </form> : <dl className="profile-details"><div><dt>E-mail-cím</dt><dd>{person.email}</dd></div><div><dt>Telefonszám</dt><dd>{person.phoneNumber || 'Nincs megadva'}</dd></div>{tenant && <div><dt>Kiválasztott cég</dt><dd>{tenant.name}</dd></div>}</dl>}
        </section>
      </div>
    </>}
    {(actor.systemPermissions?.includes('system.manage') || tenant?.permissions.includes('permissions.manage') || (tenant?.permissions.includes('members.update') && tenant.permissions.includes('members.read'))) && <section className="access-panel profile-section" aria-label="Céges hozzáférések kezelése">
      <div className="profile-access-heading"><h3>Céges hozzáférések</h3>
        {(actor.systemPermissions?.includes('system.manage') || tenant?.permissions.includes('permissions.manage')) && <Button className="secondary-button" onClick={() => setGroups(true)}>Céges hozzáférések és csoportok</Button>}
      </div>
      {tenant && <ProfileCompanyAccess key={tenant.id} user={actor} tenant={tenant} id={id} onChanged={refresh} />}
    </section>}
    {profile.data?.canManageAccount && <section className="access-panel profile-section"><h3>Fiók kezelése</h3><UserProfileEditor id={id} actor={actor} /></section>}
    {groups && <GroupAssignmentDialog user={actor} userId={id} onClose={() => { setGroups(false); void refresh() }} />}
  </section>
}
