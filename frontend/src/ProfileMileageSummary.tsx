import { ArrowRight, Gauge } from 'lucide-react'
import type { MileageReport } from './mileageApi'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'

const kilometers = (value: number) => value.toLocaleString('hu-HU')
const monthName = (month: string) => new Intl.DateTimeFormat('hu-HU', { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(month))

export function ProfileMileageSummary({ report, onOpen }: { report: MileageReport; onOpen: () => void }) {
  const limit = report.monthlyLimitKm
  const remaining = limit == null ? null : limit - report.totalKm
  const exceeded = remaining != null && remaining < 0
  return <div className="profile-mileage-summary">
    <div className="profile-mileage-heading">
      <span><Gauge size={17} aria-hidden="true" />{monthName(report.month)}</span>
      <Badge tone={report.submittedAt ? 'success' : 'neutral'} dot={false}>
        {report.submittedAt ? 'Lezárva' : report.version ? 'Piszkozat' : 'Nincs rögzítés'}
      </Badge>
    </div>
    <div className="profile-mileage-total">
      <div><strong>{kilometers(report.totalKm)}</strong><span> km</span></div>
      <span>Elszámolt távolság</span>
    </div>
    <dl className="profile-mileage-split">
      <div><dt>Céges</dt><dd>{kilometers(report.totalKm - report.privateKm)} km</dd></div>
      <div><dt>Magán</dt><dd>{kilometers(report.privateKm)} km</dd></div>
    </dl>
    <div className="profile-mileage-budget" data-exceeded={exceeded || undefined}>
      <div><span>Havi keret</span><strong>{limit == null ? 'Nincs beállítva' : `${kilometers(limit)} km`}</strong></div>
      {limit != null && limit > 0 && <progress aria-label="Felhasznált havi kilométerkeret" max={limit} value={Math.min(report.totalKm, limit)} />}
      {remaining != null && <div><span>{exceeded ? 'Kerettúllépés' : 'Keretből hátra'}</span><strong>{kilometers(Math.abs(remaining))} km</strong></div>}
    </div>
    <div className="profile-mileage-footer">
      {report.dueMonth && <span>Lezárandó időszak · {monthName(report.dueMonth)}</span>}
      <Button type="button" variant="secondary" onClick={onOpen}>Elszámolás megnyitása<ArrowRight size={16} aria-hidden="true" /></Button>
    </div>
  </div>
}
