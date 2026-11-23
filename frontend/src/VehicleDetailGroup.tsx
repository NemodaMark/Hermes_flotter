import { useState } from 'react'
import type { ReactNode } from 'react'

// Unlike a menu disclosure, a content section stays open while its forms are used.
// Mount its contents only when requested so closed sections make no API calls.
export function VehicleDetailGroup({ title, children, defaultOpen = false }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return <details className="vehicle-detail-group" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{title}</summary>{open && <div className="vehicle-detail-group-content">{children}</div>}
  </details>
}
