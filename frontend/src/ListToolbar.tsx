import type { ReactNode } from 'react'
import './list-layout.css'

export function ListToolbar({ label, children, actions }: { label: string; children?: ReactNode; actions?: ReactNode }) {
  return <div className="list-toolbar" role="group" aria-label={label}>
    {children && <div className="list-toolbar-main">{children}</div>}
    {actions && <div className="list-toolbar-actions">{actions}</div>}
  </div>
}
