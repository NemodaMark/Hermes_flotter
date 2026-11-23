import { expect, it } from 'vitest'
import { arrangeDashboard } from './dashboardPlacement'
import { makeTile, readDashboardLayout } from './dashboardModules'

it('preserves an explicit gap above and beside an anchored tile after reload', () => {
  const tile = { ...makeTile('note', 'center'), position: { column: 3, row: 12 }, mobileRow: 5 }
  const key = 'test:dashboard-position'
  localStorage.setItem(key, JSON.stringify([tile]))
  try {
    const restored = readDashboardLayout(key)!
    expect(arrangeDashboard(restored, new Map(), false).positions.get(tile.id)).toMatchObject({ column: 3, row: 12 })
    expect(arrangeDashboard(restored, new Map(), true).positions.get(tile.id)).toMatchObject({ column: 0, row: 5, columns: 1 })
  } finally {
    localStorage.removeItem(key)
  }
})

it('places legacy modules in order without overlapping a taller neighbor', () => {
  const tiles = ['first', 'second', 'third'].map(id => makeTile('note', id))
  const heights = new Map([['first', 160], ['second', 80]])
  const { positions } = arrangeDashboard(tiles, heights, false)
  expect(positions.get('first')).toMatchObject({ column: 0, row: 0 })
  expect(positions.get('second')).toMatchObject({ column: 6, row: 0 })
  expect(positions.get('third')).toMatchObject({ column: 0, row: 11 })
})

it('resolves height changes only for tiles in the occupied columns', () => {
  const tiles = [
    { ...makeTile('note', 'top'), position: { column: 0, row: 0 } },
    { ...makeTile('note', 'lower'), position: { column: 0, row: 10 } },
    { ...makeTile('note', 'beside'), position: { column: 6, row: 10 } },
  ]
  const { positions } = arrangeDashboard(tiles, new Map([['top', 240]]), false)
  expect(positions.get('lower')).toMatchObject({ column: 0, row: 16 })
  expect(positions.get('beside')).toMatchObject({ column: 6, row: 10 })
})
