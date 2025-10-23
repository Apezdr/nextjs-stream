'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export default function TVAppsNotificationClient() {
  const [isVisible, setIsVisible] = useState(true)
  const [isBackgroundExiting, setIsBackgroundExiting] = useState(false)
  const [isModalExiting, setIsModalExiting] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [origin, setOrigin] = useState('')
  const [copied, setCopied] = useState(false)
  const [step, setStep] = useState(0) // animates step checkmarks
  const confettiRef = useRef(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOrigin(window.location.origin.replace(/^https?:\/\//, ''))
      // auto-progress the checklist for delight
      setTimeout(() => setStep(1), 400)
      setTimeout(() => setStep(2), 900)
      setTimeout(() => setStep(3), 1400)
    }
  }, [])

  useEffect(() => {
    const onKey = (e) => (e.key === 'Escape' || e.key?.toLowerCase() === 'x') && handleDismiss()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Disable background scrolling and dim content when notification is visible
  useEffect(() => {
    if (isVisible) {
      // Store the current scroll position
      const scrollY = window.scrollY
      
      // Create a style element for dimming background
      const styleElement = document.createElement('style')
      styleElement.id = 'tv-notification-backdrop'
      styleElement.textContent = `
        main > div > main {
          opacity: 0 !important;
          pointer-events: none !important;
          transition: opacity 0.2s ease !important;
        }
        #backdrop-general {
          opacity: 0 !important;
          pointer-events: none !important;
          transition: opacity 0.2s ease !important;
        }
      `
      document.head.appendChild(styleElement)
      
      // Prevent background scrolling
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY}px`
      document.body.style.width = '100%'
      
      return () => {
        // Remove dimming styles
        const style = document.getElementById('tv-notification-backdrop')
        if (style) style.remove()
        
        // Restore scrolling and position
        document.body.style.overflow = ''
        document.body.style.position = ''
        document.body.style.top = ''
        document.body.style.width = ''
        window.scrollTo(0, scrollY)
      }
    }
  }, [isVisible])

  const handleDismiss = () => {
    // Start background fade immediately
    setIsBackgroundExiting(true)
    
    // Remove dimming styles to let background content fade back in
    const style = document.getElementById('tv-notification-backdrop')
    if (style) style.remove()
    
    // Start modal fade 0.8 seconds later
    setTimeout(() => {
      setIsModalExiting(true)
    }, 800)
    
    // Hide component after both animations complete
    setTimeout(() => {
      setIsVisible(false)
    }, 1600) // 800ms + 800ms modal animation
    
    // Background API call to persist dismissal
    startTransition(async () => {
      try {
        await fetch(
          '/api/authenticated/user/preferences/dismiss-tv-apps-notification',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          }
        )
      } catch (e) {
        console.error('Error dismissing TV apps notification:', e)
        // Note: We don't show the notification again on API failure
        // since the user explicitly dismissed it and expects it gone
      }
    })
  }

  const launchConfetti = () => {
    const host = confettiRef.current
    if (!host) return
    host.innerHTML = ''
    const count = 28
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span')
      p.className = 'absolute top-1/2 left-1/2 confetti z-50'
      const angle = Math.random() * 360
      const dist = 250 + Math.random() * 200
      p.style.setProperty('--tx', `${Math.cos(angle) * dist}px`)
      p.style.setProperty('--ty', `${Math.sin(angle) * dist}px`)
      p.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`)
      p.style.setProperty('--dur', `${0.7 + Math.random() * 0.9}s`)
      p.style.setProperty('--scale', `${0.6 + Math.random() * 0.8}`)
      p.style.background = `hsl(${Math.floor(Math.random() * 360)}, 90%, 60%)`
      host.appendChild(p)
      setTimeout(() => p.remove(), 2000)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(origin)
      setCopied(true)
      launchConfetti()
      setTimeout(() => setCopied(false), 1200)
    } catch {}
  }

  if (!isVisible) return null

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[60] text-white" data-tv-notification="true">
        {/* Background Layer */}
        <motion.div
          className="absolute inset-0 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: isBackgroundExiting ? 0 : 1 }}
          transition={{
            duration: isBackgroundExiting ? 0.8 : 0.28,
            ease: isBackgroundExiting ? "easeOut" : "easeOut"
          }}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-600 via-blue-600 to-indigo-700" />
          <div className="absolute -inset-40 blur-3xl opacity-30 bg-[radial-gradient(ellipse_at_top,theme(colors.white/30),transparent_60%)] animate-pulse" />
          {/* stars */}
          <div className="pointer-events-none absolute inset-0">
            {[...Array(42)].map((_, i) => (
              <div
                key={i}
                className="absolute w-1 h-1 bg-white/60 rounded-full"
                style={{
                  top: `${Math.random() * 100}%`,
                  left: `${Math.random() * 100}%`,
                  animation: `floatStar ${6 + Math.random() * 6}s ease-in-out ${Math.random() * 2}s infinite`,
                }}
              />
            ))}
          </div>
        </motion.div>

        {/* Confetti */}
        <div ref={confettiRef} className="pointer-events-none absolute inset-0"></div>

        {/* Modal Content Layer */}
        <motion.div
          className="relative h-full w-full flex items-center justify-center p-4 overflow-y-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: isModalExiting ? 0 : 1 }}
          transition={{
            duration: isModalExiting ? 0.8 : 0.28,
            ease: isModalExiting ? "easeInOut" : "easeOut"
          }}
        >
          <motion.div
            className="w-full max-w-4xl my-8 place-self-start"
            initial={{ y: 16, scale: 0.98, opacity: 0 }}
            animate={{
              y: isModalExiting ? -30 : 0,
              scale: isModalExiting ? 0.85 : 1,
              opacity: isModalExiting ? 0 : 1
            }}
            transition={{
              type: isModalExiting ? 'tween' : 'spring',
              stiffness: 110,
              damping: 16,
              duration: isModalExiting ? 0.7 : undefined,
              ease: isModalExiting ? "easeIn" : undefined
            }}
          >
            <div className="rounded-3xl border border-white/15 bg-white/10 backdrop-blur-xl shadow-2xl p-6 sm:p-10">
              {/* Header */}
              <div className="flex flex-col items-center text-center space-y-5">
                <motion.div
                  aria-hidden
                  className="relative"
                  animate={{ y: [0, -8, 0], rotate: [0, 2, -2, 0] }}
                  transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <div className="grid place-items-center w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white/15 border border-white/20 shadow-lg">
                    <span className="text-4xl sm:text-5xl select-none">🚀</span>
                  </div>
                </motion.div>

                <div>
                  <h3 className="text-3xl sm:text-5xl font-black tracking-tight">
                    Big Screen <span className="text-white/90">Experience</span>
                  </h3>
                  <p className="mt-3 text-white/85 text-base sm:text-lg">
                    Watch your favorites on the TV app—faster pairing, comfy couch vibes, zero tabs.
                  </p>
                </div>
              </div>

              {/* Progress */}
              <div className="mt-7 sm:mt-8 space-y-5">
                <div className="h-2 w-full rounded-full bg-white/15 overflow-hidden">
                  <motion.div
                    className="h-full bg-white/80"
                    initial={{ width: '0%' }}
                    animate={{
                      width: step === 0 ? '0%' : step === 1 ? '34%' : step === 2 ? '67%' : '100%',
                    }}
                    transition={{ duration: 0.6, ease: 'easeInOut' }}
                  />
                </div>

                {/* Steps */}
                <div className="grid gap-4 sm:grid-cols-3">
                  {[
                    { t: 'Install the TV app', sub: 'Google Play or Amazon Appstore' },
                    { t: 'Enter this site', sub: origin || 'your-domain.example' },
                    { t: 'Scan & sign in', sub: 'Use your phone QR' },
                  ].map((s, i) => {
                    const done = step >= i + 1
                    return (
                      <motion.div
                        key={i}
                        className="rounded-2xl border border-white/15 bg-white/10 p-4"
                        initial={{ y: 10, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        transition={{ delay: 0.12 * i }}
                      >
                        <div className="flex items-center gap-3">
                          <motion.div
                            className={`w-8 h-8 grid place-items-center rounded-full font-bold ${
                              done
                                ? 'bg-emerald-400/90 text-emerald-950'
                                : 'bg-white/20 text-white/90'
                            }`}
                            initial={{ scale: 0.8 }}
                            animate={{ scale: done ? 1 : 0.95 }}
                            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                          >
                            {done ? '✔' : i + 1}
                          </motion.div>
                          <div className="min-w-0">
                            <div className="font-semibold leading-tight">{s.t}</div>
                            <div className="text-white/80 text-sm leading-tight">
                              {s.sub}
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    )
                  })}
                </div>
              </div>

              {/* Optional QR (no deps) */}
              {origin && (
                <div className="mt-6 flex items-center justify-center">
                  <div className="flex items-center gap-3 rounded-2xl border border-white/15 bg-white/10 p-3">
                    <img
                      alt="QR to site"
                      className="h-16 w-16 sm:h-20 sm:w-20 rounded-md bg-white"
                      // lightweight QR service; replace with your own if needed
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent('https://' + origin)}`}
                    />
                    <div className="text-left">
                      <div className="text-sm text-white/80">Quick pair with your phone</div>
                      {/* Copy site */}
                      <div className="font-semibold truncate max-w-[220px] sm:max-w-[300px]">
                        {/* Copy site */}
                        <button onClick={handleCopy} className="btn-ghost flex gap-1">
                          <span className="label">
                            {copied ? 'Copied!' : origin || 'your-domain.example'}
                          </span>
                          <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M16 1H4c-1.1 0-2 .9-2 2v12h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Store buttons row */}
              <div className="mt-6 sm:mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                {/* Google Play */}
                <a
                  href="https://play.google.com/store/apps/details?id=com.anonymous.nextjsstreamtvmobile"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-store flex flex-col items-center"
                >
                  <img
                    src="/Google_Play_Store_logo.svg"
                    alt="Google Play Store"
                    className="h-6 w-auto shrink-0"
                  />
                  <span className="label text-[0.65rem]">Get it on Google Play</span>
                </a>

                {/* Amazon */}
                <a
                  href="https://www.amazon.com/dp/B0FMJ1MY4W"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-store flex flex-col items-center"
                >
                  <img
                    src="/Amazon-appstore-logo.svg"
                    alt="Amazon Appstore"
                    className="h-6 w-auto shrink-0"
                  />
                  <span className="label text-sm">Amazon Appstore</span>
                </a>

                {/* Dismiss */}
                <button
                  onClick={handleDismiss}
                  disabled={isPending}
                  aria-label="Dismiss notification"
                  className="btn-icon absolute right-12 bottom-7 transition-colors duration-700 rounded-xl hover:text-gray-400"
                >
                  <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                  </svg>
                </button>
              </div>

              <p className="mt-4 text-center text-white/70 text-sm">
                Pro tip: Press <span className="px-1 rounded bg-white/20">Esc</span> or{' '}
                <span className="px-1 rounded bg-white/20">X</span> to close.
              </p>
            </div>
          </motion.div>
        </motion.div>
      </div>

        {/* local styles */}
        <style jsx global>{`
          @keyframes floatStar {
            0%,
            100% {
              transform: translateY(0) scale(1);
              opacity: 0.65;
            }
            50% {
              transform: translateY(-8px) scale(1.15);
              opacity: 1;
            }
          }
          .confetti {
            width: 10px;
            height: 10px;
            border-radius: 2px;
            transform: translate(-50%, -50%);
            animation: confettiPop var(--dur) ease-out forwards;
            opacity: 0.95;
          }
          @keyframes confettiPop {
            from {
              transform: translate(-50%, -50%) rotate(0deg) scale(var(--scale));
              opacity: 1;
            }
            to {
              transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty)))
                rotate(var(--rot)) scale(0.9);
              opacity: 0;
            }
          }
        `}</style>

        {/* utility classes for buttons (avoid overflow) */}
        <style jsx>{`
          .btn-store {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 0.75rem 1rem;
            border-radius: 0.75rem;
            border: 1px solid rgba(255, 255, 255, 0.3);
            background: rgba(255, 255, 255, 0.95);
            color: #1f2a62;
            box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
            transition:
              box-shadow 0.2s ease,
              transform 0.06s ease,
              background 0.2s ease;
            max-width: 100%;
            min-width: 200px; /* gives room so text doesn’t squish */
            white-space: nowrap;
          }
          .btn-store:hover {
            box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
          }
          .btn-store:active {
            transform: translateY(1px);
          }
          .btn-store .label {
            display: inline-block;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 220px; /* prevents spill */
          }

          .btn-ghost {
            display: inline-flex;
            align-items: center;
            gap: 10px;
            padding: 0.75rem 1rem;
            border-radius: 0.75rem;
            border: 1px solid rgba(255, 255, 255, 0.35);
            background: rgba(255, 255, 255, 0.12);
            color: white;
            transition:
              background 0.2s ease,
              transform 0.06s ease;
            max-width: 100%;
            min-width: 200px;
            white-space: nowrap;
          }
          .btn-ghost:hover {
            background: rgba(255, 255, 255, 0.2);
          }
          .btn-ghost .label {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            max-width: 220px;
          }

          .btn-icon {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 44px;
            height: 44px;
            border-radius: 9999px;
            border: 1px solid rgba(255, 255, 255, 0.35);
            background: rgba(255, 255, 255, 0.12);
            transition:
              transform 0.12s ease,
              background 0.2s ease;
          }
          .btn-icon:hover {
            background: rgba(255, 255, 255, 0.22);
            transform: rotate(90deg);
          }
        `}</style>
    </AnimatePresence>
  )
}
