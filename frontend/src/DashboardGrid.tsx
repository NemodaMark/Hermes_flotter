import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChartColumn, ChartPie, ChartScatter, Grip, MoveDiagonal, Settings2, Trash2 } from 'lucide-react'
import { dashboardModules, dashboardSize, makeTile } from './dashboardModules'
import type { DashboardPosition, DashboardTile, ModuleKind } from './dashboardModules'
import { arrangeDashboard, intersectingCells, tileRows } from './dashboardPlacement'
import type { DashboardCell } from './dashboardPlacement'
import { Button } from './ui/Button'

export type DashboardDrop = { position: DashboardPosition; settled: ReadonlyMap<string, DashboardPosition> }
export type DashboardDrag = { kind: ModuleKind } | { id: string }

type TileSize = Pick<DashboardTile, 'columns' | 'height'>
type PointerStart = { pointerId: number; x: number; y: number }
type DragSource = { source: DashboardDrag; label: string }
type Gesture = PointerStart & (
  | (DragSource & { moved: boolean; grabX?: number; grabY?: number })
  | { id: string; size: TileSize; height: number; columnWidth: number; maxColumns: number }
)

type Editor = {
  catalogue: ModuleKind[] | null
  onChoose: (kind: ModuleKind) => void
  onDrop: (source: DashboardDrag, target: DashboardDrop) => void
  onResize: (id: string, size: TileSize) => void
  onSettings: (tile: DashboardTile) => void
  onRemove: (id: string) => void
}

const chartIcons = { bar: ChartColumn, pie: ChartPie, scatter: ChartScatter }

