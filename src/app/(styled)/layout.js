// src/app/(styled)/layout.js
import { Inter } from 'next/font/google'
import './globals.css'
//import PageAnimatePresence from '@components/HOC/PageAnimatePresence'
import { classNames } from '@src/utils'
import { fileServerURLWithPrefixPath, siteDescription, siteTitle } from '@src/utils/config'
import { Suspense } from 'react'
import { connection } from 'next/server'
import ClientProviders from '@components/providers/ClientProviders'
import ServerStatusBanner from '@components/system/ServerStatusBanner'
import TVLayout from '@components/HOC/TVLayout'
import GeneralLayout from '@components/HOC/GeneralLayout'
import MovieLayout from '@components/HOC/MovieLayout'
import CastBootstrap from '@components/Cast/CastBootstrap'
import CastPositionMirror from '@components/Cast/CastPositionMirror'
import { getSession } from '@src/lib/cachedAuth'

const inter = Inter({ subsets: ['latin'] })

// Dynamic metadata - evaluated at request time  
export async function generateMetadata() {
  await connection()
  const posterCollage = fileServerURLWithPrefixPath('/poster_collage.jpg')
  
  return {
    title: siteTitle,
    description: siteDescription,
    openGraph: {
      images: [posterCollage],
    },
  }
}

// The two pieces below need values that only exist at REQUEST time: the Docker
// image is built without its environment, so anything read from process.env
// during the build would be baked in wrong. Each waits for a request with
// connection(), inside its own Suspense boundary.
//
// They used to share one connection() at the top of this layout. That made the
// whole app wait: nothing under this layout could be prerendered, so every
// route's shell was empty and no link had anything ready before the click.
// Keep request-time reads in leaves like these, never in the layout body.

/** The three route backdrops; they fall back to the file server's poster collage. */
async function Backdrops() {
  await connection()
  const posterCollage = fileServerURLWithPrefixPath('/poster_collage.jpg')
  return (
    <>
      <Suspense>
        <GeneralLayout posterCollage={posterCollage} />
      </Suspense>
      <Suspense>
        <TVLayout posterCollage={posterCollage} />
      </Suspense>
      <Suspense>
        <MovieLayout posterCollage={posterCollage} />
      </Suspense>
    </>
  )
}

/**
 * Server-only env var, handed to the client so a page with no player can still
 * rejoin a running Cast session — Chrome only resumes a saved session for the
 * SAME receiver id.
 */
async function CastBootstrapFromEnv() {
  await connection()
  return <CastBootstrap receiverId={process.env.CHROMECAST_RECEIVER_ID || null} />
}

/**
 * The Cast position mirror, for the user this document is rendered for: its
 * reports name them, and the server refuses one once the browser's session
 * is someone else's (src/lib/playbackUser.ts). The layout stays across client
 * navigations, so this is the document's user until the next full load.
 */
async function CastPositionMirrorForSession() {
  // Request time only, like the View-as banner: the session check reads the clock
  await connection()
  const session = await getSession()
  return <CastPositionMirror userId={session?.user?.id ?? null} />
}

export default function styledLayout({ children }) {
  return (
    // Safety net only: a page that suspends with no boundary of its own lands
    // here and gets an empty shell instead of failing the build.
    <Suspense>
      <ClientProviders
        castBootstrap={
          <Suspense>
            <CastBootstrapFromEnv />
          </Suspense>
        }
        castMirror={
          <Suspense>
            <CastPositionMirrorForSession />
          </Suspense>
        }
      >
        <div
          className={classNames(inter.className, `transition-colors duration-1000`)}
        >
          <Suspense>
            <ServerStatusBanner />
          </Suspense>
          <Suspense>
            <Backdrops />
          </Suspense>
          {children}
        </div>
      </ClientProviders>
    </Suspense>
  )
}
