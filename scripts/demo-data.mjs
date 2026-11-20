// Fictional local demo data. Addresses and contacts do not identify real people.
export const companyName = 'Demo Flotta'
export const demoNote = 'HERMES mintaadat – fiktív, helyi bemutatóadat.'
export const address = (city, postalCode, number = 1) => ({ countryCode: 'HU', postalCode, city, addressLine1: `Minta utca ${number}.`, addressLine2: null })
export const sites = [
  { name: 'Budapest – Központ', code: 'DEMO-BP', city: 'Budapest', postalCode: '1117', contact: 'Nagy Anna' },
  { name: 'Debrecen – Keleti telephely', code: 'DEMO-DEB', city: 'Debrecen', postalCode: '4030', contact: 'Szabó Dávid' },
  { name: 'Győr – Nyugati telephely', code: 'DEMO-GYR', city: 'Győr', postalCode: '9027', contact: 'Varga Eszter' },
]
export const partners = [
  { name: 'Demo Lízing', isLessor: true, isService: false, city: 'Budapest', postalCode: '1117' },
  { name: 'Demo Autóbérlet', isLessor: true, isService: false, city: 'Győr', postalCode: '9027' },
  { name: 'Demo Központi Szerviz', isLessor: false, isService: true, city: 'Budapest', postalCode: '1117' },
  { name: 'Demo Keleti Szerviz', isLessor: false, isService: true, city: 'Debrecen', postalCode: '4030' },
  { name: 'Demo Nyugati Szerviz', isLessor: false, isService: true, city: 'Győr', postalCode: '9027' },
]
const read = ['vehicles.read', 'sites.read']
const km = [...read, 'vehicles.odometer.create', 'vehicles.fuel.read', 'vehicles.fuel.manage', 'mileage.record', 'vehicles.bookings.read', 'vehicles.bookings.create']
const service = [...km, 'vehicles.service.read', 'vehicles.service.manage']
export const groups = [
  { key: 'fleet', name: 'Demo – Flottakezelők', permissions: [...km, 'mileage.manage', 'vehicles.bookings.manage', 'vehicles.overview.read', 'vehicles.create', 'vehicles.update', 'vehicles.users.assign', 'vehicles.archive', 'vehicles.leasing.read', 'vehicles.leasing.manage', 'vehicles.service.read', 'vehicles.service.manage', 'vehicles.documents.read', 'vehicles.documents.manage', 'partners.read', 'partners.create', 'partners.update', 'partners.archive', 'members.read', 'companies.read', 'companies.update', 'sites.create', 'sites.update', 'sites.vehicles.assign', 'audit.read'] },
  { key: 'dispatch', name: 'Demo – Diszpécserek', permissions: [...km, 'vehicles.update', 'vehicles.users.assign', 'sites.vehicles.assign', 'members.read'] },
  { key: 'service-bp', name: 'Demo – Budapesti szerviz', permissions: service, site: 0 },
  { key: 'service-deb', name: 'Demo – Debreceni szerviz', permissions: service, site: 1 },
  ...sites.map((site, index) => ({ key: `km-${index}`, name: `Demo – Km-rögzítők (${site.city})`, permissions: km, site: index })),
  { key: 'reader', name: 'Demo – Flotta megtekintése', permissions: [...read, 'vehicles.service.read', 'vehicles.leasing.read', 'vehicles.documents.read', 'companies.read', 'partners.read'] },
]
export const people = [
  { userName: 'demo.nagy.anna', displayName: 'Nagy Anna', group: 'fleet' },
  { userName: 'demo.kovacs.bence', displayName: 'Kovács Bence', group: 'dispatch' },
  { userName: 'demo.toth.csilla', displayName: 'Tóth Csilla', group: 'service-bp' },
  { userName: 'demo.szabo.david', displayName: 'Szabó Dávid', group: 'service-deb' },
  { userName: 'demo.varga.eszter', displayName: 'Varga Eszter', group: 'km-2' },
  { userName: 'demo.kiss.ferenc', displayName: 'Kiss Ferenc', group: 'km-0' },
  { userName: 'demo.molnar.gabor', displayName: 'Molnár Gábor', group: 'km-1' },
  { userName: 'demo.nemeth.hanna', displayName: 'Németh Hanna', group: 'km-2' },
  { userName: 'demo.farkas.imre', displayName: 'Farkas Imre', group: 'reader' },
  { userName: 'demo.balogh.julia', displayName: 'Balogh Júlia', group: 'km-0', suspended: true },
].map(person => ({ ...person, email: `${person.userName}@example.test` }))

