import type { ReactNode } from 'react'
import './list-layout.css'

export function ListToolbar({ label, children, actions, glass }: { label: string; children?: ReactNode; actions?: ReactNode; glass?: boolean }) {
  return <div className={glass ? 'list-toolbar glass-surface' : 'list-toolbar'} role="group" aria-label={label}>
    {children && <div className="list-toolbar-main">{children}</div>}
    {actions && <div className="list-toolbar-actions">{actions}</div>}
  </div>
}
