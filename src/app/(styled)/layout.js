const dynamic = 'force-dynamic'
import { Inter } from 'next/font/google'
import './globals.css'
//import PageAnimatePresence from '@components/HOC/PageAnimatePresence'
import { classNames } from '@src/utils'
import { fileServerURLWithPrefixPath, siteDescription, siteTitle } from '@src/utils/config'
import { lazy } from 'react'

const ServerStatusBanner = lazy(() => import('@components/system/ServerStatusBanner'))
const TVLayout = lazy(() => import('@components/HOC/TVLayout'))
const GeneralLayout = lazy(() => import('@components/HOC/GeneralLayout'))
const MovieLayout = lazy(() => import('@components/HOC/MovieLayout'))

const inter = Inter({ subsets: ['latin'] })
const posterCollage = fileServerURLWithPrefixPath(`/poster_collage.jpg`)

export const metadata = {
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    images: posterCollage,
  },
}

export default function styledLayout({ children }) {
  return (
    <div
      className={classNames(inter.className, `transition-colors duration-1000`)}
    >
      <ServerStatusBanner />
      <GeneralLayout posterCollage={posterCollage} />
      <TVLayout posterCollage={posterCollage} />
      <MovieLayout posterCollage={posterCollage} />
      {children}
    </div>
  )
}
