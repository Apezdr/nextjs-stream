import { auth } from '@src/lib/cachedAuth'
import { adminUserEmails } from '@src/utils/config'
import { Fragment, lazy, Suspense } from 'react'
import Nav from '@components/Navigation/Nav'
import TVAppsNotification from '@src/components/system/TVAppsNotification'
import TVAppsFooter from '@src/components/system/TVAppsFooter'
const ShouldRenderContent = lazy(() => import('@components/HOC/ShouldRenderContent'))
const BannerWithVideoWrapper = lazy(() => import('@components/Landing/BannerWithVideoWrapper'))

// Cacheable navigation with admin items determined at layout level
async function CacheableNavigation({ email, profileImage, adminNavItems }) {
  "use cache"
  
  if (!email) return null
  
  return (
    <div className="w-full h-auto flex flex-col items-center justify-center text-center z-[3]">
      <Nav adminNavItems={adminNavItems} profileImage={profileImage} />
    </div>
  )
}

// Banner component - separate because ShouldRenderContent is a client component
function BannerSection() {
  return (
    <Suspense>
      <ShouldRenderContent
        allowedPaths={['/list']}
        suspenseSkeleton={<div className="relative w-full h-[40vh] md:h-[79vh] bg-black" />}
      >
        <BannerWithVideoWrapper />
      </ShouldRenderContent>
    </Suspense>
  )
}

export default async function ListLayout({ children }) {
  // Single auth() call to determine all user data upfront
  const user = await auth()
  const email = user?.user?.email
  const profileImage = user?.user?.image
  const isAdmin = adminUserEmails.includes(email)

  // Build admin nav items once if user is admin
  const adminNavItems = isAdmin
    ? [
        {
          href: '/admin',
          label: 'Admin',
          icon: (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className="size-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              />
            </svg>
          ),
        },
      ]
    : []

  return (
    <Fragment>
      {/* TVAppsNotification - dynamic due to auth() usage */}
      <TVAppsNotification />
      
      {/* Navigation - fully cached with all data determined upfront */}
      <div className='relative'>
        <CacheableNavigation 
          email={email} 
          profileImage={profileImage} 
          adminNavItems={adminNavItems}
        />
        <Suspense><BannerSection /></Suspense>
      </div>
      
      {/* Dynamic page content */}
      {children}
      
      {/* Footer - dynamic for now */}
      {email && <TVAppsFooter />}
    </Fragment>
  )
}
