import { Button } from './ui/Button'
import type { UseQueryResult } from '@tanstack/react-query'
import type { useMileageCapture } from './useMileageCapture'
import './mileage.css'

export function MileageCaptureFields({ capture, onMonthly, automatic, calculating = false }: {
  capture: ReturnType<typeof useMileageCapture>; onMonthly?: () => void;
  automatic?: UseQueryResult<{ totalKm: number | null }>; calculating?: boolean;
}) {
  if (!capture.allowed) return null
  const total = automatic ? (calculating ? undefined : automatic.data?.totalKm) : Number(capture.total)
  return <div className="mileage-capture">
    {capture.report.isPending && <p role="status" className="field-hint">Km-elszámolás betöltése…</p>}
    {capture.report.error && <p role="alert" className="form-error">{capture.report.error.message}<Button type="button" className="text-button" onClick={() => void capture.report.refetch()}>Újra</Button></p>}
    {capture.report.data && (capture.report.data.mode === 'Monthly' || capture.report.data.submittedAt ? <p className="field-hint">
      {capture.report.data.submittedAt ? 'Ezt a hónapot már lezártad. A magánhasználatot a havi elszámolás javításával módosíthatod.' : 'Havi összesítőt választottál. A teljes és a magánkilométert a havi elszámolásban add meg.'}
      {onMonthly && <Button type="button" className="text-button" onClick={onMonthly}>Havi elszámolás</Button>}
    </p> : <>
      <label className="checkbox-label"><input type="checkbox" checked={capture.include} onChange={e => capture.setInclude(e.target.checked)} />Km és magánhasználat elszámolása · {capture.month.slice(0, 7)}</label>
      {capture.active && (calculating || automatic?.isFetching) && <p className="field-hint" role="status">Elszámolható távolság számítása…</p>}
      {capture.active && !calculating && automatic?.error && <p className="form-error" role="alert">{automatic.error.message}<Button type="button" className="text-button" onClick={() => void automatic.refetch()}>Újra</Button></p>}
      {capture.active && total === null && <p className="field-hint" role="status">Ehhez a tankoláshoz nincs automatikusan elszámolható távolság. Az utat a havi elszámolásban adhatod meg.{Number(capture.personal) > 0 && ' A mentéshez kapcsold ki a tétel elszámolását.'}</p>}
      {capture.active && total != null && <div className="org-form-grid">
        {automatic ? <label className="org-field"><span>Elszámolandó megtett út (km)</span><output aria-live="polite">{total.toLocaleString('hu-HU')} km</output></label>
          : <label className="org-field"><span>Elszámolandó megtett út (km)</span><input type="number" inputMode="numeric" min="0" max="100000000" step="1" value={capture.total} onChange={e => capture.setTotal(e.target.value)} required /></label>}
        <label className="org-field"><span>Ebből magánhasználat (km)</span><input type="number" inputMode="numeric" min="0" max={total} step="1" value={capture.personal} onChange={e => capture.setPersonal(e.target.value)} required /></label>
      </div>}
      {capture.active && !automatic && <p className="field-hint">Csak az adott hónap még el nem számolt útjait add meg. A hónaphatáron átívelő utat a havi elszámolásban bonthatod szét.</p>}
    </>)}
  </div>
}
