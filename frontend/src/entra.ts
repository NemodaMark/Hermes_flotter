import { request } from './api'

const returnKey = 'hermes.entra.return-fragment'
const callbackMessages = {
  failed: 'A Microsoft-művelet nem sikerült. Próbáld újra a megfelelő munkahelyi fiókkal.',
  unlinked: 'Először lépj be a HERMES-fiókodba, majd a saját profilodban kapcsold össze a Microsoft-fiókodat.',
  connected: 'A Microsoft-fiókod össze van kapcsolva.',
}

export async function startEntra(intent: 'login' | 'connect', password?: string) {
  const { url } = await request<{ url: string }>(`/api/v1/auth/entra/${intent}`, {
    method: 'POST', body: intent === 'connect' ? { password } : undefined,
  })
  const destination = new URL(url)
  if (destination.origin !== 'https://login.microsoftonline.com')
    throw new Error('A Microsoft bejelentkezési címe érvénytelen.')
  sessionStorage.setItem(returnKey, window.location.hash)
  window.location.assign(destination)
}

export function consumeEntraResult() {
  const url = new URL(window.location.href)
  const result = url.searchParams.get('entra')
  if (result !== 'failed' && result !== 'unlinked' && result !== 'connected' && result !== 'signed-in') return null
  const hash = sessionStorage.getItem(returnKey)
  sessionStorage.removeItem(returnKey)
  if (hash?.startsWith('#')) url.hash = hash
  url.searchParams.delete('entra')
  window.history.replaceState(window.history.state, '', url)
  return result === 'signed-in' ? null : { message: callbackMessages[result], error: result !== 'connected' }
}
