'use client'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import { SystemStatusProvider } from '@src/contexts/SystemStatusContext'
import { NotificationProvider } from '@src/contexts/NotificationContext'

export default function Template({ children }) {
  return (
    <SystemStatusProvider>
      <NotificationProvider>
        {/* The page's fade-in is a CSS animation, not a framer-motion one. This
            <main> wraps every page in the app, and as a motion component with
            initial="hidden" it was server-rendered at opacity 0: the whole
            page, prerendered skeleton included, stayed invisible until the
            JavaScript had loaded and hydrated, and then took 0.85 s to fade in.
            See the keyframes in tailwind.config.js. motion-safe: people who ask
            for reduced motion get the page with no fade at all. */}
        <main className="motion-safe:animate-page-enter">
          <ToastContainer stacked />
          {children}
        </main>
      </NotificationProvider>
    </SystemStatusProvider>
  )
}
