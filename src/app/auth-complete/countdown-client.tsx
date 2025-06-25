'use client'

import { useEffect, useState } from 'react'

export default function CountdownClient() {
  const [countdown, setCountdown] = useState(5)

  useEffect(() => {
    // Start countdown timer for auto-close hint
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    
    return () => clearInterval(timer)
  }, [])

  return (
    <span style={{ display: 'block', marginTop: '8px', fontSize: '14px', color: '#888' }}>
      {countdown > 0 ? `Auto-closing hint in ${countdown}...` : 'You can close this window now.'}
    </span>
  )
}
