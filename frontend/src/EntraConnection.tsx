import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { request } from './api'
import { startEntra } from './entra'
import { Button } from './ui/Button'
import { QueryMessage } from './FleetFields'

const path = '/api/v1/auth/entra/connection'

export function EntraConnection({ userId }: { userId: string }) {
  const client = useQueryClient()
  const [leaving, setLeaving] = useState(false)
  const key = ['entra-connection', userId]
  const connection = useQuery({ queryKey: key, queryFn: ({ signal }) => request<{ enabled: boolean; linked: boolean; canDisconnect: boolean }>(path, { signal }), retry: false })
  const connect = useMutation({ mutationFn: (password: string) => startEntra('connect', password), onSuccess: () => setLeaving(true) })
  const disconnect = useMutation({
    mutationFn: () => request<void>(path, { method: 'DELETE' }),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  })
  const error = connect.error ?? disconnect.error
  const pending = connect.isPending || disconnect.isPending || leaving

  return <section className="entra-connection" aria-labelledby="entra-connection-title">
    <h3 id="entra-connection-title">Microsoft-fiók</h3>
    <QueryMessage pending={connection.isPending} error={connection.error} retry={() => void connection.refetch()} />
    {connection.data && (connection.data.linked ? <>
      <p>A munkahelyi Microsoft-fiókod össze van kapcsolva.</p>
      {connection.data.canDisconnect && <Button variant="outline" disabled={pending} onClick={() => disconnect.mutate()}>Kapcsolat bontása</Button>}
    </> : connection.data.enabled ? <form className="account-form" onSubmit={event => {
      event.preventDefault()
      connect.mutate(String(new FormData(event.currentTarget).get('password')))
    }}>
      <p>Erősítsd meg a HERMES-jelszavadat, majd válaszd ki a munkahelyi Microsoft-fiókodat.</p>
      <label htmlFor="entra-password">HERMES-jelszó</label>
      <input id="entra-password" name="password" type="password" autoComplete="current-password" maxLength={128} required disabled={pending} />
      <Button variant="default" disabled={pending}>Microsoft-fiók összekapcsolása</Button>
    </form> : <p>A Microsoft-bejelentkezés ezen a kiszolgálón nincs bekapcsolva.</p>)}
    {error && <p className="form-error" role="alert">{error.message}</p>}
  </section>
}
