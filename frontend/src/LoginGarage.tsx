import { useRef } from 'react'
import type { PointerEvent } from 'react'
import garageWide from './assets/login-garage-wide.webp'
import garageMobile from './assets/login-garage-mobile.webp'

const limit = (value: number) => Math.max(-1, Math.min(1, value))

export function LoginGarage() {
  const touchStart = useRef<{ x: number; y: number } | null>(null)

  function start(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary || event.pointerType !== 'touch') return
    touchStart.current = { x: event.clientX, y: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function move(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary || (event.pointerType === 'touch' && !touchStart.current)) return
    const picture = event.currentTarget
    const { left, top, width, height } = picture.getBoundingClientRect()
    if (!width || !height) return
    const touch = event.pointerType === 'touch' ? touchStart.current : null
    const x = touch ? (event.clientX - touch.x) * 3 / width : 1 - 2 * (event.clientX - left) / width
    const y = touch ? (event.clientY - touch.y) * 3 / height : 1 - 2 * (event.clientY - top) / height
    picture.style.setProperty('--login-camera-x', `${limit(x) * 1.15}%`)
    picture.style.setProperty('--login-camera-y', `${limit(y) * .75}%`)
    picture.dataset.cameraActive = ''
  }

  function reset(event: PointerEvent<HTMLElement>) {
    if (!event.isPrimary) return
    touchStart.current = null
    delete event.currentTarget.dataset.cameraActive
    event.currentTarget.style.removeProperty('--login-camera-x')
    event.currentTarget.style.removeProperty('--login-camera-y')
  }

  return <picture className="fleet-auth-backdrop" onPointerDown={start} onPointerMove={move}
    onPointerLeave={reset} onPointerCancel={reset} onLostPointerCapture={reset}>
    <source media="(max-width: 900px)" srcSet={garageMobile} width={1008} height={960} />
    <img src={garageWide} alt="" width={1920} height={1200} fetchPriority="high" decoding="async" />
  </picture>
}
