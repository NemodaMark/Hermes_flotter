import type { AccountToken } from './api'

export type AccountLink = { kind: 'confirm' | 'reset'; token: AccountToken | null }

export function readAccountLink(): AccountLink | null {
  const [path, query] = window.location.hash.slice(1).split('?')
  if (path !== '/account/confirm' && path !== '/account/reset') return null
  const params = new URLSearchParams(query)
  const userId = params.get('userId') ?? ''
  const email = params.get('email') ?? ''
  const token = params.get('token') ?? ''
  return { kind: path === '/account/confirm' ? 'confirm' : 'reset',
    token: userId.length <= 64 && userId && email && token.length <= 4096 && /^[\w-]+$/.test(token) ? { userId, email, token } : null }
}

export function clearAccountToken() {
  // The token is held only in component memory. Remove it from the address bar/history.
  window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
}
