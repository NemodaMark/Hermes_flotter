import type { InvitationAcceptance } from './api'

// Fragments stay in the browser; the invitation secret is not sent in HTTP URLs or referrers.
export function invitationUrl(acceptance: InvitationAcceptance) {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin)
  url.hash = new URLSearchParams({ invite: '1', ...acceptance }).toString()
  return url.toString()
}

export function readInvitation(): { request: InvitationAcceptance | null } | null {
  const params = new URLSearchParams(window.location.hash.slice(1))
  if (!params.has('invite')) return null
  const tenantId = params.get('tenantId') ?? ''
  const invitationId = params.get('invitationId') ?? ''
  const token = params.get('token') ?? ''
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  return {
    request:
      uuid.test(tenantId) && uuid.test(invitationId) && /^[\w-]{43}$/.test(token)
        ? { tenantId, invitationId, token }
        : null,
  }
}

export function clearInvitation() {
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  )
}
