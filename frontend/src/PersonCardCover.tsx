import { peopleApi } from './peopleApi'
import { initials } from './peopleDisplay'
import { ProtectedImage } from './ProtectedImage'
import './showcase.css'

export function PersonCardCover({ id, name, tenantId, avatar, background }: {
  id: string; name: string; tenantId?: string; avatar?: string | null; background?: string | null
}) {
  return <div className="showcase-cover">
    {background && <ProtectedImage path={peopleApi.cardBackgroundPath(id)} tenantId={tenantId} revision={background}
      alt="" className="showcase-background" fallback={null} />}
    <ProtectedImage path={peopleApi.avatarPath(id)} tenantId={tenantId} revision={avatar} alt={`${name} profilképe`}
      className="person-avatar" fallback={initials(name)} />
  </div>
}
