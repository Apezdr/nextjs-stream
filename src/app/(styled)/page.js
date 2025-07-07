const dynamic = 'force-dynamic'
import Link from 'next/link'
import { auth } from '../../lib/auth'
import SignOutButton from '@components/SignOutButton'
import SignInButtonsWrapper from '@components/SignInButtonsWrapper'
import ServerStatus from '@components/Login/Status'
import { getServerConfig } from '../api/getserverconfig/config'
import { buildURL } from '@src/utils'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import AnimatedBackground from '@components/Landing/AnimatedBackground'
import { AnimatedHeading } from '@components/Landing/AnimatedText'

const variants = {
  hidden: { opacity: 0, x: 0, y: -60 },
  enter: { opacity: 1, x: 0, y: 0 },
}

export default async function Home() {
  let { server } = getServerConfig();
  let _serverStatus = null;
  let error = null;
  try {
    _serverStatus = await fetch(buildURL(`/api/status`), { cache: 'no-store' });
    _serverStatus = await _serverStatus.json();
  } catch (error) {
    console.error('Error fetching server status:', error);
    _serverStatus = { ok: false }; // Set to a default value if there's an error
  }

  let session = null;
  if (_serverStatus?.ok) {
    session = await auth();
  }

  return (
    <PageContentAnimatePresence
      _key={'ReleaseCalendar-Container-AnimationCont'}
      variants={variants}
      transition={{
        type: 'linear',
        duration: 0.45,
        delay: 0.3,
      }}
    >
      <main className="sm:mx-auto sm:max-w-7xl sm:px-6 lg:px-8">
        <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
          <div className="mx-auto w-full sm:w-auto sm:max-w-7xl py-24 sm:px-6 sm:py-32 lg:px-8">
            <div className="relative isolate overflow-hidden bg-gray-900 px-6 py-24 text-center shadow-2xl sm:rounded-3xl sm:px-16">
              <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
                Movies/TV at your fingertips.
              </h2>
              <div className="mt-10 flex flex-col items-center justify-center gap-x-6">
                {session ? (
                  <>
                    <span className="mb-2">View our catalog of media.</span>
                    <Link
                      href="/list"
                      className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={1.5}
                        stroke="currentColor"
                        className="w-6 h-6"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zM3.75 12h.007v.008H3.75V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm-.375 5.25h.007v.008H3.75v-.008zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
                        />
                      </svg>
                      View media catalog
                    </Link>
                    <hr className="h-px my-8 bg-gray-200 border-0 dark:bg-gray-700 w-2/4" />
                    <span className="mb-2 text-gray-400">
                      Take a break, we&apos;ll be here when you get back.
                    </span>
                    <SignOutButton />
                  </>
                ) : (
                  <>
                    <span className="mb-2">To view our catalog of media, please sign in.</span>
                    <SignInButtonsWrapper />
                  </>
                )}
              </div>
              <AnimatedBackground />
              {_serverStatus?.ok ? null : ServerStatus({ _serverStatus })}
            </div>
          </div>
        </div>
      </main>
    </PageContentAnimatePresence>
  )
}
