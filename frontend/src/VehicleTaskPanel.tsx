import type { Session, Tenant } from './api'
import type { StudioSection } from './VehicleStudio'
import { useVehicleDetails } from './useVehicleDetails'
import { QueryMessage } from './FleetFields'
import { VehicleTaskContent } from './VehicleTaskContent'
import './vehicle-profile.css'

// Garage panels show one authorized task, never the profile's navigation/header.
export function VehicleTaskPanel({ user, tenant, id, section }: { user: Session; tenant: Tenant; id: string; section: StudioSection }) {
  const { record, changed } = useVehicleDetails(user, tenant, id)
  return <div className="vehicle-task-content">
    <QueryMessage pending={record.isPending} error={record.error} retry={() => void record.refetch()} />
    {!record.isError && record.data && <><p className="vehicle-task-context">{record.data.vehicle.make} {record.data.vehicle.model}</p>
      <VehicleTaskContent key={section} user={user} tenant={tenant} record={record.data} onChanged={changed} section={section} />
    </>}
  </div>
}
