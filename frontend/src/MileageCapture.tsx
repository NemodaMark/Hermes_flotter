import { Button } from './ui/Button'
import type { useMileageCapture } from './useMileageCapture'
import './mileage.css'

export function MileageCaptureFields({ capture, onMonthly }: { capture: ReturnType<typeof useMileageCapture>; onMonthly?: () => void }) {
  if (!capture.allowed) return null
  return <div className="mileage-capture">
    {capture.report.isPending && <p role="status" className="field-hint">Km-elszámolás betöltése…</p>}
    {capture.report.error && <p role="alert" className="form-error">{capture.report.error.message}<Button type="button" className="text-button" onClick={() => void capture.report.refetch()}>Újra</Button></p>}
    {capture.report.data && (capture.report.data.mode === 'Monthly' || capture.report.data.submittedAt ? <p className="field-hint">
      {capture.report.data.submittedAt ? 'Ezt a hónapot már lezártad. A magánhasználatot a havi elszámolás javításával módosíthatod.' : 'Havi összesítőt választottál. A teljes és a magánkilométert a havi elszámolásban add meg.'}
      {onMonthly && <Button type="button" className="text-button" onClick={onMonthly}>Havi elszámolás</Button>}
    </p> : <>
      <label className="checkbox-label"><input type="checkbox" checked={capture.include} onChange={e => capture.setInclude(e.target.checked)} />Km és magánhasználat elszámolása · {capture.month.slice(0, 7)}</label>
      {capture.active && <div className="org-form-grid">
        <label className="org-field"><span>Elszámolandó megtett út (km)</span><input type="number" inputMode="numeric" min="0" max="100000000" step="1" value={capture.total} onChange={e => capture.setTotal(e.target.value)} required /></label>
        <label className="org-field"><span>Ebből magánhasználat (km)</span><input type="number" inputMode="numeric" min="0" max={Number(capture.total)} step="1" value={capture.personal} onChange={e => capture.setPersonal(e.target.value)} required /></label>
      </div>}
      {capture.active && <p className="field-hint">Csak az adott hónap még el nem számolt útjait add meg. A hónaphatáron átívelő utat a havi elszámolásban bonthatod szét.</p>}
    </>)}
  </div>
}
