'use client'

import { createContext, useContext, useEffect, useMemo, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'

type NavigationContextValue = {
  isNavigating: boolean
  navigate: (href: string) => void
  targetUrl: string | null
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  
  const [isPending, startTransition] = useTransition()
  const [manualPending, setManualPending] = useState(false)
  const [targetUrl, setTargetUrl] = useState<string | null>(null)
  
  // Clear navigation state when pathname actually changes
  // This handles both completion and back button navigation
  useEffect(() => {
    setManualPending(false)
    setTargetUrl(null)
  }, [pathname])
  
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
