import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AccessDialog } from './AccessDialog'
import './navigation.css'

export function MainNavigation({ open, busy, onClose, children }: { open: boolean; busy: boolean; onClose: () => void; children: ReactNode }) {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1360px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1360px)')
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => { if (open && !mobile) onClose() }, [mobile, open, onClose])
  useEffect(() => {
    if (!mobile || !open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [mobile, open])
  const navigation = <nav id="main-navigation" aria-label="Fő navigáció" className={mobile ? 'is-open' : undefined}>{children}</nav>
  if (!mobile) return navigation
  return open ? <AccessDialog title="Menü" pending={busy} onClose={onClose} dismissOnBackdrop className="navigation-drawer">{navigation}</AccessDialog> : null
}
