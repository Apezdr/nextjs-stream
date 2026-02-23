// Client Error Boundary Component
// Phase 2: Streaming & Suspense - Client-side error boundary for sections

'use client'

import React from 'react'

// Simple error boundary implementation for client components
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    this.props.onError?.(error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback
    }

    return this.props.children
  }
}

// Error boundary wrapper component for individual sections
export function CollectionSectionErrorBoundary({ children, fallback, sectionName }) {
  return (
    <ErrorBoundary
      fallback={fallback}
      onError={(error, errorInfo) => {
        console.error(`[STREAMING] Error in ${sectionName}:`, error, errorInfo)
      }}
    >
      {children}
    </ErrorBoundary>
  )
}

export default ErrorBoundary