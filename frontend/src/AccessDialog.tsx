import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

export function AccessDialog({
  title,
  pending,
  onClose,
  children,
}: {
  title: string
  pending: boolean
  onClose: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    if (!element.open) element.showModal()
    element.querySelector<HTMLElement>('[data-autofocus]')?.focus()
    return () => element.close()
  }, [])
  return (
    <dialog
      ref={dialog}
      className="access-dialog"
      aria-labelledby="access-dialog-title"
      onCancel={(event) => {
        event.preventDefault()
        if (!pending) onClose()
      }}
    >
      <div className="dialog-heading">
        <h2 id="access-dialog-title">{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Bezárás"
          disabled={pending}
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  )
}
