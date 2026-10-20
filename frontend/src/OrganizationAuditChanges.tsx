import { categories, fuels, transmissions, ownerships, frequencies, leaseStatuses, vehicleStatuses } from './fleetApi'

const enumLabels: Record<string, string> = { ...categories, ...fuels, ...transmissions, ...ownerships, ...frequencies, ...leaseStatuses, ...vehicleStatuses, Suspended: 'Felfüggesztett' }
const labels: Record<string, string> = {
  filename: 'Fájlnév', bytelength: 'Fájlméret (bájt)', uploadedby: 'Feltöltő', uploadedat: 'Feltöltés időpontja',
  iswithdrawn: 'Visszavont', statuschangedby: 'Állapotmódosító',
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
  registrationcountry: 'Rendszám országkódja', vin: 'Alvázszám', fleetnumber: 'Flottaazonosító', category: 'Járműkategória',
  year: 'Gyártási év', firstregistration: 'Első forgalomba helyezés', color: 'Szín', fueltype: 'Üzemanyag / hajtás',
  powerkw: 'Teljesítmény (kW)', enginecapacitycc: 'Hengerűrtartalom (cm³)', transmission: 'Váltó', seats: 'Ülések',
  grossweightkg: 'Össztömeg (kg)', payloadkg: 'Teherbírás (kg)', cargovolumem3: 'Raktér (m³)', batterykwh: 'Akkumulátor (kWh)',
  ownership: 'Tulajdonlás', fleetentrydate: 'Flottába kerülés', fleetexitdate: 'Flottából kilépés',
  inspectionduedate: 'Műszaki vizsga lejárata', insuranceduedate: 'Biztosítás lejárata', nextservicedate: 'Következő szerviz dátuma', nextservicekm: 'Következő szerviz (km)',
  preferredservicepartnername: 'Szervizpartner', notes: 'Megjegyzés', odometerkm: 'Kilométerállás',
  islessor: 'Lízingbeadó', isservice: 'Szerviz', contacts: 'Kapcsolattartók', partnername: 'Partner', contractnumber: 'Szerződésszám',
  startdate: 'Szerződés kezdete', enddate: 'Szerződés vége', paymentamount: 'Lízingdíj', billingfrequency: 'Fizetési gyakoriság',
  annualkmlimit: 'Éves km-keret', totalkmlimit: 'Teljes km-keret', documenturl: 'Dokumentum webcíme',
  performedon: 'Szerviz dátuma', kilometers: 'Kilométerállás', description: 'Elvégzett munka', workordernumber: 'Munkalapszám',
  cost: 'Költség', isvoided: 'Érvénytelenített', voidreason: 'Érvénytelenítés indoka',
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
  } else if (prefix) result[prefix] = value
  return result
}
function display(value: unknown, key: string) {
  if (value === null || value === undefined || value === '') return '–'
  if (typeof value === 'boolean') return value ? 'Igen' : 'Nem'
  if (Array.isArray(value)) return value.map(x => x && typeof x === 'object' ? Object.entries(x).filter(([, v]) => v).map(([k, v]) => `${labels[k.toLowerCase()] ?? k}: ${v}`).join('; ') : String(x)).join(' | ') || '–'
  if (['category', 'fueltype', 'transmission', 'ownership', 'billingfrequency', 'status'].includes(key.split('.').at(-1)!) && enumLabels[String(value)]) return enumLabels[String(value)]
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
