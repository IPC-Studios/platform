import { useEffect, useState } from 'react'

const BREAKPOINT = 768

/** True below the md breakpoint. Drives the table ↔ mobile-card split. */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${BREAKPOINT - 1}px)`)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])
  return isMobile
}
