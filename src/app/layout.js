import { Inter } from 'next/font/google'
import './globals.css'
//import PageAnimatePresence from '@components/HOC/PageAnimatePresence'
import TVLayout from '@components/HOC/TVLayout'
import GeneralLayout from '@components/HOC/GeneralLayout'
import { classNames } from 'src/utils'
import { fileServerURLWithPrefixPath, siteDescription, siteTitle } from 'src/utils/config'

const inter = Inter({ subsets: ['latin'] })

export const metadata = {
  title: siteTitle,
  description: siteDescription,
  openGraph: {
    images: fileServerURLWithPrefixPath + `/poster_collage.jpg`,
  },
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={classNames(inter.className, `bg-blue-500 transition-colors duration-1000`)}
        id="page-container"
      >
        {process.env.NODE_ENV === 'development' && (
          <div className="w-screen relative">
            <div
              className="-translate-x-2/4 left-[50%] fixed uppercase select-none top-0 h-7 text-xs bg-red-500 text-white flex items-center justify-center z-[11] px-12 py-4 mx-auto rounded-b-xl whitespace-nowrap transition-opacity opacity-30 hover:opacity-100 cursor-help"
              title={
                'Development Mode: \nThe app is undergoing changes, things may not work as expected.'
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
                className="size-4 mr-2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3-4.5 16.5"
                />
              </svg>
              Development Mode
            </div>
          </div>
        )}
        <GeneralLayout fileServerURLWithPrefixPath={fileServerURLWithPrefixPath} />
        <TVLayout fileServerURLWithPrefixPath={fileServerURLWithPrefixPath} />
        {/* <PageAnimatePresence>{children}</PageAnimatePresence> */}
        {children}
      </body>
    </html>
  )
}
