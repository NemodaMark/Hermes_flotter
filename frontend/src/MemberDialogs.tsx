import { Button } from './ui/Button'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Check, Copy, LoaderCircle, Plus } from 'lucide-react'
import { api, ApiError } from './api'
import type { CreatedInvitation, Member, MemberAccess, Permission, Tenant } from './api'
import { AccessDialog } from './AccessDialog'
import { invitationUrl } from './invitationLink'

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'A művelet nem sikerült.'
const date = (value: string) =>
  new Date(value).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' })
const directGrantOptions = (tenant: Tenant) => tenant.permissions.filter((code) =>
  !tenant.permissionScopes || !(code.startsWith('vehicles.') || code.startsWith('sites.') || code === 'audit.read')
  || tenant.permissionScopes.some((scope) => scope.code === code && scope.allSites))

export function PermissionFields({
  catalog,
  selected,
  available,
  onChange,
  disabled,
}: {
  catalog: Permission[]
  selected: string[]
  available: string[]
  onChange: (codes: string[]) => void
  disabled: boolean
}) {
  return (
    <fieldset className="permission-fields" disabled={disabled}>
      <legend>Jogosultságok</legend>
      {catalog.map((permission) => (
        <label className="permission-option" key={permission.code}>
          <input
            type="checkbox"
            checked={selected.includes(permission.code)}
            disabled={!available.includes(permission.code)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, permission.code]
                  : selected.filter((code) => code !== permission.code),
              )
            }
          />
          <span>
            {permission.name}
            {!available.includes(permission.code) && <small>Ezt a jogot nem módosíthatod.</small>}
          </span>
        </label>
      ))}
    </fieldset>
  )
}

export function InvitationDialog({
  tenant,
  catalog,
  onClose,
  onChanged,
}: {
  tenant: Tenant
  catalog: Permission[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [permissions, setPermissions] = useState<string[]>([])
  const [created, setCreated] = useState<CreatedInvitation | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState(false)
  const mutation = useMutation({
    mutationFn: () => api.invite(tenant.id, email.trim(), permissions),
  })
  const canGrant = tenant.permissions.includes('permissions.manage')
  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      setCreated(await mutation.mutateAsync())
      mutation.reset()
      await onChanged()
    } catch {
      /* The mutation error is rendered below. */
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(invitationUrl(created!.acceptance))
      setCopied(true)
      setCopyError(false)
    } catch {
      setCopyError(true)
    }
  }
  return (
    <AccessDialog
      title={created ? 'Meghívó elkészült' : 'Felhasználó meghívása'}
      pending={mutation.isPending}
      onClose={onClose}
    >
      {created ? (
        <>
          <p className="access-description">
            <strong>{created.invitation.email}</strong> · {tenant.name}
          </p>
          <p className="access-description">
            {created.emailDelivery === 'sent'
              ? 'A meghívót e-mailben elküldtük. A hivatkozást innen is kimásolhatod.'
              : created.emailDelivery === 'saved'
                ? 'A helyi tesztlevél elkészült (.eml fájl). A hivatkozást innen is kimásolhatod.'
              : created.emailDelivery === 'failed'
                ? 'A meghívó elkészült, de a levélküldés sikertelen. Másold ki és továbbítsd a hivatkozást a címzettnek.'
                : 'A levélküldés nincs beállítva. Másold ki és továbbítsd a hivatkozást a címzettnek.'}
            {' '}A hivatkozás csak most másolható ki.
          </p>
          <label htmlFor="invitation-link">Meghívási hivatkozás</label>
          <input
            id="invitation-link"
            value={invitationUrl(created.acceptance)}
            readOnly
            onFocus={(event) => event.target.select()}
          />
          <p className="field-hint">
            Érvényes: {date(created.invitation.expiresAt)} · egyszer használható.
          </p>
          {copyError && (
            <p className="form-error" role="alert">
              A másolás nem sikerült. Jelöld ki és másold ki a hivatkozást a mezőből.
            </p>
          )}
          {copied && (
            <p className="access-success" role="status">
              Hivatkozás másolva.
            </p>
          )}
          <div className="dialog-actions">
            <Button className="secondary-button" onClick={onClose}>
              Bezárás
            </Button>
            <Button className="primary-button" onClick={() => void copy()}>
              <Copy size={16} />
              Hivatkozás másolása
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <p className="access-description">
            Cég: <strong>{tenant.name}</strong>
          </p>
          <label htmlFor="invite-email">E-mail-cím</label>
          <input
            id="invite-email"
            data-autofocus
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            disabled={mutation.isPending}
            onChange={(event) => setEmail(event.target.value)}
          />
          {canGrant ? (
            <PermissionFields
              catalog={catalog}
              selected={permissions}
              available={directGrantOptions(tenant)}
              onChange={setPermissions}
              disabled={mutation.isPending}
            />
          ) : (
            <p className="field-hint">
              Új tagot jogok nélkül hívhatsz meg. A jogokat egy jogosultságkezelő később oszthatja
              ki.
            </p>
          )}
          {mutation.isError && (
            <p className="form-error" role="alert">
              {message(mutation.error)}
            </p>
          )}
          <div className="dialog-actions">
            <Button
              type="button"
              className="secondary-button"
              disabled={mutation.isPending}
              onClick={onClose}
            >
              Mégse
            </Button>
            <Button className="primary-button" disabled={mutation.isPending}>
              {mutation.isPending ? (
                <LoaderCircle size={16} className="spinning" />
              ) : (
                <Plus size={16} />
              )}
              Meghívó létrehozása
            </Button>
          </div>
        </form>
      )}
    </AccessDialog>
  )
}

