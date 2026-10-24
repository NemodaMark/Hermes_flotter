import { afterEach, beforeEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Existing feature-flow tests explicitly begin in the fleet workspace. Dashboard
// and sign-in tests select their own URL to exercise the new landing behavior.
beforeEach(() => { window.history.replaceState(null, '', '/#/vehicles') })
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})
// Query-backed screens can spend more than a second in their loading state on busy Windows/CI workers.
configure({ asyncUtilTimeout: 3000 })
