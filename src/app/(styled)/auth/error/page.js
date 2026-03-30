'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import PendingApprovalPoller from '@src/components/Auth/PendingApprovalPoller'
import { authClient } from '@src/lib/auth-client'

const PulseRing = ({ delay = 0, size = 120 }) => (
  <div
    className="absolute rounded-full"
    style={{
      width: size,
      height: size,
      border: '1px solid rgba(168, 140, 96, 0.3)',
      animation: `pulseOut 3s ease-out ${delay}s infinite`,
    }}
  />
)

const TickMark = ({ angle, length = 6, radius = 52 }) => {
  const rad = (angle * Math.PI) / 180
  const x1 = Math.cos(rad) * radius
  const y1 = Math.sin(rad) * radius
  const x2 = Math.cos(rad) * (radius - length)
  const y2 = Math.sin(rad) * (radius - length)
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke="rgba(168, 140, 96, 0.35)"
      strokeWidth={angle % 90 === 0 ? 1.5 : 0.75}
      strokeLinecap="round"
    />
  )
}

const ClockIcon = () => {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const secondAngle = (seconds % 60) * 6 - 90
  const minuteAngle = ((seconds / 60) % 60) * 6 - 90

  const secRad = (secondAngle * Math.PI) / 180
  const minRad = (minuteAngle * Math.PI) / 180

  return (
    <svg width="110" height="110" viewBox="-55 -55 110 110">
      {Array.from({ length: 60 }, (_, i) => (
        <TickMark key={i} angle={i * 6} length={i % 5 === 0 ? 7 : 3} />
      ))}
      <line
        x1="0"
        y1="0"
        x2={Math.cos(minRad) * 32}
        y2={Math.sin(minRad) * 32}
        stroke="#a88c60"
        strokeWidth="2"
        strokeLinecap="round"
        style={{ transition: 'all 1s linear' }}
      />
      <line
        x1="0"
        y1="0"
        x2={Math.cos(secRad) * 42}
        y2={Math.sin(secRad) * 42}
        stroke="#d4a853"
        strokeWidth="1"
        strokeLinecap="round"
        style={{ transition: 'all 0.3s cubic-bezier(0.4, 2.08, 0.55, 0.44)' }}
      />
      <circle cx="0" cy="0" r="2.5" fill="#d4a853" />
    </svg>
  )
}

