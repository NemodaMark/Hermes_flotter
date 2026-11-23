import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChartColumn, ChartPie, ChartScatter, Grip, MoveDiagonal, Settings2, Trash2 } from 'lucide-react'
import { dashboardModules, dashboardSize } from './dashboardModules'
import type { DashboardTile, ModuleKind } from './dashboardModules'
import { Button } from './ui/Button'

export type DashboardDrop = { id: string; after: boolean } | 'end'
export type DashboardDrag = { kind: ModuleKind } | { id: string }

type TileSize = Pick<DashboardTile, 'columns' | 'height'>
type PointerStart = { pointerId: number; x: number; y: number }
type DragSource = { source: DashboardDrag; label: string }
type Gesture = PointerStart & (
  | (DragSource & { moved: boolean })
  | { id: string; size: TileSize; height: number; columnWidth: number }
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
    columns: bounded(gesture.size.columns + columns, dashboardSize.minColumns, dashboardSize.columns),
    height: rows ? bounded(gesture.height + rows * dashboardSize.heightStep, dashboardSize.minHeight, dashboardSize.maxHeight) : gesture.size.height,
  }
}

export function DashboardGrid({ tiles, editor, paletteId, children }: {
  tiles: DashboardTile[]; editor?: Editor; paletteId: string; children: (tile: DashboardTile) => ReactNode
}) {
  const grid = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const preventClick = useRef(false)
  const [drag, setDrag] = useState<{ label: string; x: number; y: number; target: DashboardDrop | null } | null>(null)
  const [resize, setResize] = useState<{ id: string; size: TileSize } | null>(null)

  function dropAt(x: number, y: number): DashboardDrop | null {
    const area = grid.current
    const target = document.elementFromPoint(x, y)
    if (!area || !target || !area.contains(target)) return null
    const tile = target.closest<HTMLElement>('[data-dashboard-tile]')
    if (tile?.dataset.dashboardTile) {
      const rect = tile.getBoundingClientRect()
      const alone = Math.abs(rect.width - area.clientWidth) < 2
      return { id: tile.dataset.dashboardTile, after: alone ? y > rect.top + rect.height / 2 : x > rect.left + rect.width / 2 }
    }
    const next = Array.from(area.querySelectorAll<HTMLElement>('[data-dashboard-tile]')).find(item => {
      const rect = item.getBoundingClientRect()
      return rect.top > y || (y <= rect.bottom && x < rect.left)
    })?.dataset.dashboardTile
    return next ? { id: next, after: false } : 'end'
  }

  function begin(event: PointerEvent<HTMLButtonElement>, details: DragSource | DashboardTile) {
    if (!event.isPrimary || event.button !== 0 || gesture.current) return
    preventClick.current = false
    if (typeof event.currentTarget.setPointerCapture !== 'function') return
    const start = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
    if ('source' in details) {
      gesture.current = { ...start, ...details, moved: false }
    } else {
      const element = grid.current!
      const style = getComputedStyle(element)
      const columns = style.gridTemplateColumns.split(' ').length
      const body = event.currentTarget.closest('[data-dashboard-tile]')?.querySelector<HTMLElement>('.custom-tile-body')
      gesture.current = { ...start, id: details.id, size: { columns: details.columns, height: details.height },
        height: body?.offsetHeight ?? dashboardSize.minHeight,
        columnWidth: columns === dashboardSize.columns ? (element.clientWidth + (parseFloat(style.columnGap) || 0)) / columns : 0 }
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
    setDrag({ label: current.label, x, y, target: dropAt(x, y) })
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
      const target = dropAt(event.clientX, event.clientY)
      if (target) editor?.onDrop(current.source, target)
    }
    cancel(event)
  }

  const pointerHandlers = { onPointerMove: move, onPointerUp: finish, onPointerCancel: cancel, onLostPointerCapture: cancel }
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
    <div ref={grid} className="custom-dashboard-grid" aria-label="Áttekintő moduljai">
      {tiles.map((tile, index) => {
        const title = tile.kind === 'note' && tile.title.trim() ? tile.title : dashboardModules[tile.kind]
        const size = resize?.id === tile.id ? resize.size : tile
        const target = drag?.target
        const drop = target && target !== 'end' && target.id === tile.id ? (target.after ? 'after' : 'before') : undefined
        const style = { '--tile-columns': size.columns, '--tile-height': size.height === null ? undefined : `${size.height}px` } as CSSProperties
        return <article key={tile.id} className="custom-dashboard-tile" data-dashboard-tile={tile.id}
          style={style} data-editing={editor ? '' : undefined} data-drop={drop} aria-label={title}>
          {editor && <div className="custom-tile-controls">
            <Button type="button" className="icon-button custom-tile-grip" aria-label={`${title} mozgatása húzással`} tabIndex={-1}
              {...pointerHandlers} onPointerDown={event => begin(event, { source: { id: tile.id }, label: title })} title="Mozgatás húzással"><Grip size={18} /></Button>
            <span className="custom-tile-edit-label" title={title}>{title}</span>
            <Button type="button" className="icon-button" aria-label={`${title} előrébb`} disabled={index === 0}
              onClick={() => editor.onDrop({ id: tile.id }, { id: tiles[index - 1]!.id, after: false })}><ArrowUp size={16} /></Button>
            <Button type="button" className="icon-button" aria-label={`${title} hátrébb`} disabled={index === tiles.length - 1}
              onClick={() => editor.onDrop({ id: tile.id }, { id: tiles[index + 1]!.id, after: true })}><ArrowDown size={16} /></Button>
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
      {editor && (editor.catalogue || drag || !tiles.length) && <div className="custom-dashboard-drop" data-active={drag?.target === 'end'}>
        Húzd ide a modult
      </div>}
    </div>
    {drag && <div className="custom-drag-preview" aria-hidden="true"
      style={{ left: Math.min(drag.x + 12, innerWidth - 180), top: Math.min(drag.y + 12, innerHeight - 46) }}>{drag.label}</div>}
  </>
}
