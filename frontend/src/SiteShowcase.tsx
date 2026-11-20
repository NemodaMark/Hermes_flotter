import type { Site } from './organizationApi'
import { Button } from './ui/Button'
import { Badge } from './ui/Badge'
import './showcase.css'

export function SiteShowcase({ sites, active, permissions, onEdit, onStatus }: {
  sites: Site[]; active: boolean; permissions: string[]; onEdit: (site: Site) => void; onStatus: (site: Site) => void
}) {
  return <div className="showcase-grid" aria-label="Telephelyek helyszínnézete">{sites.map(site => <article className="showcase-item" key={site.id}>
    <div className="showcase-cover"><div className="site-silhouette" aria-hidden="true" /><span>{site.data.code}</span></div>
    <div className="showcase-content"><h3>{site.data.name}</h3><Badge tone={site.isArchived ? 'neutral' : 'success'}>{site.isArchived ? 'Archivált' : 'Aktív'}</Badge>
      <p>{[site.data.address.postalCode, site.data.address.city, site.data.address.addressLine1].filter(Boolean).join(' ') || 'Nincs címadat'}</p>
      {site.vehicleCount != null && <strong>{site.vehicleCount} jármű</strong>}
      {site.contactName && <p>{site.contactName}</p>}
      <p>{[site.data.email, site.data.phone].filter(Boolean).join(' · ')}</p>
      <SiteActions site={site} active={active} permissions={permissions} onEdit={onEdit} onStatus={onStatus} />
    </div>
  </article>)}</div>
}

export function SiteActions({ site, active, permissions, onEdit, onStatus }: { site: Site; active: boolean; permissions: string[]; onEdit: (site: Site) => void; onStatus: (site: Site) => void }) {
  return <div className="member-actions">
        {active && !site.isArchived && (site.permissions ?? permissions).includes('sites.update') && <Button className="secondary-button" aria-label={`Telephely szerkesztése: ${site.data.name}`} onClick={() => onEdit(site)}>Szerkesztés</Button>}
        {active && (site.permissions ?? permissions).includes('sites.archive') && <Button className="secondary-button" aria-label={`Telephely állapota: ${site.data.name}`} onClick={() => onStatus(site)}>{site.isArchived ? 'Visszaállítás' : 'Archiválás'}</Button>}
      </div>
}
