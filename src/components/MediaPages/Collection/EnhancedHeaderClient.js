// Enhanced Collection Header Client Component
// Phase 4: Progressive Enhancement - Adds animations and interactivity to static header

'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'

/**
 * ExpandableText - shows a truncated preview with "Read more" and animates expansion.
 */
function ExpandableText({ text, collapseAfter = 300 }) {
  const [expanded, setExpanded] = useState(false)
  const hasOverflow = useMemo(() => text.length > collapseAfter, [text, collapseAfter])

  return (
    <motion.div layout="size" className="max-w-3xl relative">
      <motion.div
        layout="size"
        initial={false}
        className={`relative p-2 ${expanded ? "overflow-hidden rounded-2xl" : ""}`}
      >
        {/* Glow pulse when expanded */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="glow"
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{
                background: 'linear-gradient(90deg, rgba(167,139,250,0.2), rgba(129,140,248,0.2))'
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              transition={{
                animate: { duration: 0.6, delay: 0.8 },
                exit: { duration: 0.3 }
              }}
            />
          )}
        </AnimatePresence>

        <motion.p
          layout="position"
          className={`text-lg leading-relaxed relative z-10 transition-colors duration-500 ${
            !expanded && hasOverflow ? 'line-clamp-3' : ''
          }`}
        >
          {text}
        </motion.p>
      </motion.div>

      {hasOverflow && (
        <div className="mt-4">
          <motion.button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="relative inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full bg-gray-900/80 backdrop-blur-sm border border-indigo-400/30 hover:bg-indigo-900/50 transition-all duration-300 text-indigo-400 hover:text-indigo-300"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            layout
          >
            <span>{expanded ? 'Show less' : 'Read more'}</span>
            <motion.svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              animate={{ rotate: expanded ? 180 : 0, scale: expanded ? 1.1 : 1 }}
              transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </motion.svg>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  key="pulse"
                  className="absolute inset-0 rounded-full"
                  aria-hidden="true"
                  initial={{ scale: 1, opacity: 0.4 }}
                  animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.7, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    background: 'radial-gradient(circle at 30% 50%, rgba(167,139,250,0.2), transparent 60%), radial-gradient(circle at 70% 50%, rgba(129,140,248,0.2), transparent 60%)'
                  }}
                />
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      )}
    </motion.div>
  )
}

