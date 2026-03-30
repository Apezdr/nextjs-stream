'use client'
// src/app/(styled)/device/device-auth-client.tsx
// Handles the interactive parts of the RFC 8628 device authorization page.
import { useState } from 'react'
import { authClient } from '@src/lib/auth-client'
import { useRouter } from 'next/navigation'

interface DeviceAuthClientProps {
  userCode?: string          // Pre-filled when user scanned verification_uri_complete
  isAuthenticated: boolean
  user: { name: string; email: string; image: string } | null
}

export default function DeviceAuthClient({
  userCode: initialUserCode,
  isAuthenticated,
  user,
}: DeviceAuthClientProps) {
  const [userCode, setUserCode] = useState(initialUserCode ?? '')
  const [approving, setApproving] = useState(false)
  const [denying, setDenying] = useState(false)
  const [success, setSuccess] = useState(false)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // Map technical error messages to user-friendly messages
  const mapErrorMessage = (message: string): string => {
    const errorMap: Record<string, string> = {
      'Invalid user code': 'Invalid/expired device code',
      'User code has expired': 'Device code has expired',
      'User code not found': 'Invalid/expired device code',
      'Failed to approve device': 'Failed to approve device request',
      'Failed to deny device': 'Failed to deny device request',
    }
    
    return errorMap[message] || message
  }

  // Validate device code format (exactly 8 uppercase alphanumeric characters)
  const isValidCodeFormat = (code: string): boolean => {
    const trimmedCode = code.trim()
    if (!trimmedCode) return false
    // Match exactly 8 uppercase alphanumeric characters
    // Example: "ABCDEFGH"
    return /^[A-Z0-9]{8}$/.test(trimmedCode)
  }

  const handleApprove = async () => {
    if (!userCode.trim()) {
      setError('Please enter the code shown on your TV.')
      return
    }
    setApproving(true)
    setError(null)
    try {
      const { error: err } = await authClient.device.approve({ userCode: userCode.trim() })
      if (err) throw new Error(err.error_description ?? 'Failed to approve device')
      setSuccess(true)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred'
      setError(mapErrorMessage(errorMessage))
    } finally {
      setApproving(false)
    }
  }

  const handleDeny = async () => {
    setDenying(true)
    setError(null)
    try {
      const { error: err } = await authClient.device.deny({ userCode: userCode.trim() })
      if (err) throw new Error(err.error_description ?? 'Failed to deny device')
      setDenied(true)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An error occurred'
      setError(mapErrorMessage(errorMessage))
    } finally {
      setDenying(false)
    }
  }

  const handleSignIn = (provider: string) => {
    const callbackUrl = userCode
      ? `/device?user_code=${encodeURIComponent(userCode)}`
      : '/device'
    authClient.signIn.social({ provider: provider as 'google' | 'discord', callbackURL: callbackUrl })
  }

  if (success) {
    return (
      <div style={styles.successContainer}>
        <div style={styles.successIcon}>✓</div>
        <h2 style={styles.successTitle}>Device Approved!</h2>
        <p style={styles.successText}>
          Your TV is now signed in. This page can be closed.
        </p>
      </div>
    )
  }

  if (denied) {
    return (
      <div style={styles.successContainer}>
        <div style={{ ...styles.successIcon, color: '#e53e3e' }}>✕</div>
        <h2 style={{ ...styles.successTitle, color: '#e53e3e' }}>Request Denied</h2>
        <p style={styles.successText}>
          The device request was denied.
        </p>
        <button
          onClick={() => {
            setDenied(false)
            setUserCode('')
            setError(null)
            router.push('/device')
          }}
          style={{ ...styles.button, ...styles.approveButton, marginTop: '16px' }}
        >
          Enter New Code
        </button>
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <div>
        <p style={styles.loginText}>Sign in to approve this device:</p>
        {error && <div style={styles.errorContainer}><p style={styles.errorText}>{error}</p></div>}
        <div style={styles.buttonContainer}>
          <button onClick={() => handleSignIn('google')} style={{ ...styles.button, ...styles.googleButton }}>
            Sign in with Google
          </button>
          <button onClick={() => handleSignIn('discord')} style={{ ...styles.button, ...styles.discordButton }}>
            Sign in with Discord
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {user && (
        <div style={styles.userInfo}>
          {user.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt="Profile" style={styles.avatar} />
          )}
          <div>
            <p style={styles.userName}>{user.name}</p>
            <p style={styles.userEmail}>{user.email}</p>
          </div>
        </div>
      )}

      {/* Allow manual code entry if not pre-filled from QR */}
      {!initialUserCode && (
        <div style={styles.codeInputWrapper}>
          <label style={styles.codeLabel}>Enter the code shown on your TV</label>
          <input
            type="text"
            value={userCode}
            onChange={(e) => setUserCode(e.target.value.toUpperCase())}
            placeholder="ABCDEFGH"
            style={styles.codeInput}
            maxLength={8}
          />
        </div>
      )}

      {initialUserCode && (
        <p style={styles.approveText}>
          Do you want to sign in to your TV with this account?
        </p>
      )}

      {error && <div style={styles.errorContainer}><p style={styles.errorText}>{error}</p></div>}

      <div style={styles.buttonContainer}>
        {error === 'Device code has expired' ? (
            <button
              onClick={() => {
                setError(null)
                setUserCode('')
                router.push('/device')
              }}
              style={{ ...styles.button, ...styles.approveButton }}
            >
              Enter New Code
            </button>
        ) : (
          <>
          <button
            onClick={handleApprove}
            disabled={approving || denying || !isValidCodeFormat(userCode)}
            style={{
              ...styles.button,
              ...styles.approveButton,
              ...((approving || denying || !isValidCodeFormat(userCode)) ? styles.buttonDisabled : {})
            }}
          >
            {approving ? 'Approving…' : 'Approve Device'}
          </button>
          <button
            onClick={handleDeny}
            disabled={approving || denying || !isValidCodeFormat(userCode)}
            style={{
              ...styles.button,
              ...styles.denyButton,
              ...((approving || denying || !isValidCodeFormat(userCode)) ? styles.buttonDisabled : {})
            }}
          >
            {denying ? 'Denying…' : 'Deny'}
          </button>
          </>
        )}
      </div>
    </div>
  )
}

