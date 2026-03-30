/**
 * Authentication Guard Component
 *
 * Central gatekeeping mechanism for authentication across the app.
 * Wraps content and shows appropriate unauthenticated state when user is not logged in.
 *
 * This is the SINGLE SOURCE OF TRUTH for authentication checks - all pages should use this.
 */

import UnauthenticatedPage from '@src/components/system/UnauthenticatedPage'
import UnauthenticatedWithSkeleton from '@src/components/system/UnauthenticatedWithSkeleton'
import RetryImage from '@src/components/RetryImage'
import Image from 'next/image'
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
        src={'/Confused-Pup.png'}
        alt="Not found"
        width={278}
        height={278}
        className="w-3/5 h-auto mx-auto rounded-lg"
        unoptimized
      />
      <h2 className="text-center text-lg text-white mt-2">
        We couldn't find that one, but sign in and check out what we have.
      </h2>
    </>
  )
}

/**
 * AuthGuard Component
 *
 * Centralized authentication guard that shows appropriate content based on auth state.
 *
 * USAGE PATTERNS:
 *
 * 1. Dynamic media routes (with parsedParams):
 *    <AuthGuard session={session} parsedParams={parsedParams} media={media}>
 *      <AuthenticatedContent />
 *    </AuthGuard>
 *
 * 2. Simple pages with skeleton (list, watchlist, etc.):
 *    <AuthGuard session={session} callbackUrl="/list" variant="skeleton">
 *      <AuthenticatedContent />
 *    </AuthGuard>
 *
 * 3. Custom unauthenticated content:
 *    <AuthGuard session={session} callbackUrl="/custom" variant="skeleton"
 *               title="Custom Title" description="Custom description">
 *      <AuthenticatedContent />
 *    </AuthGuard>
 *
 * @param {Object} props
 * @param {Object} props.session - NextAuth session object
 * @param {string} [props.callbackUrl] - URL to redirect to after login (required if no parsedParams)
 * @param {Object} [props.parsedParams] - Parsed URL parameters (for dynamic routes)
 * @param {Object} [props.media] - Media object (if found, for dynamic routes)
 * @param {string} [props.variant] - Type of unauthenticated content: "skeleton" | "default" (default: "default")
 * @param {string} [props.title] - Custom title for unauthenticated page (variant="skeleton" only)
 * @param {string} [props.description] - Custom description (variant="skeleton" only)
 * @param {React.ReactNode} props.children - Content to show when authenticated
 */
export default function AuthGuard({
  session,
  callbackUrl,
  parsedParams,
  media,
  variant = "default",
  title,
  description,
  children
}) {
  // If user is authenticated, show the protected content
  if (session?.user) {
    return children
  }
  
  // Build callback URL - use provided callbackUrl or build from parsedParams
  const finalCallbackUrl = callbackUrl || (parsedParams ? buildCallbackUrl(parsedParams) : '/')
  
  // VARIANT 1: Skeleton variant (for list pages, watchlists, etc.)
  if (variant === "skeleton") {
    return (
      <UnauthenticatedWithSkeleton
        callbackUrl={finalCallbackUrl}
        title={title}
        description={description}
      />
    )
  }
  
  // VARIANT 2: Dynamic media routes (legacy behavior for parsedParams-based routes)
  if (parsedParams) {
    let content
    if (media) {
      content = <UnauthMediaContent media={media} />
    } else if (parsedParams.hasTitle) {
      content = <UnauthMediaNotFound />
    } else {
      // Fallback to skeleton for dynamic routes without specific media
      return (
        <UnauthenticatedWithSkeleton
          callbackUrl={finalCallbackUrl}
          title={title}
          description={description}
        />
      )
    }
    
    return (
      <UnauthenticatedPage callbackUrl={finalCallbackUrl}>
        <div className="flex flex-col items-center justify-between">
          <div className="flex flex-col max-w-screen-sm">
            {content}
          </div>
        </div>
      </UnauthenticatedPage>
    )
  }
  
  // VARIANT 3: Default - just use UnauthenticatedPage's built-in default
  return <UnauthenticatedPage callbackUrl={finalCallbackUrl} />
}