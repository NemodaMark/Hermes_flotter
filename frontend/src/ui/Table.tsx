import { useLayoutEffect, useRef, useState } from 'react'
import type { HTMLAttributes, ReactNode } from 'react'

export function ClickableRow({ onOpen, children, ...props }: HTMLAttributes<HTMLTableRowElement> & { onOpen: () => void }) {
  return <tr {...props} className={`clickable-row ${props.className ?? ''}`.trim()} tabIndex={0}
    onClick={event => {
      if ((event.target as HTMLElement).closest('button, a, input, select, label, dialog, [role=option], [role=combobox]')) return
      // Selecting text in a row must not navigate away.
      if (window.getSelection()?.toString()) return
      onOpen()
    }} onKeyDown={event => {
      if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onOpen() }
    }}>{children}</tr>
}

export function TableFrame({ hasRows, children }: { hasRows: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(118)
  useLayoutEffect(() => {
    if (!hasRows || !ref.current) return
    const measure = () => { const value = ref.current!.getBoundingClientRect().height; if (value > 0) setHeight(value) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [hasRows, children])
  return <div ref={ref} className="table-scroll stable-table" style={hasRows ? undefined : { minHeight: height }}>{children}</div>
}
