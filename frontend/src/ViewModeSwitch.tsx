import { LayoutGrid, List } from 'lucide-react'
import { Button } from './ui/Button'
import './showcase.css'

export function ViewModeSwitch({ visual, onChange, label = 'Képes nézet' }: { visual: boolean; onChange: (value: boolean) => void; label?: string }) {
  return <div className="view-mode-switch" role="group" aria-label="Megjelenítés">
    <Button type="button" aria-pressed={!visual} onClick={() => onChange(false)}><List size={16} aria-hidden="true" />Lista</Button>
    <Button type="button" aria-pressed={visual} onClick={() => onChange(true)}><LayoutGrid size={16} aria-hidden="true" />{label}</Button>
  </div>
}
