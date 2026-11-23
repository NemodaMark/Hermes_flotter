import { dashboardSize } from './dashboardModules'
import type { DashboardPosition, DashboardTile } from './dashboardModules'

export type DashboardCell = DashboardPosition & { columns: number; rows: number }

export function tileRows(height: number) {
  return Math.ceil(height / dashboardSize.rowStep) + 1
}

export function intersectingCells(cell: DashboardCell, board: Iterable<DashboardCell>) {
  return Array.from(board).filter(other => cell.column < other.column + other.columns && cell.column + cell.columns > other.column
    && cell.row < other.row + other.rows && cell.row + cell.rows > other.row)
}

export function arrangeDashboard(tiles: DashboardTile[], heights: ReadonlyMap<string, number>, compact: boolean) {
  const columns = compact ? 1 : dashboardSize.columns
  const positions = new Map<string, DashboardCell>()
  const contentOrder = (a: DashboardTile, b: DashboardTile) => (a.position?.row ?? Infinity) - (b.position?.row ?? Infinity)
    || (a.position?.column ?? 0) - (b.position?.column ?? 0)
  const preferred = (tile: DashboardTile) => compact
    ? tile.mobileRow === undefined ? undefined : { column: 0, row: tile.mobileRow }
    : tile.position
  const size = (tile: DashboardTile) => ({ columns: compact ? 1 : tile.columns,
    rows: tileRows(heights.get(tile.id) ?? tile.height ?? (tile.kind === 'metrics' ? 112 : 224)) })

  let bottom = 0
  const anchored = tiles.filter(tile => preferred(tile)).sort((a, b) => preferred(a)!.row - preferred(b)!.row || contentOrder(a, b))
  for (const tile of anchored) {
    const origin = preferred(tile)!
    const dimensions = size(tile)
    const cell = { ...origin, ...dimensions, column: Math.min(origin.column, columns - dimensions.columns) }
    // Auto-height content can grow after a refresh. Move only panels it would cover.
    for (let hits = intersectingCells(cell, positions.values()); hits.length; hits = intersectingCells(cell, positions.values())) {
      cell.row = Math.max(...hits.map(hit => hit.row + hit.rows))
    }
    positions.set(tile.id, cell)
    bottom = Math.max(bottom, cell.row + cell.rows)
  }

  let column = 0, row = bottom
  for (const tile of tiles.filter(tile => !preferred(tile)).sort(contentOrder)) {
    const dimensions = size(tile)
    if (column + dimensions.columns > columns) { column = 0; row = bottom }
    positions.set(tile.id, { column, row, ...dimensions })
    column += dimensions.columns
    bottom = Math.max(bottom, row + dimensions.rows)
  }
  return { columns, positions, height: Math.max(0, bottom - 1) * dashboardSize.rowStep }
}
