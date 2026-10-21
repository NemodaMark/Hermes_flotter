import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEventHandler, CSSProperties, ReactNode, SelectHTMLAttributes } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Button } from './Button'
import './select.css'

type Option = { value: string; label: string; disabled?: boolean }
function text(node: ReactNode): string {
  return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child)).join('')
}
function readOptions(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child)) return []
    return child.type === 'option' ? [{ value: String(child.props.value ?? text(child.props.children)), label: text(child.props.children), disabled: child.props.disabled }]
      : readOptions(child.props.children)
  })
}

function Choice({ options, value, onValue, label, id, disabled, required, invalid, errorId, maxLength, placeholder, creatable = false, className = '', native }:
  { options: Option[]; value: string; onValue: (value: string) => void; label?: string; id?: string; disabled?: boolean; required?: boolean; invalid?: boolean; errorId?: string; maxLength?: number; placeholder?: string; creatable?: boolean; className?: string; native?: ReactNode }) {
  const uid = useId(), inputId = id ?? `${uid}-input`, listId = `${uid}-list`
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), popup = useRef<HTMLDivElement>(null)
  const [requestedOpen, setOpen] = useState(false), [query, setQuery] = useState(''), [active, setActive] = useState(0)
  const open = requestedOpen && !disabled
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const [position, setPosition] = useState<CSSProperties>({}), [accessibleLabel, setAccessibleLabel] = useState(label)
  const selected = options.find(option => option.value === value)
  const filtered = options.filter(option => option.label.toLocaleLowerCase('hu').includes(query.toLocaleLowerCase('hu')))
  const enabled = filtered.filter(option => !option.disabled)
  const current = enabled[Math.min(active, Math.max(0, enabled.length - 1))]
  const display = creatable ? value : open ? query : selected?.label ?? value

  useLayoutEffect(() => {
    if (label) return
    const parent = root.current?.closest('label')
    setAccessibleLabel(parent?.querySelector('span')?.textContent ?? (parent?.firstChild?.nodeType === 3 ? parent.firstChild.textContent?.trim() : undefined) ?? 'Választás')
  }, [label])
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth
      const rect = root.current!.getBoundingClientRect(), width = Math.min(Math.max(rect.width, 220), viewportWidth - 24)
      const below = window.innerHeight - rect.bottom - 12, above = rect.top - 12
      const up = below < 220 && above > below, height = Math.min(320, Math.max(100, up ? above : below))
      setPosition({ width, left: Math.max(12, Math.min(rect.left, viewportWidth - width - 12)), maxHeight: height,
        ...(up ? { bottom: window.innerHeight - rect.top + 6, top: 'auto' } : { top: rect.bottom + 6, bottom: 'auto' }) })
    }
    place()
    try { popup.current?.showPopover?.() } catch { /* Older browsers use the fixed-position fallback. */ }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true) }
  }, [open])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent | FocusEvent) => {
      const target = event.target as Node
      if (!root.current?.contains(target) && !popup.current?.contains(target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside) }
  }, [open])
  useEffect(() => {
    popup.current?.querySelector('[data-active=true]')?.scrollIntoView?.({ block: 'nearest' })
  }, [active, query, open])
  function show() { if (!disabled && !input.current?.matches(':disabled')) { setPortalRoot(root.current?.closest<HTMLElement>('dialog, [data-choice-root]') ?? document.body); setQuery(''); setActive(Math.max(0, options.filter(x => !x.disabled).findIndex(x => x.value === value))); setOpen(true) } }
  function choose(option: Option) { if (input.current?.matches(':disabled')) return; onValue(option.value); setOpen(false); setQuery(''); input.current?.focus() }
  return <div className={`choice ${className}`} ref={root} data-open={open || undefined} data-disabled={disabled || undefined} data-invalid={invalid || undefined}>
    <input ref={input} id={inputId} role="combobox" aria-label={accessibleLabel} aria-autocomplete="list" aria-haspopup="listbox"
      aria-expanded={open} aria-required={required || undefined} aria-invalid={invalid || undefined} aria-describedby={errorId} aria-controls={open ? listId : undefined} aria-activedescendant={open && current ? `${uid}-${options.indexOf(current)}` : undefined}
      value={display} disabled={disabled} required={creatable && required} maxLength={maxLength} autoComplete="off"
      placeholder={open && !creatable ? 'Keresés…' : placeholder}
      onClick={() => { if (!open) show() }}
      onChange={event => { setPortalRoot(root.current?.closest<HTMLElement>('dialog, [data-choice-root]') ?? document.body); setQuery(event.target.value); setActive(0); setOpen(true); if (creatable) onValue(event.target.value) }}
      onKeyDown={event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); return }
        if (event.key === 'Tab') { setOpen(false); return }
        if (event.key === 'Enter' && open) { event.preventDefault(); if (current) choose(current); else if (creatable) setOpen(false); return }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && (!creatable || open || event.key.startsWith('Arrow'))) {
          event.preventDefault()
          if (!open) { show(); return }
          setActive(index => event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : enabled.length - 1)) % Math.max(1, enabled.length))
        }
      }} />
    <Button type="button" className="choice-arrow" aria-label={`${accessibleLabel ?? label ?? 'Választás'} lehetőségei`} tabIndex={-1} disabled={disabled}
      onMouseDown={event => event.preventDefault()} onClick={() => { input.current?.focus(); if (open) setOpen(false); else show() }}><ChevronDown size={16} aria-hidden="true" /></Button>
    {native}
    {open && portalRoot && createPortal(<div className="choice-popup" popover="manual" ref={popup} style={{ ...position, display: 'block' }}>
      {options.length > 8 && <div className="choice-search-hint"><Search size={14} aria-hidden="true" />Gépeléssel kereshetsz</div>}
      <div role="listbox" id={listId} aria-label={accessibleLabel}>
        {filtered.map(option => <div key={option.value} role="option" id={`${uid}-${options.indexOf(option)}`} aria-selected={option.value === value}
          aria-disabled={option.disabled || undefined} data-active={current === option} className="choice-option"
          onPointerDown={event => event.preventDefault()} onPointerMove={() => { if (!option.disabled) setActive(enabled.indexOf(option)) }}
          onClick={() => { if (!option.disabled) choose(option) }}>
          <span>{option.label}</span>{option.value === value && <Check size={16} aria-hidden="true" />}
        </div>)}
        {!filtered.length && <div className="choice-empty">{creatable ? value ? `Új érték: ${value}` : 'Nincs korábbi érték. Írj be újat.' : 'Nincs találat.'}</div>}
      </div>
    </div>, portalRoot)}
  </div>
}

