import { Inter } from 'next/font/google'
import './tailwind.css'
import { siteDescription, siteTitle } from '@src/utils/config'
import { getServerConfig } from './api/getserverconfig/config'

const inter = Inter({ subsets: ['latin'] })
export async function generateMetadata() {
  try {
    const config = await getServerConfig()
    const { defaultFileServer } = config
    const posterCollage = `${defaultFileServer}poster_collage.jpg`

    return {
      title: siteTitle,
      description: siteDescription,
      openGraph: {
        images: posterCollage,
      },
    }
  } catch (error) {
    console.error('Error generating metadata:', error)
    return {
      title: siteTitle,
      description: siteDescription,
    }
  }
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
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
        {children}
      </body>
    </html>
  )
}
