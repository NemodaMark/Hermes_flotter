import { Button } from './ui/Button'
import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function AccessDialog({
  title,
  pending,
  onClose,
  children,
  className = '',
}: {
  title: string
  pending: boolean
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current!
    if (!element.open) element.showModal()
    element.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => element.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      className={`access-dialog ${className}`.trim()}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onClose()
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <Button
          type="button"
          className="icon-button"
          aria-label="Bezárás"
          disabled={pending}
          onClick={onClose}
        >
          <X size={20} />
        </Button>
      </div>
      {children}
    </dialog>
  )
}
