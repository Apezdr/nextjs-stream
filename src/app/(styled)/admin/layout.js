'use client'

import { useEffect, useState, useMemo } from 'react'
import { redirect, usePathname } from 'next/navigation'
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  Menu,
  MenuButton,
  MenuItem,
  MenuItems,
  TransitionChild,
} from '@headlessui/react'
import {
  Bars3Icon,
  BellIcon,
  CalendarIcon,
  FolderIcon,
  HomeIcon,
  UsersIcon,
  XMarkIcon,
  ChevronDownIcon as ChevronDownIconOutline,
  Cog8ToothIcon,
  TrashIcon,
} from '@heroicons/react/24/outline'
import { ArrowLeftIcon, ChevronDownIcon, InformationCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/20/solid'
import Link from 'next/link'
import { siteTitle } from '@src/utils/config'
import { buildURL } from '@src/utils'
import { useRouter } from 'next/navigation'
import Logo from '../../logo'
import { MinimalServerStats } from '@components/Admin/Stats/ServerStats'
import { MinimalizedServerProcesses } from '@components/Admin/Stats/ServerProcesses'

const navigation = [
  { name: 'Dashboard', href: '/admin', icon: HomeIcon },
  { name: 'Users', href: '/admin/users', icon: UsersIcon },
  {
    name: 'Media',
    href: '/admin/media',
    icon: FolderIcon,
    subItems: [
      { name: 'TV', href: '/admin/media/tv' },
      { name: 'Movies', href: '/admin/media/movies' },
    ],
  },
  { name: 'Calendar', href: '/admin/calendar', icon: CalendarIcon },
  { name: 'Deletion Requests', href: '/admin/deletion-requests', icon: TrashIcon },
  { name: 'Settings', href: '/admin/settings', icon: Cog8ToothIcon },
  { name: 'Logs', href: '/admin/logs', icon: InformationCircleIcon },
]
const teams = [
  { id: 1, name: 'Heroicons', href: '#', initial: 'H', current: false },
  { id: 2, name: 'Tailwind Labs', href: '#', initial: 'T', current: false },
  { id: 3, name: 'Workcation', href: '#', initial: 'W', current: false },
]
const userNavigation = [
  //{ name: 'Your profile', href: '#' },
  { name: 'Sign out', href: '/api/auth/signout' },
]

function classNames(...classes) {
  return classes.filter(Boolean).join(' ')
}

export default function AdminLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const router = useRouter()

  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(false)

  // Derive expanded items from pathname to avoid setState in effect
  const expandedItems = useMemo(() => {
    const items = {}
    navigation.forEach((item) => {
      if (item.subItems && item.subItems.some((subItem) => pathname === subItem.href)) {
        items[item.name] = true
      }
    })
    return items
  }, [pathname])

  useEffect(() => {
    const validateAuth = async () => {
      try {
        const response = await fetch(buildURL('/api/auth/session'), {
          method: 'GET',
        })
        if (response.ok) {
          const session = await response.json()
          if (session && session.user && session.user?.admin == true) {
            setIsAuthenticated(true)
            setUser(session.user)
          } else {
            setIsAuthenticated(false)
            // Redirect to login page or show error
            router.replace('/')
          }
        } else {
          setIsAuthenticated(false)
          // Redirect to login page or show error
          router.replace('/')
        }
      } catch (error) {
        console.error('Authentication validation failed:', error)
        setIsAuthenticated(false)
        // Redirect to login page or show error
        redirect('/')
      }
    }

    validateAuth()
  }, [router])

  // Use local state for manual toggle expansion
  const [manuallyExpanded, setManuallyExpanded] = useState({})

  const toggleExpand = (itemName) => {
    setManuallyExpanded((prev) => ({
      ...prev,
      [itemName]: !prev[itemName],
    }))
  }

  // Combine auto-expanded (based on pathname) with manually toggled items
  const effectiveExpandedItems = useMemo(() => {
    return { ...expandedItems, ...manuallyExpanded }
  }, [expandedItems, manuallyExpanded])

  const renderNavItem = (item) => (
    <li key={item.name}>
      <div className="flex items-center">
        <Link
          href={item.href}
          className={classNames(
            pathname === item.href ||
              (item.subItems && item.subItems.some((subItem) => pathname === subItem.href))
              ? 'bg-gray-800 text-white'
              : 'text-gray-400 hover:bg-gray-800 hover:text-white',
            'group flex flex-1 gap-x-3 rounded-md p-2 text-sm font-semibold leading-6'
          )}
        >
          <item.icon aria-hidden="true" className="h-6 w-6 shrink-0" />
          {item.name}
        </Link>
        {item.subItems && (
          <button
            onClick={() => toggleExpand(item.name)}
            className="p-2 text-gray-400 hover:text-white"
          >
            <ChevronDownIconOutline
              className={`h-5 w-5 transform ${effectiveExpandedItems[item.name] ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>
      {item.subItems && effectiveExpandedItems[item.name] && (
        <ul className="mt-1 space-y-1 pl-10">
          {item.subItems.map((subItem) => (
            <li key={subItem.name}>
              <Link
                href={subItem.href}
                className={classNames(
                  pathname === subItem.href
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                  'block rounded-md p-2 text-sm'
                )}
              >
                {subItem.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  )

  if (!isAuthenticated) {
    return null // or a loading spinner
  }
  return (
      <div>
        <Dialog open={sidebarOpen} onClose={setSidebarOpen} className="relative z-50 lg:hidden">
          <DialogBackdrop
            transition
            className="fixed inset-0 bg-gray-900/80 transition-opacity duration-300 ease-linear data-closed:opacity-0"
          />

          <div className="fixed inset-0 flex">
            <DialogPanel
              transition
              className="relative mr-16 flex w-full max-w-xs flex-1 transform transition duration-300 ease-in-out data-closed:-translate-x-full"
            >
              <TransitionChild>
                <div className="absolute left-full top-0 flex w-16 justify-center pt-5 duration-300 ease-in-out data-closed:opacity-0">
                  <button
                    type="button"
                    onClick={() => setSidebarOpen(false)}
                    className="-m-2.5 p-2.5"
                  >
                    <span className="sr-only">Close sidebar</span>
                    <XMarkIcon aria-hidden="true" className="h-6 w-6 text-white" />
                  </button>
                </div>
              </TransitionChild>
              {/* Sidebar component, swap this element with another sidebar if you like */}
              <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gray-900 px-6 pb-4 ring-1 ring-white/10">
                <div className="flex h-16 shrink-0 items-center">
                  <Logo siteTitle={siteTitle} />
                </div>
                <nav className="flex flex-1 flex-col">
                  <ul className="flex flex-1 flex-col gap-y-7">
                    <li>
                      <ul className="-mx-2 space-y-1">{navigation.map(renderNavItem)}</ul>
                    </li>
                    <li>
                      <div className="text-xs font-semibold leading-6 text-gray-400">
                        Your teams
                      </div>
                      <ul className="-mx-2 mt-2 space-y-1">
                        {teams.map((team) => (
                          <li key={team.name}>
                            <Link
                              href={team.href}
                              className={classNames(
                                team.current
                                  ? 'bg-gray-800 text-white'
                                  : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                                'group flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6'
                              )}
                            >
                              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-gray-700 bg-gray-800 text-[0.625rem] font-medium text-gray-400 group-hover:text-white">
                                {team.initial}
                              </span>
                              <span className="truncate">{team.name}</span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </li>
                    <li className="mt-auto">
                      <div className="px-2">
                        <div className="text-xs font-semibold leading-6 text-gray-400 mb-2">Server Processes</div>
                        <MinimalizedServerProcesses />
                      </div>
                      <div className="px-2">
                        <div className="text-xs font-semibold leading-6 text-gray-400 mb-2">Server Status</div>
                        <MinimalServerStats />
                      </div>
                      <a
                        href="/list"
                        className="group -mx-2 flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6 text-gray-400 hover:bg-gray-800 hover:text-white"
                      >
                        <ArrowLeftIcon aria-hidden="true" className="h-6 w-6 shrink-0" />
                        Go back to Site
                      </a>
                    </li>
                  </ul>
                </nav>
              </div>
            </DialogPanel>
          </div>
        </Dialog>

        {/* Static sidebar for desktop */}
        <div className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
          {/* Sidebar component, swap this element with another sidebar if you like */}
          <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-gray-900 px-6 pb-4">
            <div className="flex h-16 shrink-0 items-center self-center">
              <Logo siteTitle={siteTitle} />
            </div>
            <nav className="flex flex-1 flex-col">
              <ul className="flex flex-1 flex-col gap-y-7">
                <li>
                  <ul className="-mx-2 space-y-1">{navigation.map(renderNavItem)}</ul>
                </li>
                <li>
                  <div className="text-xs font-semibold leading-6 text-gray-400">Your teams</div>
                  <ul className="-mx-2 mt-2 space-y-1">
                    {teams.map((team) => (
                      <li key={team.name}>
                        <a
                          href={team.href}
                          className={classNames(
                            team.current
                              ? 'bg-gray-800 text-white'
                              : 'text-gray-400 hover:bg-gray-800 hover:text-white',
                            'group flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6'
                          )}
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-gray-700 bg-gray-800 text-[0.625rem] font-medium text-gray-400 group-hover:text-white">
                            {team.initial}
                          </span>
                          <span className="truncate">{team.name}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </li>
                <li className="mt-auto">
                  <div className="px-2">
                    <div className="text-xs font-semibold leading-6 text-gray-400 mb-2">Server Processes</div>
                    <MinimalizedServerProcesses />
                  </div>
                  <div className="px-2">
                    <div className="text-xs font-semibold leading-6 text-gray-400 mb-2">Server Status</div>
                    <MinimalServerStats />
                  </div>
                  <a
                    href="/list"
                    className="group -mx-2 flex gap-x-3 rounded-md p-2 text-sm font-semibold leading-6 text-gray-400 hover:bg-gray-800 hover:text-white"
                  >
                    <ArrowLeftIcon aria-hidden="true" className="h-6 w-6 shrink-0" />
                    Go back to Site
                  </a>
                </li>
              </ul>
            </nav>
          </div>
        </div>

        <div className="lg:pl-72">
          <div className="sticky top-0 z-40 flex h-16 shrink-0 items-center gap-x-4 border-b border-gray-200 bg-white px-4 shadow-sm sm:gap-x-6 sm:px-6 lg:px-8">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="-m-2.5 p-2.5 text-gray-700 lg:hidden"
            >
              <span className="sr-only">Open sidebar</span>
              <Bars3Icon aria-hidden="true" className="h-6 w-6" />
            </button>

            {/* Separator */}
            <div aria-hidden="true" className="h-6 w-px bg-gray-900/10 lg:hidden" />

            <div className="flex flex-1 gap-x-4 self-stretch lg:gap-x-6">
              <form action="#" method="GET" className="relative flex flex-1">
                <label htmlFor="search-field" className="sr-only">
                  Search
                </label>
                <MagnifyingGlassIcon
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 h-full w-5 text-gray-400"
                />
                <input
                  id="search-field"
                  name="search"
                  type="search"
                  placeholder="Search..."
                  className="block h-full w-full border-0 py-0 pl-8 pr-0 text-gray-900 placeholder:text-gray-400 focus:ring-0 sm:text-sm"
                />
              </form>
              <div className="flex items-center gap-x-4 lg:gap-x-6">
                <button type="button" className="-m-2.5 p-2.5 text-gray-400 hover:text-gray-500">
                  <span className="sr-only">View notifications</span>
                  <BellIcon aria-hidden="true" className="h-6 w-6" />
                </button>

                {/* Separator */}
                <div
                  aria-hidden="true"
                  className="hidden lg:block lg:h-6 lg:w-px lg:bg-gray-900/10"
                />

                {/* Profile dropdown */}
                <Menu as="div" className="relative">
                  <MenuButton className="-m-1.5 flex items-center p-1.5">
                    <span className="sr-only">Open user menu</span>
                    <img
                      alt={`${user.name} Profile Picture`}
                      src={user.image}
                      width={256}
                      height={256}
                      className="h-8 w-8 rounded-full bg-gray-50"
                    />
                    <span className="hidden lg:flex lg:items-center">
                      <span
                        aria-hidden="true"
                        className="ml-4 text-sm font-semibold leading-6 text-gray-900"
                      >
                        {user.name}
                      </span>
                      <ChevronDownIcon aria-hidden="true" className="ml-2 h-5 w-5 text-gray-400" />
                    </span>
                  </MenuButton>
                  <MenuItems
                    transition
                    className="absolute right-0 z-10 mt-2.5 w-32 origin-top-right rounded-md bg-white py-2 shadow-lg ring-1 ring-gray-900/5 transition focus:outline-none data-closed:scale-95 data-closed:transform data-closed:opacity-0 data-enter:duration-100 data-leave:duration-75 data-enter:ease-out data-leave:ease-in"
                  >
                    {userNavigation.map((item) => (
                      <MenuItem key={item.name}>
                        <a
                          href={item.href}
                          className="block px-3 py-1 text-sm leading-6 text-gray-900 data-focus:bg-gray-50"
                        >
                          {item.name}
                        </a>
                      </MenuItem>
                    ))}
                  </MenuItems>
                </Menu>
              </div>
            </div>
          </div>

          <main>
            {children}
          </main>
        </div>
      </div>
  )
}
