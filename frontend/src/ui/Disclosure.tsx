import { useEffect, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'

export function Disclosure({ className, summaryClassName, label, trigger, children, detailsRef }: {
  className: string; summaryClassName?: string; label?: string; trigger: ReactNode; children: ReactNode; detailsRef?: RefObject<HTMLDetailsElement | null>
}) {
  const local = useRef<HTMLDetailsElement>(null)
  const root = detailsRef ?? local
  const close = (restoreFocus = false) => {
    if (!root.current) return
    root.current.open = false
    if (restoreFocus) root.current.querySelector('summary')?.focus()
  }
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const details = root.current
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [root])
  return <details className={className} ref={root}
    onClick={event => {
      if (event.target instanceof Element && event.target.closest('button, a[href]')) close(true)
    }}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close() }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !event.currentTarget.open) return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }}>
    <summary className={summaryClassName} aria-label={label}>{trigger}</summary>
    {children}
  </details>
}
