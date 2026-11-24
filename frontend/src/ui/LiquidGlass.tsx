import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, HTMLAttributes, RefObject } from 'react'

const desktopLens = '(min-width: 761px) and (hover: hover) and (pointer: fine)'
const simplerGlass = '(prefers-reduced-transparency: reduce), (forced-colors: active), (prefers-reduced-data: reduce)'
const displacement = 46

function edgeMap(width: number, height: number, radius: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return null
  const pixels = context.createImageData(width, height)
  const halfWidth = width / 2
  const halfHeight = height / 2
  const corner = Math.min(radius, halfWidth, halfHeight)
  const edge = Math.min(18, halfHeight * .7)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const centerX = x + .5 - halfWidth
      const centerY = y + .5 - halfHeight
      const boxX = Math.abs(centerX) - halfWidth + corner
      const boxY = Math.abs(centerY) - halfHeight + corner
      const outsideX = Math.max(boxX, 0)
      const outsideY = Math.max(boxY, 0)
      const cornerDistance = Math.hypot(outsideX, outsideY)
      // Signed distance from the rounded edge. Red and green encode an inward
      // sample offset that fades to neutral toward the middle of the panel.
      const depth = corner - cornerDistance - Math.min(Math.max(boxX, boxY), 0)
      const bend = Math.max(0, 1 - Math.max(0, depth) / edge) ** 1.3
      const inwardX = -Math.sign(centerX) * (cornerDistance ? outsideX / cornerDistance : Number(boxX >= boxY))
      const inwardY = -Math.sign(centerY) * (cornerDistance ? outsideY / cornerDistance : Number(boxY > boxX))
      const offset = (y * width + x) * 4
      pixels.data[offset] = 128 + inwardX * bend * 124
      pixels.data[offset + 1] = 128 + inwardY * bend * 124
      pixels.data[offset + 3] = 255
    }
  }
  context.putImageData(pixels, 0, 0)
  return { url: canvas.toDataURL(), width, height }
}

export function LiquidGlass({ as: Surface = 'div', className = '', children, enabled = true, ref, ...props }: HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'nav' | 'section'; enabled?: boolean; ref?: RefObject<HTMLElement | null>
}) {
  const id = useId()
  const localRef = useRef<HTMLElement>(null)
  const root = ref ?? localRef
  const [map, setMap] = useState<ReturnType<typeof edgeMap>>(null)

  useEffect(() => {
    if (!enabled) return
    // Blink can composite SVG displacement as a backdrop. Blur is the CSS fallback.
    if (!window.CSS?.supports?.('-webkit-app-region', 'drag') || !window.CSS.supports('backdrop-filter', `url("#${id}")`)
        || typeof ResizeObserver === 'undefined') return
    const desktop = matchMedia(desktopLens)
    const reduced = matchMedia(simplerGlass)
    const element = root.current!
    let previous = ''
    const update = () => {
      if (!desktop.matches || reduced.matches || !element.offsetWidth || !element.offsetHeight) {
        previous = ''
        setMap(null)
        return
      }
      const { offsetWidth: width, offsetHeight: height } = element
      const radius = parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0
      const size = `${width}:${height}:${radius}`
      if (size === previous) return
      previous = size
      setMap(edgeMap(width, height, radius))
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    desktop.addEventListener('change', update)
    reduced.addEventListener('change', update)
    update()
    return () => {
      observer.disconnect()
      desktop.removeEventListener('change', update)
      reduced.removeEventListener('change', update)
    }
  }, [enabled, id, root])

  const activeMap = enabled ? map : null
  const lens = activeMap ? { '--liquid-lens': `url("#${id}")` } as CSSProperties : undefined
  return <Surface {...props} ref={element => { root.current = element }} className={enabled ? `glass-surface liquid-glass ${className}` : className} style={{ ...props.style, ...lens }}>
    {activeMap && <svg aria-hidden="true" className="liquid-glass-filter" width="0" height="0">
      <defs><filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage href={activeMap.url} width={activeMap.width} height={activeMap.height} result="edge" />
        <feDisplacementMap in="SourceGraphic" in2="edge" scale={displacement} xChannelSelector="R" yChannelSelector="G" />
      </filter></defs>
    </svg>}
    {children}
  </Surface>
}
