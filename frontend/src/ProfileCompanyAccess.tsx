import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from './api'
import type { Member, Session, Tenant } from './api'
import { PermissionsDialog, StatusDialog } from './MemberDialogs'
import { QueryMessage } from './FleetFields'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'

// Basic colleague data and company management data use their own authorized APIs.
export function ProfileCompanyAccess({ user, tenant, id, onChanged }: {
  user: Session; tenant: Tenant; id: string; onChanged: () => Promise<void>
}) {
  const canRead = tenant.permissions.includes('members.read')
  const canManage = tenant.permissions.includes('permissions.manage')
  const canUpdate = canRead && tenant.permissions.includes('members.update')
  const [dialog, setDialog] = useState<'permissions' | 'status' | null>(null)
  const member = useQuery<Member>({
    queryKey: ['profile-member', user.id, tenant.id, id, tenant.permissions.join(',')],
    queryFn: async ({ signal }) => canRead ? api.member(tenant.id, id, signal) : { ...await api.memberAccess(tenant.id, id, signal), displayName: null, email: null, joinedAt: null, disabledAt: null },
    enabled: canManage || canUpdate, retry: false,
  })
  const catalog = useQuery({ queryKey: ['permission-catalog', user.id], queryFn: ({ signal }) => api.permissions(signal), enabled: canManage, retry: false })
  if (!canManage && !canUpdate) return null
  const missing = member.error instanceof ApiError && member.error.status === 404
  return <div className="profile-company-access">
    <h4>{tenant.name}</h4>
    <QueryMessage pending={member.isPending} error={missing ? null : member.error} retry={() => void member.refetch()} />
    {missing && <p className="field-hint">Nincs céges hozzáférés.</p>}
    {member.data && <>
      <div className="profile-access-summary"><Badge tone={member.data.isActive ? 'success' : 'neutral'}>{member.data.isActive ? 'Aktív' : 'Felfüggesztve'}</Badge>
        <span>{member.data.permissions.length} jogosultság{member.data.groups?.length ? ` · Csoportok: ${member.data.groups.map(group => group.name).join(', ')}` : ''}</span>
      </div>
      {canManage && <QueryMessage pending={false} error={catalog.error} retry={() => void catalog.refetch()} />}
      <div className="member-actions">
        {canManage && <Button className="secondary-button" disabled={!catalog.isSuccess} aria-label={`Jogosultságok: ${member.data.email || id}`} onClick={() => setDialog('permissions')}>Jogosultságok</Button>}
        {canUpdate && <Button className="secondary-button" aria-label={`${member.data.isActive ? 'Felfüggesztés' : 'Visszaállítás'}: ${member.data.email || id}`} onClick={() => setDialog('status')}>{member.data.isActive ? 'Felfüggesztés' : 'Visszaállítás'}</Button>}
      </div>
      {dialog === 'permissions' && canManage && <PermissionsDialog tenant={tenant} member={member.data} catalog={catalog.data ?? []} onClose={() => setDialog(null)} onChanged={onChanged} />}
      {dialog === 'status' && canUpdate && <StatusDialog tenant={tenant} member={member.data} onClose={() => setDialog(null)} onChanged={onChanged} />}
    </>}
  </div>
}
