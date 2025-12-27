/**
 * Authentication Guard Component
 * 
 * Wraps content and shows UnauthenticatedPage when user is not logged in.
 * Extracted from inline authentication logic in the original page.js
 */

import UnauthenticatedPage from '@src/components/system/UnauthenticatedPage'
import RetryImage from '@src/components/RetryImage'
import Image from 'next/image'
import SkeletonCard from '@src/components/SkeletonCard'
import { buildCallbackUrl } from '@src/utils/media/urlParser'

/**
 * Content to show for unauthenticated users when media is found
 */
function UnauthMediaContent({ media }) {
  if (!media) return null
  
  return (
    <>
      <div className="mt-8 w-full">
        {media.posterURL || media.metadata?.poster_path ? (
          <RetryImage
            src={
              media.posterURL
                ? media.posterURL
                : `https://image.tmdb.org/t/p/w780${media.metadata.poster_path}`
            }
            width={600}
            height={600}
            quality={100}
            alt={media.title}
            className="max-w-xs w-full h-auto md:w-3/4 mx-auto rounded-lg"
          />
        ) : null}
      </div>
      <h2 className="text-center text-lg text-white mt-2">
        Watch this and more by signing in.
      </h2>
    </>
  )
}

/**
 * Content to show when media is not found but title was requested
 */
function UnauthMediaNotFound() {
  return (
    <>
      <Image
        src={'/sorry-image-not-available.jpg'}
        alt="Not found"
        width={400}
        height={400}
        className="w-3/5 h-auto mx-auto rounded-lg"
      />
      <h2 className="text-center text-lg text-white mt-2">
        We couldn&apos;t find that one, but sign in and check out what we have.
      </h2>
    </>
  )
}

/**
 * Default content when no specific media requested
 */
function UnauthDefaultContent() {
  return (
    <>
      <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl pb-8 xl:pb-0 px-4 xl:px-0">
        Please Sign in first
      </h2>
      <div className="border border-white border-opacity-30 rounded-lg p-3 overflow-hidden skeleton-container">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 overflow-hidden">
          <SkeletonCard />
          <SkeletonCard className="hidden md:block" />
          <SkeletonCard className="hidden lg:block" />
        </div>
      </div>
    </>
  )
}

/**
 * AuthGuard Component
 * 
 * Checks if user is authenticated and shows appropriate content.
 * If not authenticated, shows UnauthenticatedPage with media preview.
 * 
 * @param {Object} props
 * @param {Object} props.session - NextAuth session object
 * @param {Object} props.parsedParams - Parsed URL parameters
 * @param {Object} [props.media] - Media object (if found)
 * @param {React.ReactNode} props.children - Content to show when authenticated
 */
export default function AuthGuard({ session, parsedParams, media, children }) {
  // If user is authenticated, show the protected content
  if (session?.user) {
    return children
  }
  
  // Build callback URL for redirect after login
  const callbackUrl = buildCallbackUrl(parsedParams)
  
  // Determine what content to show based on whether media was found
  let content
  if (media) {
    content = <UnauthMediaContent media={media} />
  } else if (parsedParams.hasTitle) {
    content = <UnauthMediaNotFound />
  } else {
    content = <UnauthDefaultContent />
  }
  
  return (
    <UnauthenticatedPage callbackUrl={callbackUrl}>
      <div className="flex flex-col items-center justify-between">
        <div className="flex flex-col max-w-screen-sm">
          {content}
        </div>
      </div>
    </UnauthenticatedPage>
  )
}