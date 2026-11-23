import type { DashboardDeadline } from './dashboardDeadlines'
import { readPersonal } from './personalStorage'

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
export const dashboardSize = { columns: 12, minColumns: 3, minHeight: 64, maxHeight: 1200, heightStep: 16 }
export type DashboardTile = {
  id: string
  kind: ModuleKind
  columns: number
  height: number | null
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
    id, kind, columns: kind === 'metrics' || kind === 'sites' ? dashboardSize.columns : 6, height: null,
    site: 'workspace', status: 'all', search: '',
    months: 6, limit: kind === 'deadlines' ? 6 : 5, deadlineType: 'all', deadlineTiming: 'all', title: '', note: '',
  }
}

export function isOverviewModule(kind: ModuleKind): kind is OverviewModule {
  return Object.hasOwn(overviewModules, kind)
}

type StoredTile = DashboardTile | (Omit<DashboardTile, 'columns' | 'height'> & { wide: boolean })

function isDashboardLayout(value: unknown): value is StoredTile[] {
  if (!Array.isArray(value)) return false
  const ids = new Set<string>()
  return value.every(tile => {
    if (!tile || typeof tile.id !== 'string' || ids.has(tile.id) || !Object.hasOwn(dashboardModules, tile.kind)) return false
    ids.add(tile.id)
    const size = 'columns' in tile
      ? Number.isInteger(tile.columns) && tile.columns >= dashboardSize.minColumns && tile.columns <= dashboardSize.columns
        && (tile.height === null || (Number.isInteger(tile.height) && tile.height >= dashboardSize.minHeight && tile.height <= dashboardSize.maxHeight))
      : typeof tile.wide === 'boolean'
    return size
      && ['site', 'status', 'search', 'deadlineType', 'deadlineTiming', 'title', 'note'].every(key => typeof tile[key] === 'string')
      && Number.isInteger(tile.months) && tile.months >= 1 && tile.months <= 12
      && Number.isInteger(tile.limit) && tile.limit >= 1 && tile.limit <= 100
  })
}

export function readDashboardLayout(key: string) {
  return readPersonal(key, isDashboardLayout)?.map(tile => {
    if ('columns' in tile) return tile
    const { wide, ...rest } = tile
    return { ...rest, columns: wide ? dashboardSize.columns : 6, height: null }
  })
}