export function PermissionsDialog({
  tenant,
  member,
  catalog,
  onClose,
  onChanged,
}: {
  tenant: Tenant
  member: Member
  catalog: Permission[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [current, setCurrent] = useState<MemberAccess>({ ...member, tenantId: tenant.id })
  const [selected, setSelected] = useState(member.directPermissions ?? member.permissions)
  const mutation = useMutation({
    mutationFn: () => api.changePermissions(tenant.id, member.userId, selected, current.version),
  })
  const reload = useMutation({
    mutationFn: () => api.memberAccess(tenant.id, member.userId),
    onSuccess: (access) => {
      setCurrent(access)
      setSelected(access.directPermissions ?? access.permissions)
      mutation.reset()
    },
  })
  async function submit(event: FormEvent) {
    event.preventDefault()
    try {
      await mutation.mutateAsync()
      onClose()
      await onChanged()
    } catch {
      /* The mutation error is rendered below. */
    }
  }
  return (
    <AccessDialog
      title="Jogosultságok módosítása"
      pending={mutation.isPending || reload.isPending}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <p className="access-description">
          <strong>{member.displayName ?? member.email ?? member.userId}</strong>
          <br />
          {member.email} · {tenant.name}
        </p>
        <PermissionFields
          catalog={catalog}
          selected={selected}
            available={directGrantOptions(tenant)}
          onChange={setSelected}
          disabled={mutation.isPending || reload.isPending}
        />
        <p className="field-hint">
          Az itt megadott jogok egyedi jogok; a csoportból kapott jogok külön kezelhetők. Csak a
          saját jogaid körén belül módosíthatsz. A változás a következő kérésnél érvényesül.
        </p>
        {mutation.isError && (
          <p className="form-error" role="alert">
            {message(mutation.error)}
          </p>
        )}
        {mutation.error instanceof ApiError && mutation.error.code === 'stale_membership' && (
          <Button
            className="text-button"
            type="button"
            disabled={reload.isPending}
            onClick={() => reload.mutate()}
          >
            Friss adatok betöltése
          </Button>
        )}
        {reload.isError && (
          <p className="form-error" role="alert">
            {message(reload.error)}
          </p>
        )}
        <div className="dialog-actions">
          <Button
            type="button"
            className="secondary-button"
            disabled={mutation.isPending || reload.isPending}
            onClick={onClose}
          >
            Mégse
          </Button>
          <Button className="primary-button" disabled={mutation.isPending || reload.isPending}>
            {mutation.isPending ? (
              <LoaderCircle size={16} className="spinning" />
            ) : (
              <Check size={16} />
            )}
            Jogosultságok mentése
          </Button>
        </div>
      </form>
    </AccessDialog>
  )
}

export function StatusDialog({
  tenant,
  member,
  onClose,
  onChanged,
}: {
  tenant: Tenant
  member: Member
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const mutation = useMutation({
    mutationFn: () =>
      api.changeMemberStatus(tenant.id, member.userId, !member.isActive, member.version),
  })
  async function save() {
    try {
      await mutation.mutateAsync()
      onClose()
      await onChanged()
    } catch {
      /* The mutation error is rendered below. */
    }
  }
  return (
    <AccessDialog
      title={member.isActive ? 'Hozzáférés felfüggesztése' : 'Hozzáférés visszaállítása'}
      pending={mutation.isPending}
      onClose={onClose}
    >
      <p className="access-description">
        <strong>{member.displayName ?? member.email ?? member.userId}</strong>
        <br />
        {member.email} · {tenant.name}
      </p>
      <p className="access-description">
        {member.isActive
          ? 'A felhasználó ennél a cégnél nem fér hozzá az adatokhoz. Más céges hozzáférései megmaradnak.'
          : 'A felhasználó az ennél a cégnél kiosztott jogaival újra hozzáférhet az adatokhoz.'}
      </p>
      {mutation.isError && (
        <p className="form-error" role="alert">
          {message(mutation.error)}
        </p>
      )}
      {mutation.error instanceof ApiError && mutation.error.code === 'stale_membership' && (
        <Button
          className="text-button"
          disabled={mutation.isPending}
          onClick={() => {
            onClose()
            void onChanged()
          }}
        >
          Lista frissítése
        </Button>
      )}
      <div className="dialog-actions">
        <Button className="secondary-button" disabled={mutation.isPending} onClick={onClose}>
          Mégse
        </Button>
        <Button
          className={member.isActive ? 'danger-button' : 'primary-button'}
          disabled={mutation.isPending}
          onClick={() => void save()}
        >
          {mutation.isPending && <LoaderCircle size={16} className="spinning" />}
          {member.isActive ? 'Felfüggesztés' : 'Visszaállítás'}
        </Button>
      </div>
    </AccessDialog>
  )
}