export function Select({ children, value, onChange, disabled, required, id, className, 'aria-label': label, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const native = useRef<HTMLSelectElement>(null)
  const errorId = useId()
  const [wasInvalid, setInvalid] = useState(false)
  const invalid = wasInvalid && required && !value && !disabled
  const change = (next: string) => {
    const element = native.current!
    element.value = next
    element.dispatchEvent(new Event('change', { bubbles: true }))
  }
  return <><Choice options={readOptions(children)} value={String(value ?? '')} onValue={change} label={label} id={id}
    className={className} disabled={disabled} required={required} invalid={invalid} errorId={invalid ? errorId : undefined} native={<select {...props} ref={native} value={value} onChange={onChange as ChangeEventHandler<HTMLSelectElement>}
      required={required} disabled={disabled} className="choice-native" aria-hidden="true" tabIndex={-1}
      onFocus={event => event.currentTarget.parentElement?.querySelector('input')?.focus()}
      onInvalid={event => { if (!event.currentTarget.closest('[hidden]')) { event.preventDefault(); setInvalid(true); event.currentTarget.parentElement?.querySelector('input')?.focus() } }}>
      {children}
    </select>} />{invalid && <span className="choice-error" id={errorId} role="alert">Válassz egy értéket.</span>}</>
}

export function ComboBox({ label, value, options, onChange, disabled, required = true, maxLength = 64 }:
  { label: string; value: string; options: string[]; onChange: (value: string) => void; disabled: boolean; required?: boolean; maxLength?: number }) {
  return <Choice label={label} value={value} options={options.map(x => ({ value: x, label: x }))} onValue={onChange}
    disabled={disabled} required={required} maxLength={maxLength} creatable placeholder="Válassz vagy írj be új értéket" />
}
