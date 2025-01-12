'use client'
import './nav.css'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Disclosure, Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline'
import { lazy, Suspense } from 'react'
import { siteTitle } from '@src/utils/config'
import Logo from '@src/app/logo'
import { classNames } from '@src/utils'
import useScroll from './useScroll'

const SearchInput = lazy(() => import('@components/Search/SearchInput'))
const SignOutButton = lazy(() => import('@components/SignOutButton'))

const isMediaPageFunc = (pathname) => {
  const moviePattern = /^\/list\/movie\/[^/]+$/
  const tvPattern = /^\/list\/tv\/[^/]+\/\d+\/\d+$/
  return moviePattern.test(pathname) || tvPattern.test(pathname)
}

const isMediaListPageFunc = (pathname) => {
  const moviePattern = /^\/list\/movie(\/[^/]+)?$/
  const tvPattern = /^\/list\/tv(\/[^/]+(\/\d+)?)?$/
  return moviePattern.test(pathname) || tvPattern.test(pathname)
}

const Nav = ({ adminNavItems = [], profileImage = '' }) => {
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
              <div className="mx-auto max-w-7xl px-2 sm:px-4 lg:px-8">
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
                          {item.icon}
                          <span className="ml-2">{item.label}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-1 items-center justify-center px-2 lg:ml-6 lg:justify-end">
                    <div className="w-full max-w-lg lg:max-w-xs">
                      <SearchInput />
                    </div>
                  </div>
                  <div className="mr-2 sm:ml-4 sm:mr-0 flex items-center">
                    {/* Profile dropdown */}
                    <Menu as="div" className="relative ml-4 flex-shrink-0 text-slate-700">
                      <div>
                        <MenuButton className="relative flex rounded-full bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2">
                          <span className="sr-only">Open user menu</span>
                          <img alt="" src={profileImage} className="h-8 w-8 rounded-full" />
                        </MenuButton>
                      </div>
                      <Suspense>
                        <MenuItems className="absolute right-0 z-[12] mt-2 w-48 origin-top-right rounded-md bg-white hover:bg-gray-400 py-1 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
                          <MenuItem>
                            {({ active }) => (
                              <SignOutButton
                                signoutProps={{ callbackUrl: '/' }}
                                fontcolorClass={null}
                                className={`block w-full px-4 py-2 text-sm ${active ? 'bg-gray-100' : ''}`}
                              />
                            )}
                          </MenuItem>
                        </MenuItems>
                      </Suspense>
                    </Menu>
                  </div>
                  <div className="flex items-center lg:hidden">
                    <Disclosure.Button className="inline-flex items-center justify-center rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500">
                      <span className="sr-only">Open main menu</span>
                      {open ? (
                        <XMarkIcon className="block h-6 w-6" aria-hidden="true" />
                      ) : (
                        <Bars3Icon className="block h-6 w-6" aria-hidden="true" />
                      )}
                    </Disclosure.Button>
                  </div>
                </div>
              </div>

              <Disclosure.Panel className="lg:hidden">
                <div className="space-y-1 px-2 pt-2 pb-3">
                  {navItems.map((item) => (
                    <Disclosure.Button
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
                      {item.icon}
                      {item.label}
                    </Disclosure.Button>
                  ))}
                </div>
              </Disclosure.Panel>
            </>
          )}
        </Disclosure>
      )}
    </>
  )
}

export default Nav
