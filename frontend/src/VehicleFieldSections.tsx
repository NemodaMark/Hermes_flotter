import { useEffect, useId, useRef, useState } from 'react'
import type { InvalidEvent, ReactNode } from 'react'

const sections = [
  { id: 'basic', label: 'Alapadatok' },
  { id: 'technical', label: 'Műszaki adatok' },
  { id: 'operation', label: 'Üzemeltetés' },
  { id: 'deadlines', label: 'Határidők és szerviz' },
] as const

export type VehicleFieldSection = typeof sections[number]['id']

export function VehicleFieldSections({ children }: { children: Record<VehicleFieldSection, ReactNode> }) {
  const id = useId()
  const [active, setActive] = useState<VehicleFieldSection>('basic')
  const pendingInvalid = useRef<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null>(null)
  const revealingInvalid = useRef(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const field = pendingInvalid.current
    pendingInvalid.current = null
    if (!field) return
    // Finish the browser's whole validation pass before reporting the first field.
    const timer = window.setTimeout(() => {
      revealingInvalid.current = false
      field.focus()
      field.reportValidity()
    }, 0)
    return () => { window.clearTimeout(timer); revealingInvalid.current = false }
  }, [active])

  function revealInvalid(event: InvalidEvent<HTMLDivElement>) {
    if (revealingInvalid.current) { event.preventDefault(); return }
    const first = Array.from(root.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea') ?? []).find(field => field.willValidate && !field.validity.valid)
    const panel = first?.closest<HTMLElement>('[data-vehicle-section]')
    if (first && panel?.hidden) {
      // Reveal the first invalid field before the browser tries to focus a hidden panel.
      event.preventDefault()
      revealingInvalid.current = true
      setActive(panel.dataset.vehicleSection as VehicleFieldSection)
      pendingInvalid.current = first
    }
  }

  return <div className="vehicle-field-sections" ref={root} onInvalidCapture={revealInvalid}>
    <div className="vehicle-field-tabs" role="tablist" aria-label="Járműadatok mezőcsoportjai" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = sections.findIndex(section => section.id === active)
      const next = event.key === 'Home' ? sections[0] : event.key === 'End' ? sections[sections.length - 1]
        : sections[(index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : sections.length - 1)) % sections.length]
      setActive(next.id)
      root.current?.querySelector<HTMLButtonElement>(`[data-section-tab="${next.id}"]`)?.focus()
    }}>
      {sections.map(section => <button key={section.id} type="button" role="tab" id={`${id}-${section.id}-tab`} data-section-tab={section.id}
        aria-selected={active === section.id} aria-controls={`${id}-${section.id}`} tabIndex={active === section.id ? 0 : -1}
        onClick={() => setActive(section.id)}>{section.label}</button>)}
    </div>
    <label className="org-field vehicle-field-picker"><span>Mezőcsoport</span><select value={active} onChange={event => setActive(event.target.value as VehicleFieldSection)}>
      {sections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
    </select></label>
    <div className="vehicle-field-panels">
      {sections.map(section => <div key={section.id} role="tabpanel" id={`${id}-${section.id}`} data-vehicle-section={section.id}
        aria-labelledby={`${id}-${section.id}-tab`} hidden={active !== section.id} tabIndex={0}>{children[section.id]}</div>)}
    </div>
  </div>
}
