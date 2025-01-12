'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'

const RetryImage = ({
  src,
  alt,
  retryCount = 15,
  retryDelay = 1000, // in milliseconds
  fallbackSrc, // Optional fallback image src
  ...props
}) => {
  const [currentSrc, setCurrentSrc] = useState(src)
  const [attempt, setAttempt] = useState(0)
  const [hasError, setHasError] = useState(false)

  useEffect(() => {
    setCurrentSrc(src)
    setAttempt(0)
    setHasError(false)
  }, [src])

  useEffect(() => {
    if (attempt > 0 && attempt <= retryCount) {
      const timeout = setTimeout(() => {
        // Append a query parameter to bypass cache
        const separator = src?.includes('?') ? '&' : '?'
        setCurrentSrc(`${src}${separator}retry=${attempt}`)
      }, retryDelay)

      return () => clearTimeout(timeout)
    }
  }, [attempt, retryCount, retryDelay, src])

  const handleError = () => {
    if (attempt < retryCount) {
      setAttempt(prev => prev + 1)
    } else {
      setHasError(true)
      if (props.onError) props.onError()
    }
  }

  const handleLoad = (e) => {
    if (props.onLoad) props.onLoad(e)
  }

  if (!src) {
    return null
  }

  if (hasError) {
    if (fallbackSrc) {
      return <Image src={fallbackSrc} alt={alt} onLoad={handleLoad} {...props} />
    }
    // Render a fallback UI if no fallbackSrc is provided
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f0f0f0',
          color: '#666',
          ...props.style,
        }}
      >
        <span>Image failed to load</span>
      </div>
    )
  }

  return <Image src={currentSrc} alt={alt} onError={handleError} onLoad={handleLoad} {...props} />
}

export default RetryImage
