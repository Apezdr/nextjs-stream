import { auth } from '@src/lib/cachedAuth'
import { adminUserEmails } from '@src/utils/config'
import { Fragment, Suspense } from 'react'
import dynamic from 'next/dynamic'
import Nav from '@components/Navigation/Nav'
import TVAppsNotification from '@src/components/system/TVAppsNotification'
import TVAppsFooter from '@src/components/system/TVAppsFooter'
const ShouldRenderContent = dynamic(() => import('@components/HOC/ShouldRenderContent'))
const BannerWithVideoWrapper = dynamic(() => import('@components/Landing/BannerWithVideoWrapper'))

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
          isAdmin: true,
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
        <Suspense fallback={<div className="relative w-full h-[40vh] md:h-[79vh] bg-black" />}>
          <BannerSection />
        </Suspense>
      </div>
      
      {/* Dynamic page content */}
      {children}
      
      {/* Footer - dynamic for now */}
      {email && <TVAppsFooter />}
    </Fragment>
  )
}
