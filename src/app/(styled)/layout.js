import { Inter } from 'next/font/google'
import './globals.css'
//import PageAnimatePresence from '@components/HOC/PageAnimatePresence'
import { classNames } from '@src/utils'
import { fileServerURLWithPrefixPath, siteDescription, siteTitle } from '@src/utils/config'
import { lazy } from 'react'

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

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={classNames(inter.className, `bg-blue-500 transition-colors duration-1000`)}
        id="page-container"
      >
        <GeneralLayout posterCollage={posterCollage} />
        <TVLayout posterCollage={posterCollage} />
        <MovieLayout posterCollage={posterCollage} />
        {children}
      </body>
    </html>
  )
}
