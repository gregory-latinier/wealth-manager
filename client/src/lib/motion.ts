import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/** Hidden from the eye, read by screen readers. Pairs with an `aria-hidden` animated copy so a counting figure is never announced. */
export const srOnly = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const

function subscribe(listener: () => void) {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

/** True when the user asked the system for less motion. Every animation here falls back to the final state. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  )
}

/**
 * A number that eases towards `target`. It starts from 0 on first render and, when the target changes, continues from
 * wherever it currently is, so switching currency or day never jumps back. With reduced motion it is simply the target.
 */
export function useCountUp(target: number, duration = 900): number {
  const reduced = usePrefersReducedMotion()
  const [value, setValue] = useState(reduced ? target : 0)
  const current = useRef(reduced ? target : 0)

  useEffect(() => {
    if (reduced) {
      current.current = target
      setValue(target)
      return
    }
    const origin = current.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3) // ease-out cubic: fast start, gentle landing
      current.current = origin + (target - origin) * eased
      setValue(current.current)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, duration, reduced])

  return value
}