const AuthError = () => {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [fadeIn, setFadeIn] = useState(false)
  const [showContent, setShowContent] = useState(false)
  const [hoveredButton, setHoveredButton] = useState(null)
  const [isChecking, setIsChecking] = useState(false)
  const [checkResult, setCheckResult] = useState(null) // 'approved', 'pending', 'error'

  const paramError = searchParams.get('error')
  const error = paramError !== 'APPROVAL_PENDING' ? paramError : ''
  const pendingApproval = paramError === 'APPROVAL_PENDING'

  useEffect(() => {
    requestAnimationFrame(() => setFadeIn(true))
    const contentTimer = setTimeout(() => setShowContent(true), 400)
    return () => {
      clearTimeout(contentTimer)
    }
  }, [])

  const handleCheckStatus = async () => {
    setIsChecking(true)
    setCheckResult(null)
    
    // Ensure minimum 800ms for "Checking..." to prevent jarring state changes
    const minDelay = new Promise(resolve => setTimeout(resolve, 300))
    
    try {
      const [response] = await Promise.all([
        fetch('/api/auth/approval-status'),
        minDelay
      ])
      const data = await response.json()
      
      if (data.approved) {
        setCheckResult('approved')
        // Redirect after a brief moment to show the success message
        setTimeout(() => {
          router.push('/list')
        }, 1500)
      } else {
        setCheckResult('pending')
        // Clear the message after 3 seconds
        setTimeout(() => setCheckResult(null), 3000)
      }
    } catch (err) {
      await minDelay // Ensure minimum delay even on error
      setCheckResult('error')
      // Clear the error message after 3 seconds
      setTimeout(() => setCheckResult(null), 3000)
    } finally {
      setIsChecking(false)
    }
  }

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/')
        },
      },
    })
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-8">
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap"
          rel="stylesheet"
        />
        <div
          className="flex flex-col items-center gap-6 max-w-lg text-center rounded-2xl border px-10 py-12"
          style={{
            background: 'rgba(10, 11, 13, 0.85)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderColor: 'rgba(168, 140, 96, 0.1)',
            boxShadow: '0 8px 40px rgba(0, 0, 0, 0.4)',
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-16 h-16 mx-auto"
            style={{ color: '#d4a853' }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.152c-3.196 0-6.1-1.25-8.25-3.286Zm0 13.036h.008v.008H12v-.008Z"
            />
          </svg>
          <h1
            className="m-0"
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 32,
              fontWeight: 600,
              color: '#e8e0d4',
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
            }}
          >
            Authentication Error
          </h1>
          <p
            className="mt-3.5 m-0"
            style={{
              fontFamily: "'DM Sans', sans-serif",
              fontSize: 15,
              fontWeight: 300,
              color: 'rgba(168, 160, 145, 0.7)',
              lineHeight: 1.6,
            }}
          >
            An error occurred during authentication:
          </p>
          <pre
            className="p-4 rounded-lg border max-w-full overflow-auto"
            style={{
              fontFamily: "'DM Sans', monospace",
              fontSize: 13,
              color: '#d4a853',
              background: 'rgba(168, 140, 96, 0.08)',
              borderColor: 'rgba(168, 140, 96, 0.15)',
            }}
          >
            {error}
          </pre>
          <div className="flex flex-row gap-4 justify-center mt-4">
            <Link href="/list">
              <button
                type="button"
                className="rounded-lg cursor-pointer transition-all duration-250"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14,
                  fontWeight: 400,
                  color: '#e8e0d4',
                  background:
                    hoveredButton === 'list'
                      ? 'rgba(168, 140, 96, 0.2)'
                      : 'rgba(168, 140, 96, 0.12)',
                  border: `1px solid ${hoveredButton === 'list' ? 'rgba(168, 140, 96, 0.35)' : 'rgba(168, 140, 96, 0.2)'}`,
                  padding: '11px 24px',
                  letterSpacing: '0.02em',
                }}
                onMouseEnter={() => setHoveredButton('list')}
                onMouseLeave={() => setHoveredButton(null)}
              >
                Go to Media List
              </button>
            </Link>
            <Link href="/">
              <button
                type="button"
                className="rounded-lg cursor-pointer transition-all duration-250"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14,
                  fontWeight: 400,
                  color: '#e8e0d4',
                  background:
                    hoveredButton === 'home'
                      ? 'rgba(168, 140, 96, 0.2)'
                      : 'rgba(168, 140, 96, 0.12)',
                  border: `1px solid ${hoveredButton === 'home' ? 'rgba(168, 140, 96, 0.35)' : 'rgba(168, 140, 96, 0.2)'}`,
                  padding: '11px 24px',
                  letterSpacing: '0.02em',
                }}
                onMouseEnter={() => setHoveredButton('home')}
                onMouseLeave={() => setHoveredButton(null)}
              >
                Go to Home
              </button>
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (pendingApproval) {
    return (
      <div
        className="min-h-screen flex items-center justify-center overflow-hidden relative"
        style={{
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=Playfair+Display:ital,wght@0,400;0,600;1,400&display=swap"
          rel="stylesheet"
        />
        <style>{`
          @keyframes pulseOut {
            0% { transform: scale(0.8); opacity: 0.6; }
            100% { transform: scale(2.2); opacity: 0; }
          }
          @keyframes subtleBreathe {
            0%, 100% { opacity: 0.6; }
            50% { opacity: 1; }
          }
        `}</style>

        {/* Dark backdrop card */}
        <div
          className="relative flex flex-col items-center rounded-2xl border px-10 py-14 transition-opacity duration-800"
          style={{
            maxWidth: 480,
            gap: 36,
            opacity: fadeIn ? 1 : 0,
            background: 'rgba(10, 11, 13, 0.85)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            borderColor: 'rgba(168, 140, 96, 0.1)',
            boxShadow: '0 8px 40px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Clock with pulse rings */}
          <div className="relative flex items-center justify-center w-[140px] h-[140px]">
            <PulseRing delay={0} size={110} />
            <PulseRing delay={1} size={110} />
            <PulseRing delay={2} size={110} />
            <ClockIcon />
          </div>

          {/* Text block */}
          <div
            className="transition-all duration-700 text-center"
            style={{
              opacity: showContent ? 1 : 0,
              transform: showContent ? 'translateY(0)' : 'translateY(16px)',
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <h1
              className="m-0"
              style={{
                fontFamily: "'Playfair Display', serif",
                fontSize: 32,
                fontWeight: 600,
                color: '#e8e0d4',
                letterSpacing: '-0.01em',
                lineHeight: 1.2,
              }}
            >
              Awaiting Approval
            </h1>
            <p
              className="mt-3.5 mx-auto max-w-[340px]"
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 15,
                fontWeight: 300,
                color: 'rgba(168, 160, 145, 0.7)',
                lineHeight: 1.6,
                margin: '14px 0 0',
              }}
            >
              Your account has been created. An admin needs to approve your access before you can
              browse the library.
            </p>
          </div>

          {/* Status pill - now from PendingApprovalPoller */}
          <div
            className="transition-all duration-700"
            style={{
              opacity: showContent ? 1 : 0,
              transform: showContent ? 'translateY(0)' : 'translateY(12px)',
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
              transitionDelay: '0.15s',
            }}
          >
            <PendingApprovalPoller />
          </div>

          {/* Divider */}
          <div
            className="w-10 h-px transition-opacity duration-700"
            style={{
              background: 'rgba(168, 140, 96, 0.15)',
              opacity: showContent ? 1 : 0,
              transitionDelay: '0.3s',
            }}
          />

          {/* Actions */}
          <div
            className="flex flex-col items-center transition-all duration-700"
            style={{
              gap: 12,
              opacity: showContent ? 1 : 0,
              transform: showContent ? 'translateY(0)' : 'translateY(12px)',
              transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
              transitionDelay: '0.3s',
            }}
          >
            <div className="flex flex-col items-center" style={{ gap: 8, width: '100%' }}>
              <button
                type="button"
                onClick={handleCheckStatus}
                disabled={isChecking || checkResult !== null}
                className="rounded-lg transition-all duration-250"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 14,
                  fontWeight: 400,
                  color: '#e8e0d4',
                  background:
                    hoveredButton === 'check' && !isChecking && checkResult === null
                      ? 'rgba(168, 140, 96, 0.2)'
                      : 'rgba(168, 140, 96, 0.12)',
                  border: `1px solid ${hoveredButton === 'check' && !isChecking && checkResult === null ? 'rgba(168, 140, 96, 0.35)' : 'rgba(168, 140, 96, 0.2)'}`,
                  padding: '11px 32px',
                  letterSpacing: '0.02em',
                  opacity: isChecking || checkResult !== null ? 0.6 : 1,
                  cursor: isChecking || checkResult !== null ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={() => !isChecking && checkResult === null && setHoveredButton('check')}
                onMouseLeave={() => setHoveredButton(null)}
              >
                {isChecking ? 'Checking...' : 'Check Status'}
              </button>

              {/* Status feedback message - using Activity pattern with fixed height */}
              <div
                className="text-center overflow-hidden transition-all duration-300"
                style={{
                  fontFamily: "'DM Sans', sans-serif",
                  fontSize: 13,
                  height: checkResult ? 24 : 0,
                  opacity: checkResult ? 1 : 0,
                  transform: checkResult ? 'translateY(0)' : 'translateY(-8px)',
                }}
              >
                {checkResult === 'approved' && (
                  <p style={{ color: '#4ade80', margin: 0, lineHeight: '24px' }}>
                    ✓ Approved! Redirecting...
                  </p>
                )}
                {checkResult === 'pending' && (
                  <p style={{ color: '#a88c60', margin: 0, lineHeight: '24px' }}>
                    Still pending approval
                  </p>
                )}
                {checkResult === 'error' && (
                  <p style={{ color: 'rgba(239, 68, 68, 0.8)', margin: 0, lineHeight: '24px' }}>
                    Unable to check status
                  </p>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleSignOut}
              className="cursor-pointer transition-colors duration-250 bg-transparent border-none"
              style={{
                fontFamily: "'DM Sans', sans-serif",
                fontSize: 13,
                fontWeight: 300,
                color:
                  hoveredButton === 'signout'
                    ? 'rgba(168, 160, 145, 0.7)'
                    : 'rgba(168, 160, 145, 0.45)',
                padding: '8px 16px',
              }}
              onMouseEnter={() => setHoveredButton('signout')}
              onMouseLeave={() => setHoveredButton(null)}
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    )
  }

  return null
}

export default AuthError