// src/app/(styled)/layout.js
import { Inter } from 'next/font/google'
import './globals.css'
//import PageAnimatePresence from '@components/HOC/PageAnimatePresence'
import { classNames } from '@src/utils'
import { fileServerURLWithPrefixPath, siteDescription, siteTitle } from '@src/utils/config'
import { lazy, Suspense } from 'react'
import { connection } from 'next/server'
import ClientProviders from '@components/providers/ClientProviders'
import ServerStatusBanner from '@components/system/ServerStatusBanner'
import TVLayout from '@components/HOC/TVLayout'
import GeneralLayout from '@components/HOC/GeneralLayout'
import MovieLayout from '@components/HOC/MovieLayout'

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

export default async function styledLayout({ children }) {
  await connection()
  const posterCollage = fileServerURLWithPrefixPath('/poster_collage.jpg')
  
  return (
    <Suspense>
      <ClientProviders>
        <div
          className={classNames(inter.className, `transition-colors duration-1000`)}
        >
          <Suspense>
            <ServerStatusBanner />
          </Suspense>
          <Suspense>
            <GeneralLayout posterCollage={posterCollage} />
          </Suspense>
          <Suspense>
            <TVLayout posterCollage={posterCollage} />
          </Suspense>
          <Suspense>
            <MovieLayout posterCollage={posterCollage} />
          </Suspense>
          {children}
        </div>
      </ClientProviders>
    </Suspense>
  )
}
