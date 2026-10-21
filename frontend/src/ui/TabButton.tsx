// Adapted from Sera UI's VerticalTabs (MIT). See THIRD_PARTY_NOTICES.md.
import { Button } from './Button'
import type { ButtonProps } from './Button'

// The form owns its panels so switching sections never unmounts draft fields.
// Keep the existing roving focus and invalid-field reveal in FieldSections.
export function TabButton({ className = '', children, ...props }: ButtonProps) {
  return <Button type="button" {...props} className={`sera-tab ${className}`.trim()}>
    {children}
  </Button>
}
