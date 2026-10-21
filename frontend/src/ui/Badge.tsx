// Adapted from Sera UI's Badge (MIT). See THIRD_PARTY_NOTICES.md.
import type { HTMLAttributes } from 'react'

type Tone = 'success' | 'warning' | 'neutral' | 'danger'
export function Badge({ tone = 'neutral', dot = true, className = '', children, ...props }:
  HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return <span {...props} className={`sera-badge ${className}`.trim()} data-tone={tone}>
    {dot && <span className="sera-badge-dot" aria-hidden="true" />}{children}
  </span>
}