const styles = {
  userInfo: { display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px', padding: '16px', backgroundColor: '#f8f9fa', borderRadius: '8px' },
  avatar: { width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' as const },
  userName: { fontSize: '18px', fontWeight: 'bold', color: '#333', margin: '0 0 4px 0' },
  userEmail: { fontSize: '14px', color: '#666', margin: '0' },
  approveText: { fontSize: '16px', color: '#333', marginBottom: '24px', lineHeight: '1.5' },
  loginText: { fontSize: '16px', color: '#333', marginBottom: '24px', lineHeight: '1.5' },
  codeInputWrapper: { marginBottom: '24px', textAlign: 'left' as const },
  codeLabel: { display: 'block', fontSize: '14px', color: '#555', marginBottom: '8px', fontWeight: '500' },
  codeInput: { width: '100%', padding: '12px', fontSize: '24px', letterSpacing: '4px', textAlign: 'center' as const, border: '2px solid #e2e8f0', borderRadius: '8px', fontFamily: 'monospace', boxSizing: 'border-box' as const, color: 'black' },
  buttonContainer: { display: 'flex', flexDirection: 'column' as const, gap: '12px' },
  button: { padding: '12px 24px', borderRadius: '8px', border: 'none', fontSize: '16px', fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s ease', width: '100%' },
  approveButton: { backgroundColor: '#0070f3', color: 'white' },
  denyButton: { backgroundColor: 'transparent', color: '#999', border: '1px solid #e2e8f0' },
  googleButton: { backgroundColor: '#4285f4', color: 'white' },
  discordButton: { backgroundColor: '#5865f2', color: 'white' },
  buttonDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  errorContainer: { backgroundColor: '#fee', border: '1px solid #fcc', borderRadius: '8px', padding: '12px', marginBottom: '16px' },
  errorText: { color: '#c53030', fontSize: '14px', margin: '0' },
  successContainer: { textAlign: 'center' as const },
  successIcon: { fontSize: '48px', color: '#38a169', marginBottom: '16px' },
  successTitle: { fontSize: '24px', fontWeight: 'bold', color: '#38a169', marginBottom: '12px' },
  successText: { fontSize: '16px', color: '#666', lineHeight: '1.5' },
}
