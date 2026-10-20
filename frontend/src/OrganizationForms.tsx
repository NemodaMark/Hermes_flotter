import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { AccessDialog } from './AccessDialog'
import { blankAddress, companyStatusName, organizationApi } from './organizationApi'
import type {
  Address,
  CompanyDetails,
  CompanyInput,
  Contact,
  ContactInput,
  Site,
  SiteInput,
} from './organizationApi'

export function TextField({
  label,
  value,
  onChange,
  required = false,
  maxLength = 200,
  type = 'text',
  disabled = false,
}: {
  label: string
  value: string | null
  onChange: (value: string) => void
  required?: boolean
  maxLength?: number
  type?: string
  disabled?: boolean
}) {
  return (
    <label className="org-field">
      <span>{label}</span>
      <input
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        type={type}
        disabled={disabled}
      />
    </label>
  )
}
export function AddressFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Address
  onChange: (address: Address) => void
  disabled?: boolean
}) {
  const field = (key: keyof Address, label: string, maxLength = 200, required = false) => (
    <TextField
      key={key}
      label={label}
      value={value[key]}
      maxLength={maxLength}
      required={required}
      disabled={disabled}
      onChange={(text) => onChange({ ...value, [key]: text })}
    />
  )
  return (
    <div className="org-form-grid">
      {field('countryCode', 'Országkód', 2, true)}
      {field('postalCode', 'Irányítószám', 20)}
      {field('city', 'Település', 120)}
      {field('addressLine1', 'Utca, házszám')}
      {field('addressLine2', 'Címkiegészítés')}
    </div>
  )
}
export function MetadataLine({
  version,
  updatedAt,
  updatedBy,
}: {
  version: number
  updatedAt: string | null
  updatedBy: string | null
}) {
  return (
    <p className="org-metadata">
      {version}. adatverzió
      {updatedAt
        ? ` · Módosította: ${updatedBy ?? '–'} · ${new Date(updatedAt).toLocaleString('hu-HU')}`
        : ''}
    </p>
  )
}
export function CompanyForm({
  company,
  tenantId,
  canEdit,
  onSaved,
  onReload,
}: {
  company: CompanyDetails
  tenantId: string
  canEdit: boolean
  onSaved: () => Promise<void>
  onReload: () => void
}) {
  const [data, setData] = useState(company.data)
  const [saved, setSaved] = useState(false)
  const save = useMutation({ mutationFn: () => organizationApi.saveCompany(tenantId, data) })
  const editable = canEdit && company.status === 'Active'
  const text = (
    key: Exclude<keyof CompanyInput, 'address' | 'version'>,
    label: string,
    maxLength = 200,
    type = 'text',
    required = false,
  ) => (
    <TextField
      key={key}
      label={label}
      value={data[key]}
      maxLength={maxLength}
      type={type}
      required={required}
      disabled={!editable || save.isPending}
      onChange={(value) => {
        setSaved(false)
        setData({ ...data, [key]: value })
      }}
    />
  )
  return (
    <form
      className="org-form"
      aria-label="Cég törzsadatai"
      onSubmit={(e) => {
        e.preventDefault()
        void save
          .mutateAsync()
          .then(async () => {
            setSaved(true)
            await onSaved()
          })
          .catch(() => {})
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend>Alapadatok</legend>
        <div className="org-form-grid">
          {text('name', 'Megjelenített cégnév', 160, 'text', true)}
          {text('legalName', 'Hivatalos cégnév')}
          {text('taxNumber', 'Adószám', 40)}
          {text('registrationNumber', 'Cégjegyzékszám', 40)}
          {text('euVatNumber', 'Közösségi adószám', 40)}
        </div>
      </fieldset>
      <fieldset>
        <legend>Székhely</legend>
        <AddressFields
          value={data.address}
          disabled={!editable || save.isPending}
          onChange={(address) => {
            setSaved(false)
            setData({ ...data, address })
          }}
        />
      </fieldset>
      <fieldset>
        <legend>Elérhetőségek</legend>
        <div className="org-form-grid">
          {text('email', 'Központi e-mail', 254, 'email')}
          {text('phone', 'Központi telefonszám', 40, 'tel')}
          {text('website', 'Weboldal', 2048, 'url')}
        </div>
      </fieldset>
      <fieldset>
        <legend>Alapbeállítások</legend>
        <div className="org-form-grid">
          {text('timeZone', 'Időzóna', 80, 'text', true)}
          {text('currency', 'Pénznem', 3, 'text', true)}
          <label className="org-field">
            <span>Távolságegység</span>
            <select
              value={data.distanceUnit}
              disabled={!editable || save.isPending}
              onChange={(e) => setData({ ...data, distanceUnit: e.target.value })}
            >
              <option value="km">Kilométer (km)</option>
              <option value="mi">Mérföld (mi)</option>
            </select>
          </label>
        </div>
      </fieldset>
      {save.isError && (
        <p className="notice error" role="alert">
          {save.error.message}{' '}
          <button type="button" className="text-button" onClick={onReload}>
            Friss adatok betöltése
          </button>
        </p>
      )}
      {saved && (
        <p role="status" className="notice success">
          Cégadatok mentve és naplózva.
        </p>
      )}
      <div className="org-form-footer">
        <MetadataLine
          version={company.data.version}
          updatedAt={company.updatedAt}
          updatedBy={company.updatedBy}
        />
        {editable && (
          <button className="primary-button" disabled={save.isPending}>
            {save.isPending ? 'Mentés…' : 'Cégadatok mentése'}
          </button>
        )}
      </div>
      <p className="org-metadata">
        Létrehozta: {company.createdBy ?? 'Korábbi adat, a létrehozó nem ismert'}
        {company.createdAt ? ` · ${new Date(company.createdAt).toLocaleString('hu-HU')}` : ''}
      </p>
    </form>
  )
}

export function ContactDialog({
  tenantId,
  contact,
  onClose,
  onSaved,
}: {
  tenantId: string
  contact: Contact | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [data, setData] = useState<ContactInput>(
    contact?.data ?? { name: '', position: '', email: '', phone: '', version: 0 },
  )
  const save = useMutation({
    mutationFn: () => organizationApi.saveContact(tenantId, contact?.id ?? null, data),
  })
  return (
    <AccessDialog
      title={contact ? 'Kapcsolattartó szerkesztése' : 'Új kapcsolattartó'}
      pending={save.isPending}
      onClose={onClose}
    >
      <form
        className="org-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save
            .mutateAsync()
            .then(async () => {
              onClose()
              await onSaved()
            })
            .catch(() => {})
        }}
      >
        <div className="org-form-grid">
          <TextField
            label="Név"
            value={data.name}
            onChange={(name) => setData({ ...data, name })}
            required
            maxLength={120}
          />
          <TextField
            label="Beosztás"
            value={data.position}
            onChange={(position) => setData({ ...data, position })}
            maxLength={80}
          />
          <TextField
            label="E-mail-cím"
            value={data.email}
            onChange={(email) => setData({ ...data, email })}
            maxLength={254}
            type="email"
          />
          <TextField
            label="Telefonszám"
            value={data.phone}
            onChange={(phone) => setData({ ...data, phone })}
            maxLength={40}
            type="tel"
          />
        </div>
        {save.isError && (
          <p role="alert" className="notice error">
            {save.error.message}
          </p>
        )}
        <DialogActions pending={save.isPending} onClose={onClose} />
      </form>
    </AccessDialog>
  )
}
export function SiteDialog({
  tenantId,
  site,
  contacts,
  onClose,
  onSaved,
}: {
  tenantId: string
  site: Site | null
  contacts: Contact[]
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [data, setData] = useState<SiteInput>(
    site?.data ?? {
      name: '',
      code: '',
      address: blankAddress(),
      email: '',
      phone: '',
      contactId: null,
      version: 0,
    },
  )
  const save = useMutation({
    mutationFn: () => organizationApi.saveSite(tenantId, site?.id ?? null, data),
  })
  return (
    <AccessDialog
      title={site ? 'Telephely szerkesztése' : 'Új telephely'}
      pending={save.isPending}
      onClose={onClose}
    >
      <form
        className="org-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save
            .mutateAsync()
            .then(async () => {
              onClose()
              await onSaved()
            })
            .catch(() => {})
        }}
      >
        <div className="org-form-grid">
          <TextField
            label="Telephely neve"
            value={data.name}
            onChange={(name) => setData({ ...data, name })}
            required
            maxLength={120}
          />
          <TextField
            label="Telephelykód"
            value={data.code}
            onChange={(code) => setData({ ...data, code })}
            required
            maxLength={32}
          />
        </div>
        <fieldset>
          <legend>Cím</legend>
          <AddressFields
            value={data.address}
            onChange={(address) => setData({ ...data, address })}
          />
        </fieldset>
        <div className="org-form-grid">
          <TextField
            label="Telephely e-mail-címe"
            value={data.email}
            onChange={(email) => setData({ ...data, email })}
            maxLength={254}
            type="email"
          />
          <TextField
            label="Telephely telefonszáma"
            value={data.phone}
            onChange={(phone) => setData({ ...data, phone })}
            maxLength={40}
            type="tel"
          />
          <label className="org-field">
            <span>Kapcsolattartó</span>
            <select
              value={data.contactId ?? ''}
              onChange={(e) => setData({ ...data, contactId: e.target.value || null })}
            >
              <option value="">Nincs kijelölve</option>
              {contacts
                .filter((x) => !x.isArchived || x.id === data.contactId)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.data.name}
                    {x.isArchived ? ' (archivált)' : ''}
                  </option>
                ))}
              {data.contactId && !contacts.some((x) => x.id === data.contactId) && (
                <option value={data.contactId}>
                  {site?.contactName ?? 'Jelenlegi kapcsolattartó'}
                </option>
              )}
            </select>
          </label>
        </div>
        <p className="field-hint">
          A telephelykód cégen belül egyedi; archiválás után is foglalt marad.
        </p>
        {save.isError && (
          <p role="alert" className="notice error">
            {save.error.message}
          </p>
        )}
        <DialogActions pending={save.isPending} onClose={onClose} />
      </form>
    </AccessDialog>
  )
}
export function DialogActions({
  pending,
  onClose,
  label = 'Mentés',
  submitDisabled = false,
}: {
  pending: boolean
  onClose: () => void
  label?: string
  submitDisabled?: boolean
}) {
  return (
    <div className="dialog-actions">
      <button type="button" className="secondary-button" onClick={onClose} disabled={pending}>
        Mégse
      </button>
      <button className="primary-button" disabled={pending || submitDisabled}>
        {pending ? 'Mentés…' : label}
      </button>
    </div>
  )
}
export function StatusDialog({
  title,
  currentStatus,
  onClose,
  onSave,
}: {
  title: string
  currentStatus?: string
  onClose: () => void
  onSave: (reason: string, status: string) => Promise<unknown>
}) {
  const [reason, setReason] = useState('')
  const [status, setStatus] = useState(currentStatus ?? '')
  const save = useMutation({ mutationFn: () => onSave(reason, status) })
  return (
    <AccessDialog title={title} pending={save.isPending} onClose={onClose}>
      <form
        className="org-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save
            .mutateAsync()
            .then(onClose)
            .catch(() => {})
        }}
      >
        {currentStatus && (
          <label className="org-field">
            <span>Új állapot</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {['Active', 'Suspended', 'Archived'].map((x) => (
                <option key={x} value={x}>
                  {companyStatusName(x)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="org-field">
          <span>Indoklás</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            maxLength={500}
            rows={3}
          />
        </label>
        {currentStatus && status !== 'Active' && (
          <p className="field-hint">
            A cég flottaműveletei leállnak. Az adatok megmaradnak, az állapot később
            visszaállítható.
          </p>
        )}
        {save.isError && (
          <p role="alert" className="notice error">
            {save.error.message}
          </p>
        )}
        <DialogActions
          pending={save.isPending}
          submitDisabled={!!currentStatus && currentStatus === status}
          onClose={onClose}
          label="Állapot módosítása"
        />
      </form>
    </AccessDialog>
  )
}
