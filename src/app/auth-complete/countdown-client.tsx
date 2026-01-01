'use client'

import { useEffect, useRef, useState } from 'react'

export default function CountdownClient() {
  const [countdown, setCountdown] = useState(5)
  const attemptedCloseRef = useRef(false)

  useEffect(() => {
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  // Try closing once when countdown hits 0
  useEffect(() => {
    if (countdown === 0 && !attemptedCloseRef.current) {
      attemptedCloseRef.current = true
      try {
        // Give a small delay so user can read the final message (optional)
        setTimeout(() => {
          // Some browsers only allow closing if window was opened via script
          window.close()
        }, 400)
      } catch {
        // Ignore
      }
    }
  }, [countdown])

  return (
    <span style={{ display: 'block', marginTop: '8px', fontSize: '14px', color: '#888' }}>
      {countdown > 0 ? `Auto-closing in ${countdown}...` : 'Attempting to close this window...'}
    </span>
  )
}
