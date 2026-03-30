import UnauthenticatedPage from './UnauthenticatedPage'
import SkeletonCard from '@components/SkeletonCard'

/**
 * Reusable component for showing unauthenticated users a sign-in prompt with skeleton cards
 * Consolidates duplicate "Please Sign in first" patterns across the app
 * 
 * @param {string} callbackUrl - URL to redirect to after authentication
 * @param {string} title - Main heading text (default: "Please Sign in first")
 * @param {string} description - Optional additional description text
 * @param {number} skeletonCount - Number of skeleton cards to show (default: 3)
 */
export default function UnauthenticatedWithSkeleton({ 
  callbackUrl, 
  title = "Please Sign in first",
  description = null,
  skeletonCount = 3 
}) {
  return (
    <UnauthenticatedPage callbackUrl={callbackUrl}>
      <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
        {title}
      </h2>
      {description && (
        <div className="text-center text-gray-300 mt-4">
          {description}
        </div>
      )}
      <div className="border border-white border-opacity-30 rounded-lg p-3 overflow-hidden skeleton-container">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 overflow-hidden">
          <SkeletonCard />
          {skeletonCount >= 2 && <SkeletonCard className="hidden md:block" />}
          {skeletonCount >= 3 && <SkeletonCard className="hidden lg:block" />}
        </div>
      </div>
    </UnauthenticatedPage>
  )
}
