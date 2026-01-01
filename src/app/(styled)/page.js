import { Suspense } from 'react'
import PageContentAnimatePresence from '@components/HOC/PageContentAnimatePresence'
import AnimatedBackground from '@components/Landing/AnimatedBackground'
import { AnimatedHeading } from '@components/Landing/AnimatedText'
import ServerStatusCheck from '@components/Login/ServerStatusCheck'

const variants = {
  hidden: { opacity: 0, x: 0, y: -60 },
  enter: { opacity: 1, x: 0, y: 0 },
}

export default function Home() {
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
              {/* Container for login box */}
              <div className="mt-10 flex flex-col items-center justify-center gap-x-6">
                {/* Suspense boundary for dynamic content */}
                <Suspense fallback={
                  <div className="flex flex-col items-center gap-2">
                    <span className="mb-2 animate-pulse">Loading...</span>
                  </div>
                }>
                  <ServerStatusCheck />
                </Suspense>
              </div>
              <AnimatedBackground />
            </div>
          </div>
        </div>
      </main>
    </PageContentAnimatePresence>
  )
}
