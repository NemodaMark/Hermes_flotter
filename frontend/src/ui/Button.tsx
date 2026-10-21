// Adapted from Sera UI's Button (MIT). See THIRD_PARTY_NOTICES.md.
import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  size?: 'default' | 'sm' | 'lg'
  loading?: boolean
  iconLeft?: ReactNode
  iconRight?: ReactNode
}

// Keep native submit semantics and existing feature classes during migration.
// CSS press feedback replaces the upstream ripple; no timers or motion runtime.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  className = '', variant, size, loading = false, disabled, children,
  iconLeft, iconRight, ...props
}, ref) {
  return <button {...props} ref={ref}
    className={`sera-button ${className}`.trim()}
    data-variant={variant}
    data-size={size}
    aria-busy={loading || props['aria-busy']}
    disabled={disabled || loading}>
    {loading ? <LoaderCircle size={16} className="spinning" aria-hidden="true" /> : iconLeft}
    {children}
    {!loading && iconRight}
  </button>
})