export function day(base, offset = 0) {
  const date = new Date(`${base}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}
export function vehicles(base) {
  const models = [
    ['Škoda', 'Octavia', 'PassengerCar', 'Estate', 'Diesel', 110, 1968],
    ['Toyota', 'Corolla', 'PassengerCar', 'Sedan', 'Hybrid', 103, 1798],
    ['Ford', 'Transit', 'Van', 'Van', 'Diesel', 96, 1995],
    ['Volkswagen', 'Golf', 'PassengerCar', 'Hatchback', 'Petrol', 110, 1498],
    ['Renault', 'Master', 'Van', 'Box', 'Diesel', 110, 2299],
    ['Hyundai', 'Kona Electric', 'PassengerCar', 'Suv', 'Electric', 150, null],
    ['Mercedes-Benz', 'Sprinter', 'Van', 'Van', 'Diesel', 125, 1950],
    ['Kia', 'Ceed', 'PassengerCar', 'Estate', 'Petrol', 118, 1482],
    ['Peugeot', 'Partner', 'Van', 'Van', 'Diesel', 75, 1499],
    ['Dacia', 'Duster', 'PassengerCar', 'Suv', 'Petrol', 96, 1332],
  ]
  return Array.from({ length: 30 }, (_, index) => {
    const [make, model, category, bodyType, fuelType, powerKw, engineCapacityCc] = models[index % models.length]
    const number = String(index + 1).padStart(3, '0')
    const kilometers = 18000 + index * 5700
    return {
      registration: `DEMO-${number}`, make, model, site: index < 28 ? index % 3 : null,
      status: index % 10 === 0 ? 'Maintenance' : index % 10 === 9 ? 'Inactive' : 'Active', odometerKm: kilometers,
      data: {
        registrationCountry: 'HU', vin: `ZZZDEM${String(index + 1).padStart(11, '0')}`, fleetNumber: `DEMO-${number}`,
        category, bodyType, year: Number(day(base, -800 - index * 30).slice(0, 4)),
        firstRegistration: day(base, -800 - index * 30), color: ['Fehér', 'Ezüst', 'Kék', 'Szürke'][index % 4],
        fuelType, powerKw, engineCapacityCc, transmission: fuelType === 'Hybrid' || fuelType === 'Electric' ? 'Automatic' : 'Manual',
        seats: category === 'Van' ? 3 : 5, grossWeightKg: category === 'Van' ? 3500 : 2100,
        payloadKg: category === 'Van' ? 1100 : 500, cargoVolumeM3: category === 'Van' ? 11 : null,
        batteryKwh: fuelType === 'Electric' ? 64 : null,
        ownership: ['Owned', 'Leased', 'Leased', 'Rented', 'Owned'][index % 5],
        fleetEntryDate: day(base, -650), fleetExitDate: null,
        inspectionDueDate: day(base, [-10, 15, 90, 180, 365][index % 5]),
        insuranceDueDate: day(base, [20, 60, 120, 240][index % 4]),
        nextServiceDate: day(base, [-5, 7, 30, 60, 90][index % 5]), nextServiceKm: kilometers + (index % 5 === 0 ? -500 : 10000),
        notes: demoNote,
      },
    }
  })
}
