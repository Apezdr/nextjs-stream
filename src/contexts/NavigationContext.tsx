'use client'

import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { usePathname, useRouter } from 'next/navigation'

type NavigationContextValue = {
  isNavigating: boolean
  navigate: (href: string) => void
  targetUrl: string | null
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

/**
 * Tells the provider when the pathname has actually changed (a navigation
 * completed, or the back button was used).
 *
 * It is a separate component, inside its own Suspense boundary, for one reason:
 * usePathname() suspends during prerender on any route with URL params. The
 * provider wraps the whole app, so reading the pathname in the provider itself
 * suspended EVERYTHING on those routes and left them with an empty prerendered
 * shell. Keep URL-reading hooks out of the provider body.
 */
function PathnameWatcher({ onChange }: { onChange: () => void }) {
  const pathname = usePathname()
  const lastPathname = useRef(pathname)

  useEffect(() => {
    if (lastPathname.current === pathname) return
    lastPathname.current = pathname
    onChange()
  }, [pathname, onChange])

  return null
}

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()

  const [isPending, startTransition] = useTransition()
  const [manualPending, setManualPending] = useState(false)
  const [targetUrl, setTargetUrl] = useState<string | null>(null)

  // Clear navigation state when the pathname changes (handles both completion
  // and back-button navigation).
  const clearNavigation = useCallback(() => {
    setManualPending(false)
    setTargetUrl(null)
  }, [])

  const value = useMemo<NavigationContextValue>(() => ({
    isNavigating: isPending || manualPending,
    targetUrl,
    navigate: (href: string) => {
      setTargetUrl(href)
      setManualPending(true)
      startTransition(() => {
        router.push(href)
      })
    },
  }), [isPending, manualPending, targetUrl, router])

  return (
    <NavigationContext.Provider value={value}>
      <Suspense>
        <PathnameWatcher onChange={clearNavigation} />
      </Suspense>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  const ctx = useContext(NavigationContext)
  if (!ctx) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return ctx
}
