'use client'
import './nav.css'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { Disclosure, DisclosureButton, DisclosurePanel, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Bars3Icon, TvIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { lazy, Suspense, useState } from 'react'
import { siteTitle } from '@src/utils/config'
import Logo from '@src/app/logo'
import { classNames } from '@src/utils'
import useScroll from './useScroll'

const SearchInput = lazy(() => import('@components/Search/SearchInput'))
const SignOutButton = lazy(() => import('@components/SignOutButton'))
const NotificationBell = lazy(() => import('@components/notifications/NotificationBell'))
const DeviceLinkModal = lazy(() => import('./DeviceLinkModal'))

// Invisible fallbacks for immediate rendering
const SearchFallback = () => <div className="w-full max-w-lg lg:max-w-xs h-10 bg-transparent" />
const SignOutFallback = () => <div className="block w-full px-4 py-2 text-sm text-transparent">Sign out</div>
const NotificationFallback = () => <div className="w-10 h-10 bg-transparent" />

const isMediaPageFunc = (pathname) => {
  const moviePattern = /^\/list\/movie\/[^/]+\/play$/
  const tvPattern = /^\/list\/tv\/[^/]+\/\d+\/\d+\/play$/
  return moviePattern.test(pathname) || tvPattern.test(pathname)
}

const isMediaListPageFunc = (pathname) => {
  const moviePattern = /^\/list\/movie(\/[^/]+)?$/
  const tvPattern = /^\/list\/tv(\/[^/]+(\/\d+)?(\/\d+)?)?$/
  return moviePattern.test(pathname) || tvPattern.test(pathname)
}

// Helper to get icon for a nav item - renders admin icon if item.isAdmin is true
const getItemIcon = (item) => {
  if (item.isAdmin) {
    return (
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
    )
  }
  return item.icon
}

const Nav = ({ adminNavItems = [], profileImage = '' }) => {
  const [isDeviceLinkModalOpen, setIsDeviceLinkModalOpen] = useState(false)
  const pathname = usePathname()
  const isScrolled = useScroll(0) // Threshold set to 0; adjust if needed

  const navItems = [
    {
      href: '/list',
      label: 'Home',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth="1.5"
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
          />
        </svg>
      ),
    },
    {
      href: '/list/tv',
      label: 'TV',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125z"
          />
        </svg>
      ),
    },
    {
      href: '/list/movie',
      label: 'Movies',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h1.5C5.496 19.5 6 18.996 6 18.375m-3.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-1.5A1.125 1.125 0 0118 18.375M20.625 4.5H3.375m17.25 0c.621 0 1.125.504 1.125 1.125M20.625 4.5h-1.5C18.504 4.5 18 5.004 18 5.625m3.75 0v1.5c0 .621-.504 1.125-1.125 1.125M3.375 4.5c-.621 0-1.125.504-1.125 1.125M3.375 4.5h1.5C5.496 4.5 6 5.004 6 5.625m-3.75 0v1.5c0 .621.504 1.125 1.125 1.125m0 0h1.5m-1.5 0c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125M19.125 12h1.5m0 0c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h1.5m14.25 0h1.5"
          />
        </svg>
      ),
    },
    {
      href: '/watchlist',
      label: 'My List',
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="h-6 w-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z"
          />
        </svg>
      ),
    },
    // ... other nav items
    ...adminNavItems,
  ]

  const isListPage = pathname === '/list'
  const isMediaPage = isMediaPageFunc(pathname)
  const isMediaListPage = isMediaListPageFunc(pathname)

  // Determine if gradient should be active
  const shouldActivateGradient = isListPage && isScrolled

  return (
    <>
      {/* Navigation Shadow */}
      {isListPage && (
        <div className="navigation-shadow absolute top-0 left-0 w-full h-0 z-[1]"></div>
      )}
      {!isMediaPage && (
        <Disclosure
          as="nav"
          className={classNames(
            'fixed top-0 left-0 w-full z-[11]',
            'nav-container',
            'transition-colors duration-1000',
            'bg-[#2f70cc] md:bg-transparent',
            shouldActivateGradient ? 'gradient-active' : '',
            !isListPage ? 'gradient-active' : ''
          )}
        >
          {({ open }) => (
            <>
              <div className={classNames(
                "mx-auto max-w-7xl px-2 sm:px-4 lg:px-8",
                open ? 'bg-[#2f70cc] lg:bg-transparent' : ''
              )}>
                <div className="flex h-16 justify-between">
                  <div className="flex px-2 lg:px-0">
                    <div className="flex flex-shrink-0 items-center">
                      <Link href="/list">
                        <Logo siteTitle={siteTitle} color={isListPage ? 'white' : 'black'} />
                      </Link>
                    </div>
                    <div className="hidden lg:ml-6 lg:flex lg:space-x-8">
                      {navItems.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={`inline-flex items-center border-b-2 px-1 pt-1 text-sm font-medium transition-colors duration-150 ease-in-out ${
                            pathname === item.href ||
                            ((isMediaPage||isMediaListPage) &&
                              pathname.indexOf(item.href) > -1 &&
                              item.href !== '/list')
                              ? isListPage
                                ? 'text-gray-200 border-blue-50'
                                : 'text-gray-900 border-blue-50'
                              : 'border-transparent text-gray-300 hover:border-gray-300 hover:text-gray-800'
                          }`}
                        >
                          {getItemIcon(item)}
                          <span className="ml-2">{item.label}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-1 items-center justify-start px-2 lg:ml-6 lg:justify-end">
                    <div className="w-full max-w-lg lg:max-w-xs">
                      <Suspense fallback={<SearchFallback />}>
                        <SearchInput />
                      </Suspense>
                    </div>
                  </div>
                  <div className="mr-2 sm:ml-4 sm:mr-0 flex items-center">
                    {/* Notification Bell */}
                    <Suspense fallback={<NotificationFallback />}>
                      <NotificationBell />
                    </Suspense>
                    
                    {/* Profile dropdown */}
                    <Menu as="div" className="relative ml-4 flex-shrink-0 text-slate-700">
                      <div>
                        <MenuButton className="relative flex rounded-full bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                          <span className="sr-only">Open user menu</span>
                          <Image
                            alt="User profile"
                            src={profileImage}
                            className="h-8 w-8 rounded-full"
                            width={32}
                            height={32}
                          />
                        </MenuButton>
                      </div>
                      <Suspense>
                        <MenuItems className="absolute right-0 z-[12] mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                          <MenuItem>
                            {({ focus }) => (
                              <Link
                                href="/account/delete"
                                className={`block px-4 py-2 text-sm text-gray-700 hover:bg-gray-400 ${focus ? 'bg-gray-100' : ''}`}
                              >
                                Account Settings
                              </Link>
                            )}
                          </MenuItem>
                          <MenuItem>
                            {({ focus }) => (
                              <Link
                                href="/privacy"
                                className={`block px-4 py-2 text-sm text-gray-700 hover:bg-gray-400 ${focus ? 'bg-gray-100' : ''}`}
                              >
                                Privacy Policy
                              </Link>
                            )}
                          </MenuItem>
                          <MenuItem>
                            {({ focus }) => (
                              <button
                                onClick={() => setIsDeviceLinkModalOpen(true)}
                                className={`block w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-400 ${focus ? 'bg-gray-100' : ''}`}
                              >
                                <TvIcon className="inline-block h-5 w-5 mr-2" aria-hidden="true" />
                                Link a Device
                              </button>
                            )}
                          </MenuItem>
                          <MenuItem>
                            {({ focus }) => (
                              <Suspense fallback={<SignOutFallback />}>
                                <SignOutButton
                                  signoutProps={{ callbackUrl: '/' }}
                                  fontcolorClass={null}
                                  className={`block w-full px-4 py-2 text-sm hover:bg-gray-400 ${focus ? 'bg-gray-100' : ''}`}
                                />
                              </Suspense>
                            )}
                          </MenuItem>
                        </MenuItems>
                      </Suspense>
                    </Menu>
                  </div>
                  <div className="flex items-center lg:hidden">
                    <DisclosureButton className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500">
                      <span className="sr-only">Open main menu</span>
                      {open ? (
                        <XMarkIcon className="block h-6 w-6" aria-hidden="true" />
                      ) : (
                        <Bars3Icon className="block h-6 w-6" aria-hidden="true" />
                      )}
                    </DisclosureButton>
                  </div>
                </div>
              </div>

              <DisclosurePanel className={classNames(
                "lg:hidden",
                open ? 'bg-[#2f70cc] lg:bg-transparent' : ''
              )}>
                <div className={classNames(
                  "space-y-1 px-2 pt-2 pb-3",
                  open ? 'bg-[#2f70cc] lg:bg-transparent' : ''
                )}>
                  {navItems.map((item) => (
                    <DisclosureButton
                      key={item.href}
                      as={Link}
                      href={item.href}
                      className={`flex gap-3 justify-center border-l-4 py-2 pl-3 pr-4 text-base font-medium ${
                        pathname === item.href ||
                        (isMediaPage && pathname.indexOf(item.href) > -1 && item.href !== '/list')
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-transparent text-gray-300 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-500'
                      }`}
                    >
                      {getItemIcon(item)}
                      {item.label}
                    </DisclosureButton>
                  ))}
                </div>
              </DisclosurePanel>
            </>
          )}
        </Disclosure>
      )}
      
      {/* Device Link Modal */}
      <Suspense>
        <DeviceLinkModal 
          isOpen={isDeviceLinkModalOpen} 
          onClose={() => setIsDeviceLinkModalOpen(false)} 
        />
      </Suspense>
    </>
  )
}

export default Nav
