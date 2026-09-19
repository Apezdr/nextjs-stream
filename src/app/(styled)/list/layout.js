import { getSession } from '@src/lib/cachedAuth'
import { Fragment, Suspense } from 'react'
import dynamic from 'next/dynamic'
import Nav from '@components/Navigation/Nav'
import TVAppsNotification from '@src/components/system/TVAppsNotification'
import TVAppsFooter from '@src/components/system/TVAppsFooter'
const ShouldRenderContent = dynamic(() => import('@components/HOC/ShouldRenderContent'))
const BannerWithVideoWrapper = dynamic(() => import('@components/Landing/BannerWithVideoWrapper'))

// Cacheable navigation with admin items determined at layout level
async function CacheableNavigation({ email, profileImage, adminNavItems }) {
  'use cache'

  if (!email) return null

  return (
    <div className="w-full h-auto flex flex-col items-center justify-center text-center z-[3]">
      <Nav adminNavItems={adminNavItems} profileImage={profileImage} />
    </div>
  )
}

// Banner component - separate because ShouldRenderContent is a client component
function BannerSection() {
  // ShouldRenderContent is a client component that wraps its children in Suspense,
  // so we don't need an additional Suspense wrapper here
  return (
    <ShouldRenderContent
      allowedPaths={['/list']}
      suspenseSkeleton={<div className="relative w-full h-[40vh] md:h-[79vh] bg-black" />}
    >
      <BannerWithVideoWrapper />
    </ShouldRenderContent>
  )
}

const BANNER_PLACEHOLDER = <div className="relative w-full h-[40vh] md:h-[79vh] bg-black" />

/**
 * The navigation bar and the /list banner: the parts of this layout that depend
 * on who is signed in. Awaited here, inside a Suspense boundary, rather than in
 * the layout body, which would keep every page under /list out of the
 * prerendered shell (see the (styled) layout for the same rule).
 *
 * This only decides what chrome to SHOW. It was never what protects a page:
 * each page runs its own session check before rendering anything.
 */
async function SessionChrome() {
  const session = await getSession()
  const email = session?.user?.email
  const profileImage = session?.user?.image
  const isAdmin = session?.user?.role === 'admin'
  const isApproved = session?.user?.approved !== false

  // Build admin nav items once if user is admin
  const adminNavItems = isAdmin
    ? [
        {
          href: '/admin',
          label: 'Admin',
          isAdmin: true,
        },
      ]
    : []

  if (!email || !isApproved) return null

  return (
    <>
      {/* Navigation - fully cached with all data determined upfront */}
      <CacheableNavigation
        email={email}
        profileImage={profileImage}
        adminNavItems={adminNavItems}
      />
      <Suspense fallback={BANNER_PLACEHOLDER}>
        <BannerSection />
      </Suspense>
    </>
  )
}

/** Footer - only for authenticated AND approved users */
async function SessionFooter() {
  const session = await getSession()
  if (!session?.user?.email || session.user.approved === false) return null
  return <TVAppsFooter />
}

/**
 * What holds the banner's place while SessionChrome resolves. The banner sits
 * in the page flow on /list, so without this the page content would paint at
 * the top and then jump down by most of a screen when the banner arrives. On
 * every other path ShouldRenderContent renders nothing.
 */
function ChromeFallback() {
  return (
    <ShouldRenderContent allowedPaths={['/list']} suspenseSkeleton={BANNER_PLACEHOLDER}>
      {BANNER_PLACEHOLDER}
    </ShouldRenderContent>
  )
}

export default function ListLayout({ children }) {
  return (
    <Fragment>
      {/* TVAppsNotification - dynamic due to auth() usage */}
      <Suspense>
        <TVAppsNotification />
      </Suspense>

      <div className="relative">
        {/* The fallback has a boundary of its own: it reads the pathname, which
            suspends during prerender on routes with dynamic params, and a
            fallback that suspends would take the whole shell down with it. */}
        <Suspense
          fallback={
            <Suspense>
              <ChromeFallback />
            </Suspense>
          }
        >
          <SessionChrome />
        </Suspense>
      </div>

      {/* Dynamic page content */}
      {children}

      <Suspense>
        <SessionFooter />
      </Suspense>
    </Fragment>
  )
}
