const labels: Record<string, string> = {
  name: 'Név',
  legalname: 'Hivatalos cégnév',
  taxnumber: 'Adószám',
  registrationnumber: 'Cégjegyzékszám',
  euvatnumber: 'Közösségi adószám',
  countrycode: 'Országkód',
  postalcode: 'Irányítószám',
  city: 'Település',
  addressline1: 'Utca, házszám',
  addressline2: 'Címkiegészítés',
  email: 'E-mail-cím',
  phone: 'Telefonszám',
  website: 'Weboldal',
  timezone: 'Időzóna',
  currency: 'Pénznem',
  distanceunit: 'Távolságegység',
  status: 'Állapot',
  statusreason: 'Indoklás',
  reason: 'Indoklás',
  statuschangedat: 'Állapotváltás időpontja',
  position: 'Beosztás',
  code: 'Telephelykód',
  contactname: 'Kapcsolattartó',
  isarchived: 'Archivált',
  archivedat: 'Archiválás időpontja',
  vehiclecount: 'Járművek száma',
  registration: 'Rendszám',
  make: 'Gyártó',
  model: 'Modell',
  sitename: 'Telephely',
}
function flatten(value: unknown, prefix = '', result: Record<string, unknown> = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase()
      flatten(
        child,
        ['data', 'company', 'profile'].includes(normalized)
          ? prefix
          : [prefix, normalized].filter(Boolean).join('.'),
        result,
      )
    }
  } else if (prefix && !Array.isArray(value)) result[prefix] = value
  return result
}
function display(value: unknown, key: string) {
  if (value === null || value === undefined || value === '') return '–'
  if (typeof value === 'boolean') return value ? 'Igen' : 'Nem'
  if (['Active', 'Suspended', 'Archived'].includes(String(value)))
    return (
      { Active: 'Aktív', Suspended: 'Felfüggesztett', Archived: 'Archivált' } as Record<
        string,
        string
      >
    )[String(value)]
  if (key.endsWith('at') && typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    return new Date(value).toLocaleString('hu-HU')
  return String(value)
}
export function OrganizationAuditChanges({ details }: { details: string }) {
  let parsed: { before?: unknown; after?: unknown }
  try {
    parsed = JSON.parse(details)
  } catch {
    return <p>A korábbi bejegyzés nem tartalmaz megjeleníthető részleteket.</p>
  }
  const before = flatten(parsed.before)
  const after = flatten(parsed.after)
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => {
    const leaf = key.split('.').at(-1)!
    return (
      leaf in labels &&
      before[key] !== after[key] &&
      !(leaf === 'reason' && 'statusreason' in after)
    )
  })
  return fields.length ? (
    <table className="org-change-table">
      <thead>
        <tr>
          <th>Adat</th>
          <th>Előtte</th>
          <th>Utána</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((key) => (
          <tr key={key}>
            <td>{labels[key.split('.').at(-1)!]}</td>
            <td>{display(before[key], key)}</td>
            <td>{display(after[key], key)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  ) : (
    <p>Ehhez a korábbi bejegyzéshez nincs részletes mezőváltozás.</p>
  )
}
