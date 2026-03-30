import Image from 'next/image'
import Link from 'next/link'
import NotFoundContent from '@src/components/MediaPages/DynamicPage/errors/NotFoundContent'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
      <div className="w-full max-w-4xl rounded-2xl border border-white/10 bg-black/30 p-6 backdrop-blur sm:p-8">
        <div className="grid items-center gap-8 md:grid-cols-[280px_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[280px]">
            <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
              <Image
                src="/Confused-Pup.png"
                alt="Missing media route"
                width={278}
                height={278}
                className="h-auto w-full object-cover"
                priority
              />
            </div>
          </div>

          <div className="text-center md:text-left">
            <p className="text-sm font-medium uppercase tracking-wide text-indigo-300">404 • Not Found</p>
            <h1 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">This media route doesn&apos;t exist</h1>
            <div className="mt-2 md:text-left">
              <NotFoundContent
                errorMessage="The URL doesn&apos;t match a known movie or TV route pattern."
                backHref="/list"
                backText="Browse Content"
              />
            </div>

            <div className="mt-5 flex items-center justify-center gap-4 text-sm">
              <Link href="/list/movie" className="text-indigo-300 transition-colors hover:text-indigo-200">
                Browse Movies
              </Link>
              <span className="text-white/30">•</span>
              <Link href="/list/tv" className="text-indigo-300 transition-colors hover:text-indigo-200">
                Browse TV Shows
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
