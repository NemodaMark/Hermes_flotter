import { useLayoutEffect } from 'react'
import { vehiclePaint } from './vehicleAppearance'

type RGB = [number, number, number]

function luminance(rgb: RGB) {
  const linear = rgb.map(channel => {
    const value = channel / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  })
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
}

function contrast(a: number, b: number) {
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}

function accessibleTint(paint: RGB, surface: RGB, toward: number) {
  const background = luminance(surface)
  let rgb = paint
  // Tint toward the appropriate end of the scale only when paint alone lacks contrast.
  for (let step = 1; step <= 25 && contrast(luminance(rgb), background) < 5.2; step++) {
    rgb = paint.map(channel => Math.round(channel + (toward - channel) * step / 25)) as RGB
  }
  return `rgb(${rgb.join(' ')})`
}

export function useVehicleAccent(color: string | null) {
  useLayoutEffect(() => {
    const { hex, matched } = vehiclePaint(color)
    if (!matched) return
    const paint = [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16)) as RGB
    // Both variants are set for the lifetime of the preview. CSS chooses the active scheme.
    const palette = {
      '--vehicle-paint': hex,
      '--vehicle-paint-edge': luminance(paint) >= .18 ? '#000' : '#fff',
      '--vehicle-accent-light': accessibleTint(paint, [240, 238, 230], 0),
      '--vehicle-accent-dark': accessibleTint(paint, [51, 59, 52], 255),
    }
    const styles = document.documentElement.style
    for (const [name, value] of Object.entries(palette)) styles.setProperty(name, value)
    return () => { for (const name of Object.keys(palette)) styles.removeProperty(name) }
  }, [color])
}
