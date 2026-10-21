import { afterEach } from 'vitest'
import { cleanup, configure } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})
// Query-backed screens can spend more than a second in their loading state on busy Windows/CI workers.
configure({ asyncUtilTimeout: 3000 })
