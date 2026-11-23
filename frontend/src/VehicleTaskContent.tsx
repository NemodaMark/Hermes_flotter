import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { Session, Tenant } from './api'
import type { VehicleRecord } from './fleetApi'
import type { StudioSection } from './VehicleStudio'
import { fleetApi } from './fleetApi'
import { VehicleFields } from './VehicleFields'
import { FleetAudit, QueryMessage, SelectField } from './FleetFields'
import { MetadataLine } from './OrganizationForms'
import { VehicleContracts } from './VehicleContracts'
import { VehicleDocuments } from './VehicleDocuments'
import { VehicleAssignee, VehiclePhotos } from './VehicleMedia'
import { VehicleAssignmentHistory } from './VehicleAssignmentHistory'
import { VehicleDetailGroup } from './VehicleDetailGroup'
import { VehicleHistory } from './VehicleHistory'
import { Button } from './ui/Button'
import { vehicleTaskAllowed } from './vehicleDetailModel'

const VehicleBookingCalendar = lazy(() => import('./VehicleOperations').then(m => ({ default: m.VehicleBookingCalendar })))
const VehicleFuel = lazy(() => import('./VehicleOperations').then(m => ({ default: m.VehicleFuel })))
const VehicleHandovers = lazy(() => import('./VehicleOperations').then(m => ({ default: m.VehicleHandovers })))

export type VehicleContentProps = { user: Session; tenant: Tenant; record: VehicleRecord; onChanged: () => Promise<void> }
export function VehicleReadData({ tenant, record }: Pick<VehicleContentProps, 'tenant' | 'record'>) {
  const data = { registration: record.vehicle.registration, make: record.vehicle.make, model: record.vehicle.model,
    status: record.vehicle.status, version: record.vehicle.version!, data: record.data }
  return <div className="vehicle-readonly">
    <VehicleFields tenantId={tenant.id} data={data} setData={() => {}} disabled readOnly preferredServicePartnerName={record.preferredServicePartnerName} />
    <VehicleDetailGroup title="Rögzítési adatok"><MetadataLine version={data.version} updatedAt={record.updatedAt} updatedBy={record.updatedBy} /></VehicleDetailGroup>
  </div>
}

export function VehicleTaskContent({ section, showCurrent = true, ...props }: VehicleContentProps & { section: StudioSection; showCurrent?: boolean }) {
  const { tenant, record, user, onChanged } = props, car = record.vehicle
  if (!vehicleTaskAllowed(section, record, tenant)) return <p className="notice">Nincs jogosultságod ehhez a művelethez.</p>
  const can = (code: string) => (car.permissions ?? tenant.permissions).includes(code)
  return <Suspense fallback={<p className="notice" role="status">Betöltés…</p>}>
    {section === 'data' && <VehicleReadData tenant={tenant} record={record} />}
    {section === 'site' && <div className="vehicle-assignment-content"><VehicleAssignee tenant={tenant} car={car} onChanged={onChanged} showCurrent={showCurrent} />
      <VehicleSite key={car.version} tenantId={tenant.id} record={record} showCurrent={showCurrent} editable={can('sites.vehicles.assign') && car.status !== 'Archived'} onSaved={onChanged} /></div>}
    {section === 'photos' && <VehiclePhotos tenant={tenant} car={car} onChanged={onChanged} />}
    {(section === 'leases' || section === 'services') && <VehicleContracts tenant={tenant} car={car} kind={section} onChanged={onChanged} />}
    {section === 'documents' && <VehicleDocuments tenantId={tenant.id} vehicleId={car.id} registration={car.registration} kind="vehicle"
      target={{ id: car.id, name: 'Járműokmányok', version: car.version! }} canRead={can('vehicles.documents.read')}
      canManage={can('vehicles.documents.manage') && car.status !== 'Archived'} embedded onChanged={onChanged} onClose={() => {}} />}
    {section === 'history' && <VehicleHistory tenantId={tenant.id} id={car.id} kind="odometer" />}
    {section === 'assignees' && <VehicleAssignmentHistory tenantId={tenant.id} id={car.id} />}
    {section === 'bookings' && <VehicleBookingCalendar tenant={tenant} car={car} userId={user.id} onChanged={onChanged} />}
    {section === 'fuel' && <VehicleFuel tenant={tenant} car={car} userId={user.id} showCreate={false} />}
    {section === 'handovers' && <VehicleHandovers tenant={tenant} car={car} onChanged={onChanged} />}
    {section === 'audit' && <FleetAudit tenantId={tenant.id} id={car.id} vehicle />}
  </Suspense>
}

function VehicleSite({ tenantId, record, editable, onSaved, showCurrent }: { tenantId: string; record: VehicleRecord; editable: boolean; onSaved: () => Promise<void>; showCurrent: boolean }) {
  const [siteId, setSiteId] = useState(record.vehicle.siteId ?? '')
  const options = useQuery({ queryKey: ['fleet-management', tenantId, record.vehicle.id, 'site-options'], queryFn: ({ signal }) => fleetApi.siteOptions(tenantId, record.vehicle.id, signal), enabled: editable, retry: false })
  const save = useMutation({ mutationFn: () => fleetApi.assignSite(tenantId, record.vehicle.id, siteId || null, record.vehicle.version!), onSuccess: onSaved })
  if (!editable && !showCurrent) return null
  return <form className="org-form" onSubmit={e => { e.preventDefault(); if (editable) save.mutate() }}>
    {showCurrent && <p className="fleet-detail-caption">Jelenlegi telephely: {record.vehicle.siteName ?? 'Nincs kijelölve'}</p>}
    {editable && <><QueryMessage pending={options.isPending} error={options.error} retry={() => void options.refetch()} />{options.data && <>
      <SelectField label="Új telephely" value={siteId} onChange={setSiteId} disabled={save.isPending} required={!options.data.canUnassign}
        options={{ ...(options.data.canUnassign ? { '': 'Telephely nélkül' } : !siteId ? { '': 'Válassz telephelyet' } : {}), ...(record.vehicle.siteId ? { [record.vehicle.siteId]: record.vehicle.siteName ?? 'Jelenlegi telephely' } : {}), ...Object.fromEntries(options.data.sites.map(x => [x.id, `${x.name} (${x.code})`])) }} />
      {save.error && <p className="notice error" role="alert">{save.error.message}</p>}<div className="dialog-actions"><Button className="secondary-button" disabled={save.isPending || siteId === (record.vehicle.siteId ?? '')}>Telephely mentése</Button></div>
    </>}</>}
  </form>
}
