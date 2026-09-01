import { useEffect, useState } from 'react'

const BREAKPOINT = 768
const QUERY = `(max-width: ${BREAKPOINT - 1}px)`

/** True below the md breakpoint. Drives the table ↔ mobile-card split. */
export function useIsMobile() {
  // Read the real value for the FIRST render, not after it. Starting at false
  // and correcting in the effect meant every phone painted the desktop table
  // and then threw it away — including the skeleton that exists precisely to
  // stop that swap being visible.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )
  useEffect(() => {
    const mql = window.matchMedia(QUERY)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])
  return isMobile
}
