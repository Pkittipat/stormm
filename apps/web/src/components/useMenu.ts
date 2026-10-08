import { useEffect, useRef, useState } from 'react'

/**
 * Open/close state for a trigger + Menu pair. Wrap both in an element
 * with `ref` (and `position: relative`); a pointer-down outside it or
 * Escape closes the menu.
 */
export function useMenu<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false)
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    // Capture phase: a target's own bubble-phase stopPropagation (e.g. a canvas block's click
    // handler) must not be able to stop this from closing the menu — capture runs first, before
    // that stopPropagation has a chance to fire.
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, setOpen, toggle: () => setOpen((o) => !o), close: () => setOpen(false), ref }
}