function bounded(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function resizeTo(gesture: Extract<Gesture, { size: TileSize }>, x: number, y: number): TileSize {
  const columns = gesture.columnWidth ? Math.round((x - gesture.x) / gesture.columnWidth) : 0
  const rows = Math.round((y - gesture.y) / dashboardSize.heightStep)
  return {
    columns: bounded(gesture.size.columns + columns, dashboardSize.minColumns, gesture.maxColumns),
    height: rows ? bounded(gesture.height + rows * dashboardSize.heightStep, dashboardSize.minHeight, dashboardSize.maxHeight) : gesture.size.height,
  }
}

export function DashboardGrid({ tiles, compact, editor, paletteId, children }: {
  tiles: DashboardTile[]; compact: boolean; editor?: Editor; paletteId: string; children: (tile: DashboardTile) => ReactNode
}) {
  const grid = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const preventClick = useRef(false)
  const [drag, setDrag] = useState<{ label: string; x: number; y: number; target: DashboardCell | null; blocked: boolean } | null>(null)
  const [resize, setResize] = useState<{ id: string; size: TileSize } | null>(null)
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map())
  const [canvasHeight, setCanvasHeight] = useState(320)
  const editing = !!editor
  const paletteOpen = !!editor?.catalogue
  const layout = arrangeDashboard(resize ? tiles.map(tile => tile.id === resize.id ? { ...tile, ...resize.size } : tile) : tiles, heights, compact)

  useLayoutEffect(() => {
    const area = grid.current!
    const measure = () => {
      const measured = new Map(Array.from(area.querySelectorAll<HTMLElement>('[data-dashboard-tile]'), tile =>
        [tile.dataset.dashboardTile!, tile.offsetHeight] as const).filter(([, height]) => height > 0))
      setHeights(previous => previous.size === measured.size && [...measured].every(([id, height]) => previous.get(id) === height) ? previous : measured)
      if (editing) setCanvasHeight(Math.max(240, innerHeight - (area.getBoundingClientRect().top + scrollY) - 40))
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    area.querySelectorAll('[data-dashboard-tile]').forEach(tile => observer?.observe(tile))
    if (area.parentElement) observer?.observe(area.parentElement)
    window.addEventListener('resize', measure)
    let active = true
    queueMicrotask(() => { if (active) measure() })
    return () => { active = false; observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [tiles, compact, editing, paletteOpen])

  function columnStep(area: HTMLDivElement) {
    const gap = parseFloat(getComputedStyle(area).columnGap) || 0
    return { gap, step: (area.clientWidth + gap) / layout.columns }
  }

  function dropAt(current: Extract<Gesture, DragSource>, x: number, y: number): DashboardCell | null {
    const area = grid.current
    if (!area?.contains(document.elementFromPoint(x, y))) return null
    const bounds = area.getBoundingClientRect()
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return null
    const { step, gap } = columnStep(area)
    const size = 'id' in current.source ? layout.positions.get(current.source.id)
      : { columns: makeTile(current.source.kind, '').columns, rows: tileRows(current.source.kind === 'note' ? 192 : 224) }
    if (!size || !step) return null
    const grabX = current.grabX ?? (size.columns * step - gap) / 2
    return {
      columns: size.columns, rows: size.rows,
      column: bounded(Math.round((x - bounds.left - grabX) / step), 0, layout.columns - size.columns),
      row: bounded(Math.round((y - bounds.top - (current.grabY ?? 0)) / dashboardSize.rowStep), 0, dashboardSize.maxRow),
    }
  }

  function occupied(cell: DashboardCell, source: DashboardDrag) {
    const others = [...layout.positions].filter(([id]) => !('id' in source) || id !== source.id).map(([, item]) => item)
    return intersectingCells(cell, others).length > 0
  }

  function place(source: DashboardDrag, cell: DashboardCell) {
    editor?.onDrop(source, { position: { column: cell.column, row: cell.row }, settled: layout.positions })
  }

  function nudge(id: string, column: number, row: number) {
    const origin = layout.positions.get(id)
    if (!origin) return
    const source = { id }
    const target = { ...origin, column: origin.column + column, row: origin.row + row }
    while (target.column >= 0 && target.column + target.columns <= layout.columns && target.row >= 0 && target.row <= dashboardSize.maxRow) {
      if (!occupied(target, source)) { place(source, target); return }
      target.column += column
      target.row += row
    }
  }

  function begin(event: PointerEvent<HTMLButtonElement>, details: DragSource | DashboardTile) {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return
    preventClick.current = false
    if (typeof event.currentTarget.setPointerCapture !== 'function') return
    const start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    if ('source' in details) {
      const rect = event.currentTarget.closest('[data-dashboard-tile]')?.getBoundingClientRect()
      gesture.current = { ...start, ...details, moved: false, grabX: rect ? start.x - rect.left : undefined, grabY: rect ? start.y - rect.top : undefined }
    } else {
      const element = grid.current!
      const body = event.currentTarget.closest('[data-dashboard-tile]')?.querySelector<HTMLElement>('.custom-tile-body')
      const position = layout.positions.get(details.id)!
      gesture.current = { ...start, id: details.id, size: { columns: details.columns, height: details.height },
        height: body?.offsetHeight ?? dashboardSize.minHeight,
        columnWidth: columnStep(element).step, maxColumns: dashboardSize.columns - position.column }
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    const { clientX: x, clientY: y } = event
    if ('size' in current) {
      preventClick.current ||= Math.hypot(x - current.x, y - current.y) >= 5
      if (!preventClick.current) return
      setResize({ id: current.id, size: resizeTo(current, x, y) })
      return
    }
    current.moved ||= Math.hypot(x - current.x, y - current.y) >= 5
    if (!current.moved) return
    preventClick.current = true
    if (y > innerHeight - 44) window.scrollBy(0, 18)
    if (y < 44) window.scrollBy(0, -18)
    const target = dropAt(current, x, y)
    setDrag({ label: current.label, x, y, target, blocked: !!target && occupied(target, current.source) })
  }

  function cancel(event: PointerEvent<HTMLButtonElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return
    gesture.current = null
    setDrag(null)
    setResize(null)
  }

  function finish(event: PointerEvent<HTMLButtonElement>) {
    const current = gesture.current
    if (!current || current.pointerId !== event.pointerId) return
    if ('size' in current) {
      const size = resizeTo(current, event.clientX, event.clientY)
      if (size.columns !== current.size.columns || size.height !== current.size.height) editor?.onResize(current.id, size)
    } else if (current.moved) {
      const target = dropAt(current, event.clientX, event.clientY)
      if (target && !occupied(target, current.source)) place(current.source, target)
    }
    cancel(event)
  }

  const pointerHandlers = { onPointerMove: move, onPointerUp: finish, onPointerCancel: cancel, onLostPointerCapture: cancel }
  const cellStyle = (cell: DashboardCell) => ({ '--tile-column': cell.column, '--render-columns': cell.columns,
    '--tile-top': `${cell.row * dashboardSize.rowStep}px` })
  const ordered = [...layout.positions].sort(([, a], [, b]) => a.row - b.row || a.column - b.column)
  const boardStyle = { '--dashboard-columns': layout.columns, '--dashboard-row-step': `${dashboardSize.rowStep}px`,
    '--dashboard-height': `${editing ? Math.max(canvasHeight, layout.height + 192) : layout.height}px` } as CSSProperties
  return <>
    {editor?.catalogue && <section id={paletteId} className="custom-module-palette" aria-label="Elérhető modulok">
      {editor.catalogue.map(kind => {
        const Icon = chartIcons[kind as keyof typeof chartIcons] ?? Grip
        return <Button key={kind} type="button" variant="outline" className="custom-module-choice" {...pointerHandlers}
        onPointerDown={event => begin(event, { source: { kind }, label: dashboardModules[kind] })}
        onClick={event => { if (!event.detail || !preventClick.current) editor.onChoose(kind) }}>
          <Icon size={20} aria-hidden="true" /><span>{dashboardModules[kind]}</span>
        </Button>
      })}
    </section>}
    <div ref={grid} className="custom-dashboard-grid" role="region" aria-label="Áttekintő moduljai" style={boardStyle}
      data-editing={editing || undefined} data-grid-visible={editing && (paletteOpen || !!drag || !tiles.length) || undefined}>
      {editing && !tiles.length && !drag && <p className="custom-dashboard-drop">Húzd ide a modult</p>}
      {ordered.map(([id, position]) => {
        const tile = tiles.find(tile => tile.id === id)!
        const title = tile.kind === 'note' && tile.title.trim() ? tile.title : dashboardModules[tile.kind]
        const size = resize?.id === tile.id ? resize.size : tile
        const style = { ...cellStyle(position), '--tile-columns': size.columns, '--tile-height': size.height === null ? undefined : `${size.height}px` } as CSSProperties
        return <article key={tile.id} className="custom-dashboard-tile" data-dashboard-tile={tile.id}
          style={style} data-editing={editor ? '' : undefined} aria-label={title}>
          {editor && <div className="custom-tile-controls">
            <Button type="button" className="icon-button custom-tile-grip" aria-label={`${title} mozgatása húzással vagy nyilakkal`}
              {...pointerHandlers} onPointerDown={event => begin(event, { source: { id: tile.id }, label: title })} title="Mozgatás húzással vagy nyilakkal"
              onKeyDown={event => {
                const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
                const direction = directions[event.key]
                if (direction) { event.preventDefault(); nudge(tile.id, ...direction) }
              }}><Grip size={18} /></Button>
            <span className="custom-tile-edit-label" title={title}>{title}</span>
            <Button type="button" className="icon-button" aria-label={`${title} felfelé`} disabled={position.row === 0}
              onClick={() => nudge(tile.id, 0, -1)}><ArrowUp size={16} /></Button>
            <Button type="button" className="icon-button" aria-label={`${title} lefelé`}
              onClick={() => nudge(tile.id, 0, 1)}><ArrowDown size={16} /></Button>
            <Button type="button" className="icon-button" aria-label={`${title} beállításai`} onClick={() => editor.onSettings(tile)}><Settings2 size={16} /></Button>
            <Button type="button" className="icon-button" aria-label={`${title} eltávolítása`} onClick={() => editor.onRemove(tile.id)}><Trash2 size={16} /></Button>
          </div>}
          <div className="custom-tile-body" data-sized={size.height !== null}
            tabIndex={size.height === null ? undefined : 0} role={size.height === null ? undefined : 'region'}
            aria-label={size.height === null ? undefined : `${title} tartalma`}>{children(tile)}</div>
          {editor && <Button type="button" className="icon-button custom-tile-resize" aria-label={`${title} átméretezése`}
            {...pointerHandlers} onPointerDown={event => begin(event, tile)}
            title="Átméretezés húzással" onClick={event => { if (!event.detail || !preventClick.current) editor.onSettings(tile) }}><MoveDiagonal size={17} /></Button>}
        </article>
      })}
      {drag?.target && <div className="custom-dashboard-target" aria-hidden="true" data-blocked={drag.blocked}
        style={{ ...cellStyle(drag.target), '--target-height': `${(drag.target.rows - 1) * dashboardSize.rowStep}px` } as CSSProperties} />}
    </div>
    {drag && <div className="custom-drag-preview" aria-hidden="true"
      style={{ left: Math.min(drag.x + 12, innerWidth - 180), top: Math.min(drag.y + 12, innerHeight - 46) }}>{drag.label}</div>}
  </>
}
