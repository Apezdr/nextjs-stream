"use cache"

import Image from 'next/image'
import Link from 'next/link'

export default async function NotFound() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070b14] text-white">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.22),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.18),transparent_28%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.03),transparent_30%,rgba(255,255,255,0.02))]" />
        <div className="absolute left-1/2 top-0 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      <div className="relative flex min-h-screen items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <section className="w-full max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.06] shadow-[0_20px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
          <div className="grid items-stretch lg:grid-cols-[420px_minmax(0,1fr)]">
            {/* Left visual panel */}
            <div className="relative flex min-h-[340px] items-center justify-center border-b border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-8 lg:min-h-[520px] lg:border-b-0 lg:border-r">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(129,140,248,0.18),transparent_36%)]" />
              <div className="absolute left-6 top-6 rounded-full border border-indigo-300/20 bg-indigo-400/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.22em] text-indigo-200">
                Lost in the stream
              </div>

              <div className="relative w-full max-w-[300px]">
                <div className="absolute inset-0 rounded-[2rem] bg-indigo-500/20 blur-2xl" />
                <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-black/20 p-5 shadow-2xl">
                  <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/10 to-transparent" />
                  <Image
                    src="/Confused-Pup.png"
                    alt="Confused puppy illustration for missing page"
                    width={360}
                    height={360}
                    className="relative z-10 mx-auto h-auto w-full max-w-[240px] object-contain drop-shadow-[0_16px_30px_rgba(0,0,0,0.45)]"
                    priority
                  />
                </div>

                <div className="absolute -right-3 top-8 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 shadow-xl backdrop-blur-xl">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Error</div>
                  <div className="text-lg font-semibold text-indigo-200">404</div>
                </div>
              </div>
            </div>

            {/* Right content panel */}
            <div className="flex items-center p-8 sm:p-10 lg:p-14">
              <div className="max-w-xl">
                <div className="inline-flex items-center rounded-full border border-indigo-300/15 bg-indigo-400/10 px-3 py-1 text-xs font-medium text-indigo-200">
                  404 · Not Found
                </div>

                <h1 className="mt-5 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                  This page wandered off.
                </h1>

                <p className="mt-4 max-w-lg text-base leading-7 text-white/70 sm:text-lg">
                  The page you requested could not be found. It may have been moved, renamed,
                  or never existed in the first place. Tiny digital goblin behavior.
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <Link
                    href="/"
                    className="inline-flex items-center justify-center rounded-2xl bg-indigo-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-indigo-500/25 transition duration-200 hover:bg-indigo-400"
                  >
                    Go Home
                  </Link>

                  <Link
                    href="/list"
                    className="inline-flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-white/85 transition duration-200 hover:bg-white/10"
                  >
                    Browse Media
                  </Link>
                </div>

                <div className="mt-8 border-t border-white/10 pt-6">
                  <p className="text-sm text-white/45">You can also head straight to:</p>

                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
                    <Link
                      href="/watchlist"
                      className="text-indigo-200 transition-colors hover:text-white"
                    >
                      Watchlist
                    </Link>
                    <span className="hidden text-white/20 sm:inline">•</span>
                    <Link
                      href="/list"
                      className="text-indigo-200 transition-colors hover:text-white"
                    >
                      Library
                    </Link>
                    <span className="hidden text-white/20 sm:inline">•</span>
                    <Link
                      href="/"
                      className="text-indigo-200 transition-colors hover:text-white"
                    >
                      Dashboard
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
