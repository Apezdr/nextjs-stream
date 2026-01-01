'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

/**
 * Custom hook for client-side navigation with loading state
 * 
 * Uses React 19's useTransition to track navigation state
 * and provide visual feedback during route transitions.
 * 
 * @returns {Object} Navigation utilities
 * @returns {Function} navigate - Function to navigate to a URL
 * @returns {boolean} isNavigating - Whether navigation is in progress
 * 
 * @example
 * const { navigate, isNavigating } = useNavigate()
 * 
 * <button onClick={() => navigate('/list')} disabled={isNavigating}>
 *   {isNavigating ? 'Loading...' : 'Go to List'}
 * </button>
 */
export function useNavigate() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  
  const navigate = (href) => {
    startTransition(() => {
      router.push(href)
    })
  }
  
  return { 
    navigate, 
    isNavigating: isPending 
  }
}