// Enhanced Collection Header with Progressive Enhancement
export default function EnhancedHeaderClient({ collection, isHydrated }) {
  const { name, overview, backdrop, ownershipStats } = collection

  // *** VERCEL BEST PRACTICE: component-purity ***
  // Generate stable deterministic values that don't change on re-render
  const particleProps = useMemo(() => 
    Array.from({ length: 20 }, (_, i) => ({
      left: (i * 347 % 100), // Pseudo-random but deterministic
      top: (i * 521 % 100), 
      delay: (i * 0.5 % 5),
      duration: 15 + (i * 0.7 % 10)
    })), []
  )

  // *** VERCEL BEST PRACTICE: rendering-hydration-no-flicker ***
  // Track mounting state for hydration-safe animations
  const [mounted, setMounted] = useState(false)
  
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true) // Legitimate use case: hydration-safe mounting detection
  }, [])

  // Style injection effect
  useEffect(() => {
    // Add global styles for animations
    const styleId = 'collection-header-animations'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.innerHTML = `
        @keyframes fade-in-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        @keyframes slow-zoom {
          0%, 100% { transform: scale(1.1); }
          50% { transform: scale(1.15); }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0) translateX(0); }
          33% { transform: translateY(-10px) translateX(5px); }
          66% { transform: translateY(5px) translateX(-5px); }
        }

        .animate-fade-in-up {
          animation: fade-in-up 0.6s ease-out forwards;
        }

        .animate-slow-zoom {
          animation: slow-zoom 20s ease-in-out infinite;
        }

        .animate-float {
          animation: float 15s ease-in-out infinite;
        }

        .animation-delay-100 { animation-delay: 100ms; }
        .animation-delay-200 { animation-delay: 200ms; }

        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      `
      document.head.appendChild(style)
    }

    return () => {
      const existingStyle = document.getElementById(styleId)
      if (existingStyle) {
        existingStyle.remove()
      }
    }
  }, [])

  return (
    <div className="relative min-h-96">
      {/* Enhanced Animated Backdrop */}
      {backdrop && (
        <>
          <div className="absolute inset-0 overflow-hidden">
            <Image
              src={backdrop}
              alt={`${name} backdrop`}
              fill
              className={`object-cover transform scale-110 ${mounted ? 'animate-slow-zoom' : ''} lg:!h-fit`}
              priority
              sizes="100vw"
            />
            {/* Multiple gradient overlays for depth */}
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/50 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-gray-950/50 via-transparent to-gray-950/50" />
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-gray-950 to-transparent" />
          </div>

          {/* Animated particles overlay - only after hydration */}
          {mounted && (
            <div className="absolute inset-0 overflow-hidden">
              {particleProps.map((particle, i) => (
                <div
                  key={i}
                  className="absolute w-1 h-1 bg-white/20 rounded-full animate-float"
                  style={{
                    left: `${particle.left}%`,
                    top: `${particle.top}%`,
                    animationDelay: `${particle.delay}s`,
                    animationDuration: `${particle.duration}s`
                  }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Header Content with Enhanced Animations */}
      <div className="relative min-h-96 flex items-end">
        <div className="w-full px-4 md:px-8 py-6 pt-24 pb-8">
          <div className="max-w-7xl mx-auto">
            {/* Enhanced Breadcrumb */}
            <motion.nav 
              className={`mb-6 ${backdrop ? "mb-32" : "mb-6"} ${mounted ? 'animate-fade-in-up' : ''}`}
              initial={mounted ? { opacity: 0, y: 20 } : false}
              animate={mounted ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6 }}
            >
              <div className="flex items-center text-sm">
                {/* Enhanced Movies Link */}
                <Link
                  href="/list/movie"
                  className="inline-flex items-center text-indigo-400 hover:text-indigo-300 transition-all duration-300 group"
                >
                  <motion.svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    whileHover={{ x: -2 }}
                    transition={{ duration: 0.2 }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </motion.svg>
                  Movies
                </Link>
                
                <svg className="w-4 h-4 mx-3 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                
                <span className="text-gray-300 font-medium">{name}</span>
              </div>
            </motion.nav>

            <div className="text-center md:text-left">
              {/* Animated Title */}
              <motion.h1 
                className={`font-bold text-white text-4xl md:text-6xl mb-4 ${mounted ? 'animate-fade-in-up' : ''}`}
                initial={mounted ? { opacity: 0, y: 20 } : false}
                animate={mounted ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.1 }}
              >
                {name}
              </motion.h1>

              {/* Enhanced Stats with Animation */}
              <motion.div 
                className={`flex flex-wrap justify-center md:justify-start gap-4 mb-6 ${mounted ? 'animate-fade-in-up animation-delay-100' : ''}`}
                initial={mounted ? { opacity: 0, y: 20 } : false}
                animate={mounted ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                {mounted ? (
                  <>
                    <motion.div 
                      className="bg-gray-800/60 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-700/50 hover:bg-gray-800/80 transition-all duration-300"
                      whileHover={{ scale: 1.05, borderColor: 'rgb(99 102 241 / 0.5)' }}
                    >
                      <span className="text-white font-semibold">{ownershipStats?.total || 0}</span>
                      <span className="text-gray-400 ml-1">Movies</span>
                    </motion.div>

                    <motion.div 
                      className="flex items-center gap-3 bg-gray-800/60 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-700/50 hover:bg-gray-800/80 transition-all duration-300"
                      whileHover={{ scale: 1.05, borderColor: 'rgb(34 197 94 / 0.5)' }}
                    >
                      <span className="text-green-400 font-semibold">
                        {ownershipStats?.owned || 0}/{ownershipStats?.total || 0}
                      </span>
                      <span className="text-gray-400">Available</span>
                    </motion.div>
                  </>
                ) : (
                  <>
                    <div className="bg-gray-800/60 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-700/50">
                      <span className="text-white font-semibold">{ownershipStats?.total || 0}</span>
                      <span className="text-gray-400 ml-1">Movies</span>
                    </div>
                    <div className="flex items-center gap-3 bg-gray-800/60 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-700/50">
                      <span className="text-green-400 font-semibold">
                        {ownershipStats?.owned || 0}/{ownershipStats?.total || 0}
                      </span>
                      <span className="text-gray-400">Available</span>
                    </div>
                  </>
                )}
              </motion.div>

              {/* Enhanced Overview with ExpandableText */}
              {overview && (
                <motion.div
                  className={`max-w-3xl mx-auto md:mx-0 ${mounted ? 'animate-fade-in-up animation-delay-200' : ''}`}
                  initial={mounted ? { opacity: 0, y: 20 } : false}
                  animate={mounted ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.6, delay: 0.3 }}
                >
                  {mounted && isHydrated ? (
                    <ExpandableText text={overview} collapseAfter={300} />
                  ) : (
                    <p className="text-lg leading-relaxed text-gray-300">
                      {overview.length > 300 ? `${overview.substring(0, 300)}...` : overview}
                    </p>
                  )}
                </motion.div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}