import type { ReactNode } from 'react'
import { LiquidGlass } from './ui/LiquidGlass'
import './list-layout.css'

export function ListToolbar({ label, children, actions, glass = false }: { label: string; children?: ReactNode; actions?: ReactNode; glass?: boolean }) {
  return <LiquidGlass className="list-toolbar" enabled={glass} role="group" aria-label={label}>
    {children && <div className="list-toolbar-main">{children}</div>}
    {actions && <div className="list-toolbar-actions">{actions}</div>}
  </LiquidGlass>
}
