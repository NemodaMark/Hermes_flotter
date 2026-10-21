import type { ReactNode } from 'react'
import './toggle.css'

export function Toggle({ children, checked, onChange, disabled = false }: {
  children: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean
}) {
  return <label className="toggle-control"><input type="checkbox" role="switch" checked={checked} disabled={disabled}
    onChange={event => onChange(event.target.checked)} /><span className="toggle-track" aria-hidden="true" /><span>{children}</span></label>
}
