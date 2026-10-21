import { TabButton } from './ui/TabButton'
import { useEffect, useId, useRef, useState } from 'react'
import type { InvalidEvent, ReactNode } from 'react'

import './field-sections.css'

export type FieldSection = { id: string; label: string; content: ReactNode }

export function FieldSections({ sections, label }: { sections: FieldSection[]; label: string }) {
  const id = useId()
  const [active, setActive] = useState(sections[0].id)
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
    const panel = first?.closest<HTMLElement>('[data-field-section]')
    const section = panel?.dataset.fieldSection
    if (first && panel?.hidden && section) {
      // Reveal the first invalid field before the browser tries to focus a hidden panel.
      event.preventDefault()
      revealingInvalid.current = true
      setActive(section)
      pendingInvalid.current = first
    }
  }

  return <div className="field-sections" ref={root} onInvalidCapture={revealInvalid}>
    <div className="field-tabs" role="tablist" aria-label={label} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const index = sections.findIndex(section => section.id === active)
      const next = event.key === 'Home' ? sections[0] : event.key === 'End' ? sections[sections.length - 1]
        : sections[(index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : sections.length - 1)) % sections.length]
      setActive(next.id)
      root.current?.querySelector<HTMLButtonElement>(`[data-section-tab="${next.id}"]`)?.focus()
    }}>
      {sections.map(section => <TabButton key={section.id} type="button" role="tab" id={`${id}-${section.id}-tab`} data-section-tab={section.id}
        aria-selected={active === section.id} aria-controls={`${id}-${section.id}`} tabIndex={active === section.id ? 0 : -1}
        onClick={() => setActive(section.id)}>{section.label}</TabButton>)}
    </div>
    <label className="org-field field-picker"><span>Mezőcsoport</span><select value={active} onChange={event => setActive(event.target.value)}>
      {sections.map(section => <option key={section.id} value={section.id}>{section.label}</option>)}
    </select></label>
    <div className="field-panels">
      {sections.map(section => <div key={section.id} role="tabpanel" id={`${id}-${section.id}`} data-field-section={section.id}
        aria-labelledby={`${id}-${section.id}-tab`} hidden={active !== section.id} tabIndex={0}>{section.content}</div>)}
    </div>
  </div>
}
