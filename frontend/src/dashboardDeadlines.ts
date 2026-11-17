import type { DashboardCar } from './dashboardApi'

export type DashboardDeadline = {
  kind: 'inspection' | 'insurance' | 'service' | 'service-km' | 'appointment'
  label: string
  date: string | null
  days: number | null
  distance: number | null
  car: DashboardCar
}

export function dashboardDeadlines(cars: DashboardCar[], today: string): DashboardDeadline[] {
  const now = Date.parse(today)
  return cars.filter(car => car.vehicle.status !== 'Archived').flatMap(car => {
    const entries: { kind: DashboardDeadline['kind']; label: string; date: string | null }[] = [
      { kind: 'inspection', label: 'Műszaki vizsga', date: car.inspectionDueDate },
      { kind: 'insurance', label: 'Biztosítás', date: car.insuranceDueDate },
      { kind: 'service', label: 'Következő szerviz', date: car.nextServiceDate },
      { kind: 'appointment', label: 'Szervizidőpont', date: car.serviceAppointmentAt?.slice(0, 10) ?? null },
    ]
    const deadlines: DashboardDeadline[] = entries.flatMap(entry => {
      if (!entry.date) return []
      const days = (Date.parse(entry.date) - now) / 86_400_000
      return days <= 30 ? [{ ...entry, days, distance: null, car }] : []
    })
    const distance = car.nextServiceKm != null && car.vehicle.odometerKm != null ? car.nextServiceKm - car.vehicle.odometerKm : null
    if (distance !== null && distance <= 1000)
      deadlines.push({ kind: 'service-km', label: 'Szerviz kilométerhatára', date: null, days: null, distance, car })
    return deadlines
  }).sort((a, b) => {
    const urgency = (item: DashboardDeadline) => item.days ?? (item.distance! <= 0 ? 0 : 15)
    return urgency(a) - urgency(b)
  })
}

export function deadlineState(item: DashboardDeadline) {
  if (item.distance !== null) {
    if (item.distance < 0) return { tone: 'danger', label: `${(-item.distance).toLocaleString('hu-HU')} km túllépés` } as const
    if (item.distance === 0) return { tone: 'warning', label: 'Esedékes' } as const
    return { tone: 'warning', label: `${item.distance.toLocaleString('hu-HU')} km hátra` } as const
  }
  const days = item.days ?? 0
  if (days < 0) return { tone: 'danger', label: `${-days} napja lejárt` } as const
  if (days === 0) return { tone: 'warning', label: 'Ma esedékes' } as const
  return { tone: days <= 7 ? 'warning' : 'neutral', label: `${days} nap múlva` } as const
}
