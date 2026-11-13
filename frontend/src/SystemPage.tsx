import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { UserPlus } from 'lucide-react'
import { api } from './api'
import type { Session, RegisterInput } from './api'
import { AccessDialog } from './AccessDialog'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { QueryMessage } from './FleetFields'
import { PageButtons } from './CompaniesPage'
import { TableFrame } from './ui/Table'
import './members.css'

export function SystemPage({ user }: { user: Session }) {
  const [page, setPage] = useState(1)
  const [createOpen, setCreateOpen] = useState(false)
  const [created, setCreated] = useState<string>()
  const audit = useQuery({ queryKey: ['system-audit', user.id, page], queryFn: ({ signal }) => api.systemAudit(page, signal), retry: false })
  return <section className="access-panel" aria-label="Rendszerkezelés">
    <div className="org-section-tools"><h2>Módosítási napló</h2>
      <Button variant="default" iconLeft={<UserPlus size={18} />} onClick={() => setCreateOpen(true)}>Új felhasználó</Button>
    </div>
    {created && <p className="notice" role="status">{created}</p>}
    {createOpen && <CreateAccount onClose={() => setCreateOpen(false)} onCreated={setCreated} />}
    <QueryMessage pending={audit.isPending} error={audit.error} retry={() => void audit.refetch()} />
    {audit.data && <>
      <TableFrame hasRows={audit.data.items.length > 0}>
        <table className="audit-table responsive-list">
          <thead><tr><th>Időpont</th><th>Módosító</th><th>Művelet</th><th>Részletek</th></tr></thead>
          <tbody>
            {audit.data.items.map(entry => <tr key={entry.id}>
              <td><time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString('hu-HU')}</time></td>
              <td data-label="Módosító">{entry.actorSubject}</td>
              <td data-label="Művelet">{entry.action}{entry.targetSubject && <span className="member-email">{entry.targetSubject}</span>}</td>
              <td data-label="Részletek"><details><summary>Részletek</summary><pre>{JSON.stringify(JSON.parse(entry.details), null, 2)}</pre></details></td>
            </tr>)}
            {!audit.data.items.length && <tr><td colSpan={4} className="table-empty">Még nincs naplóbejegyzés.</td></tr>}
          </tbody>
        </table>
      </TableFrame>
      <PageButtons page={page} total={audit.data.total} pending={audit.isFetching} onPage={setPage} />
    </>}
  </section>
}

function CreateAccount({ onClose, onCreated }: { onClose: () => void; onCreated: (message: string) => void }) {
  const client = useQueryClient()
  const [method, setMethod] = useState('password')
  const options = useQuery({ queryKey: ['account-options'], queryFn: api.accountOptions, retry: false })
  const create = useMutation({
    mutationFn: api.register,
    onSuccess: result => {
      onCreated(result.requiresEmailConfirmation
        ? `A(z) ${result.id} fiók elkészült. Az első belépéshez e-mail-megerősítés szükséges.`
        : `A(z) ${result.id} fiók elkészült.`)
      void client.invalidateQueries({ queryKey: ['system-audit'] })
      void client.invalidateQueries({ queryKey: ['people-list'] })
      onClose()
    },
  })
  const entra = method === 'entra'
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body: RegisterInput = {
      userName: String(form.get('userName')).trim(),
      displayName: String(form.get('displayName')).trim(),
      email: String(form.get('email')).trim(),
      ...(entra ? { entraObjectId: String(form.get('entraObjectId')).trim() } : { password: String(form.get('password')) }),
    }
    create.mutate(body)
  }
  return <AccessDialog title="Új felhasználó" onClose={onClose} pending={create.isPending}>
    <form className="account-form" onSubmit={submit}>
      <label htmlFor="new-account-name">Teljes név</label>
      <input id="new-account-name" name="displayName" autoFocus required maxLength={120} />
      <label htmlFor="new-account-username">Felhasználónév</label>
      <input id="new-account-username" name="userName" required minLength={3} maxLength={64} autoComplete="off" />
      <label htmlFor="new-account-email">E-mail-cím</label>
      <input id="new-account-email" type="email" name="email" required maxLength={254} />
      {options.data?.entraEnabled && <label>Belépés módja
        <Select value={method} onChange={event => setMethod(event.target.value)}>
          <option value="password">HERMES-jelszó</option>
          <option value="entra">Microsoft Entra ID</option>
        </Select>
      </label>}
      {entra ? <>
        <label htmlFor="new-account-entra">Felhasználói Object ID az Entrából</label>
        <input id="new-account-entra" name="entraObjectId" required minLength={36} maxLength={36} />
      </> : <>
        <label htmlFor="new-account-password">Jelszó</label>
        <input id="new-account-password" type="password" name="password" required minLength={12} maxLength={128} autoComplete="new-password" />
      </>}
      {create.error && <p className="form-error" role="alert">{create.error.message}</p>}
      <div className="dialog-actions"><Button variant="default" loading={create.isPending}>Fiók létrehozása</Button></div>
    </form>
  </AccessDialog>
}
