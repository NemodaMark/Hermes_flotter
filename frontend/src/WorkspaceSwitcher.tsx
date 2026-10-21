import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, X } from 'lucide-react'
import { Button } from './ui/Button'
import './workspace-switcher.css'

export function WorkspaceSwitcher({ company, site, disabled, children }: {
  company: string
  site?: string
  disabled: boolean
  children: ReactNode
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [requestedOpen, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const open = requestedOpen && !disabled
  const location = [company, site].filter(Boolean).join(' / ')

  function close() { setOpen(false); trigger.current?.focus() }

  useLayoutEffect(() => {
    if (!open) return
    const element = panel.current!
    const place = () => {
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth
      const rect = trigger.current!.getBoundingClientRect()
      const width = Math.min(360, viewportWidth - 24)
      const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - element.offsetHeight - 12))
      setPosition({ width, left: Math.max(12, Math.min(rect.left, viewportWidth - width - 12)), top, maxHeight: window.innerHeight - 24 })
    }
    try { element.showPopover?.() } catch { /* Fixed positioning also supports browsers without popovers. */ }
    place()
    element.querySelector<HTMLElement>('[role=combobox]')?.focus()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent | FocusEvent) => {
      const target = event.target as Node
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside) }
  }, [open])

  return <>
    <span className="workspace-caption">Munkaterület</span>
    <Button ref={trigger} type="button" className="workspace-trigger" aria-label={`Munkaterület váltása: ${location}`}
      title={location} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => setOpen(value => !value)}>
      <span className="workspace-location"><span>{company}</span>{site && <><span className="workspace-separator" aria-hidden="true">/</span><span>{site}</span></>}</span>
      <ChevronDown size={15} aria-hidden="true" />
    </Button>
    {open && createPortal(<div ref={panel} id={id} className="workspace-panel" popover="manual" data-choice-root
      role="dialog" aria-labelledby={`${id}-heading`} style={{ ...position, display: 'block' }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}>
      <div className="workspace-panel-heading"><h2 id={`${id}-heading`}>Munkaterület váltása</h2>
        <Button type="button" className="icon-button" aria-label="Munkaterület-választó bezárása" onClick={close}><X size={18} /></Button>
      </div>
      <div className="workspace-panel-fields">{children}</div>
      <div className="workspace-panel-actions"><Button type="button" variant="default" size="sm" onClick={close}>Kész</Button></div>
    </div>, document.body)}
  </>
}
