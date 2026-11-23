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
  dismissOnBackdrop = false,
}: {
  title: string
  pending: boolean
  onClose: () => void
  children: ReactNode
  className?: string
  dismissOnBackdrop?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current!
    const opener = document.activeElement
    if (!element.open) element.showModal()
    element.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => {
      element.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <dialog
      ref={dialog}
      className={`access-dialog ${className}`.trim()}
      aria-labelledby={titleId}
      onClick={event => {
        if (!dismissOnBackdrop || pending || event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      }}
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
