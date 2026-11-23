import type { DashboardDeadline } from './dashboardDeadlines'

export const overviewModules = {
  metrics: 'Flotta állapota',
  mileage: 'Havi futásteljesítmény',
  ranking: 'Legtöbbet futott járművek',
  service: 'Szervizre váró járművek',
  deadlines: 'Határidők',
  sites: 'Járművek telephelyenként',
}

export const dashboardModules = {
  ...overviewModules,
  vehicles: 'Járműlista',
  settlement: 'Havi km-elszámolás',
  note: 'Jegyzet',
}

export type OverviewModule = keyof typeof overviewModules
export type ModuleKind = keyof typeof dashboardModules
export type DashboardTile = {
  id: string
  kind: ModuleKind
  wide: boolean
  site: string
  status: string
  search: string
  months: number
  limit: number
  deadlineType: DashboardDeadline['kind'] | 'all'
  deadlineTiming: 'all' | 'overdue' | 'upcoming'
  title: string
  note: string
}

export function makeTile(kind: ModuleKind, id: string): DashboardTile {
  return {
    id, kind, wide: kind === 'metrics' || kind === 'sites', site: 'workspace', status: 'all', search: '',
    months: 6, limit: kind === 'deadlines' ? 6 : 5, deadlineType: 'all', deadlineTiming: 'all', title: '', note: '',
  }
}

export function isOverviewModule(kind: ModuleKind): kind is OverviewModule {
  return Object.hasOwn(overviewModules, kind)
}

export function isDashboardLayout(value: unknown): value is DashboardTile[] {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  return value.every(tile => {
    if (!tile || typeof tile.id !== 'string' || ids.has(tile.id) || !Object.hasOwn(dashboardModules, tile.kind)) return false
    ids.add(tile.id)
    return typeof tile.wide === 'boolean'
      && ['site', 'status', 'search', 'deadlineType', 'deadlineTiming', 'title', 'note'].every(key => typeof tile[key] === 'string')
      && Number.isInteger(tile.months) && tile.months >= 1 && tile.months <= 12
      && Number.isInteger(tile.limit) && tile.limit >= 1 && tile.limit <= 100
  })
}
