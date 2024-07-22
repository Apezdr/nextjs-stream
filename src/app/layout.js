import { Inter } from 'next/font/google'
import './globals.css'
//import PageAnimatePresence from '@components/HOC/PageAnimatePresence'
import TVLayout from '@components/HOC/TVLayout'
import GeneralLayout from '@components/HOC/GeneralLayout'
import { classNames } from 'src/utils'
import { fileServerURL, siteDescription, siteTitle } from 'src/utils/config'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    images: fileServerURL + `/poster_collage.jpg`,
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={classNames(inter.className, `bg-blue-500 transition-colors duration-1000`)}
        id="page-container"
      >
        <GeneralLayout fileServerURL={fileServerURL} />
        <TVLayout fileServerURL={fileServerURL} />
        {/* <PageAnimatePresence>{children}</PageAnimatePresence> */}
        {children}
      </body>
    </html>
  )
}
