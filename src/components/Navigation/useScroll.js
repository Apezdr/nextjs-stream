'use client'

import { useState, useEffect } from 'react'
import throttle from 'lodash.throttle'

const useScroll = (threshold = 0, throttleMs = 100) => {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = throttle(() => {
      const scrolled = window.scrollY > threshold
      setIsScrolled(scrolled)
    }, throttleMs)

    // Initial check
    handleScroll()

    window.addEventListener('scroll', handleScroll)

    // Cleanup
    return () => {
      window.removeEventListener('scroll', handleScroll)
      handleScroll.cancel() // Cancel any pending throttled calls
    }
  }, [threshold, throttleMs])

  return isScrolled
}

export default useScroll
