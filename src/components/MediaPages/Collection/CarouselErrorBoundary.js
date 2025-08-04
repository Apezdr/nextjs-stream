'use client'

import React from 'react'
import { ErrorBoundary } from 'react-error-boundary'

/**
 * Comprehensive error boundary for carousel components
 * Provides graceful fallbacks and error reporting
 */

// Error fallback component for VirtualizedHorizontalList
const VirtualizedListErrorFallback = ({ error, resetErrorBoundary }) => {
  console.error('VirtualizedHorizontalList Error:', error)

  return (
    <div className="relative min-h-[280px] flex items-center justify-center bg-gray-900/50 rounded-lg border border-gray-700">
      <div className="text-center p-8">
        <div className="mb-4">
          <svg className="w-16 h-16 text-gray-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white mb-2">
          Unable to load carousel
        </h3>
        <p className="text-gray-300 text-sm mb-4">
          There was an error displaying the content. Please try refreshing the page.
        </p>
        <button
          onClick={resetErrorBoundary}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  )
}

// Error fallback for ContributorCard
const ContributorCardErrorFallback = ({ error, resetErrorBoundary }) => {
  console.error('ContributorCard Error:', error)

  return (
    <div className="flex-shrink-0 w-40 bg-gray-800/50 rounded-lg border border-gray-700 p-4">
      <div className="text-center">
        <div className="w-full h-48 bg-gray-700 rounded-lg mb-3 flex items-center justify-center">
          <svg className="w-8 h-8 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
          </svg>
        </div>
        <p className="text-xs text-gray-400">Failed to load</p>
        <button
          onClick={resetErrorBoundary}
          className="text-xs text-indigo-400 hover:text-indigo-300 mt-1"
        >
          Retry
        </button>
      </div>
    </div>
  )
}

// Error fallback for entire FeaturedContributorsCarousel
const CarouselErrorFallback = ({ error, resetErrorBoundary }) => {
  console.error('FeaturedContributorsCarousel Error:', error)

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Featured Contributors</h2>
        <div className="flex gap-2">
          <div className="px-4 py-2 bg-gray-800 text-gray-500 rounded-lg">
            Cast (-)
          </div>
          <div className="px-4 py-2 bg-gray-800 text-gray-500 rounded-lg">
            Directors (-)
          </div>
        </div>
      </div>

      <div className="relative min-h-[280px] flex items-center justify-center bg-gray-900/30 rounded-lg border border-gray-700">
        <div className="text-center p-8">
          <div className="mb-4">
            <svg className="w-20 h-20 text-gray-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">
            Something went wrong
          </h3>
          <p className="text-gray-300 text-sm mb-6 max-w-md">
            We encountered an error while loading the contributors carousel. 
            This might be a temporary issue.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={resetErrorBoundary}
              className="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
              Refresh Page
            </button>
          </div>
          {process.env.NODE_ENV === 'development' && (
            <details className="mt-4 text-left">
              <summary className="text-gray-400 cursor-pointer text-sm mb-2">
                Error Details (Development)
              </summary>
              <pre className="text-xs text-red-400 bg-gray-900 p-3 rounded overflow-auto max-h-32">
                {error.message}
                {error.stack && `\n\n${error.stack}`}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

// Network error fallback
const NetworkErrorFallback = ({ error, resetErrorBoundary }) => {
  const isNetworkError = error.message.includes('fetch') || 
                        error.message.includes('network') ||
                        error.message.includes('Failed to fetch')

  if (!isNetworkError) {
    return <CarouselErrorFallback error={error} resetErrorBoundary={resetErrorBoundary} />
  }

  return (
    <div className="mt-8">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Featured Contributors</h2>
      </div>

      <div className="relative min-h-[280px] flex items-center justify-center bg-gray-900/30 rounded-lg border border-gray-700">
        <div className="text-center p-8">
          <div className="mb-4">
            <svg className="w-20 h-20 text-yellow-400 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">
            Connection Issue
          </h3>
          <p className="text-gray-300 text-sm mb-6 max-w-md">
            Unable to load contributor data. Please check your internet connection and try again.
          </p>
          <button
            onClick={resetErrorBoundary}
            className="px-6 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
          >
            Retry Loading
          </button>
        </div>
      </div>
    </div>
  )
}

// Error logging function
const logError = (error, errorInfo) => {
  console.group('🚨 Carousel Error Boundary')
  console.error('Error:', error)
  console.error('Error Info:', errorInfo)
  console.error('Component Stack:', errorInfo.componentStack)
  console.groupEnd()

  // In production, you might want to send this to an error reporting service
  if (typeof window !== 'undefined' && window.gtag) {
    window.gtag('event', 'exception', {
      description: error.message,
      fatal: false,
      custom_map: {
        component: 'FeaturedContributorsCarousel'
      }
    })
  }
}

// Main error boundary components
export const VirtualizedListErrorBoundary = ({ children, onRetry }) => (
  <ErrorBoundary
    FallbackComponent={VirtualizedListErrorFallback}
    onError={logError}
    onReset={onRetry}
    resetKeys={['items']} // Reset when items change
  >
    {children}
  </ErrorBoundary>
)

export const ContributorCardErrorBoundary = ({ children, contributor }) => (
  <ErrorBoundary
    FallbackComponent={ContributorCardErrorFallback}
    onError={logError}
    resetKeys={[contributor?.id]} // Reset when contributor changes
  >
    {children}
  </ErrorBoundary>
)

export const CarouselErrorBoundary = ({ children, onRetry }) => (
  <ErrorBoundary
    FallbackComponent={NetworkErrorFallback}
    onError={logError}
    onReset={onRetry}
    resetKeys={['collectionId']} // Reset when collection changes
  >
    {children}
  </ErrorBoundary>
)

// HOC for wrapping components with error boundaries
export const withCarouselErrorBoundary = (Component, boundaryType = 'carousel') => {
  const WrappedComponent = (props) => {
    const ErrorBoundaryComponent = {
      carousel: CarouselErrorBoundary,
      list: VirtualizedListErrorBoundary,
      card: ContributorCardErrorBoundary
    }[boundaryType] || CarouselErrorBoundary

    return (
      <ErrorBoundaryComponent onRetry={() => window.location.reload()}>
        <Component {...props} />
      </ErrorBoundaryComponent>
    )
  }

  WrappedComponent.displayName = `withCarouselErrorBoundary(${Component.displayName || Component.name})`
  return WrappedComponent
}

export default CarouselErrorBoundary