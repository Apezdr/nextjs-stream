'use client'
// src/app/(styled)/device/device-auth-client.tsx
// Handles the interactive parts of the RFC 8628 device authorization page.
import { useState } from 'react'
import { authClient } from '@src/lib/auth-client'
import { normalizeAuthCallbackURL } from '@src/utils/authCallbackUrl'
import { useDeviceApproval } from '@src/hooks/useDeviceApproval'
import { useRouter } from 'next/navigation'

interface DeviceAuthClientProps {
  userCode?: string          // Pre-filled when user scanned verification_uri_complete
  isAuthenticated: boolean
  user: { name: string; email: string; image: string } | null
}

// Validate device code format (exactly 8 uppercase alphanumeric characters, e.g. "ABCDEFGH")
const isValidCodeFormat = (code: string): boolean => /^[A-Z0-9]{8}$/.test(code.trim())

export default function DeviceAuthClient({
  userCode: initialUserCode,
  isAuthenticated,
  user,
}: DeviceAuthClientProps) {
  const [userCode, setUserCode] = useState(initialUserCode ?? '')
  // Continue claims the code and loads which app is asking; Approve comes after
  // (src/hooks/useDeviceApproval.js)
  const { phase, request, error, review, approve, deny, reset } = useDeviceApproval()
  const router = useRouter()
  const success = phase === 'approved'
  const denied = phase === 'denied'
  const reviewing = phase === 'reviewing'
  const approving = phase === 'approving'
  const denying = phase === 'denying'

  const startOver = () => {
    reset()
    setUserCode('')
    router.push('/device')
  }

  const handleSignIn = (provider: string) => {
    const callbackUrl = userCode
      ? `/device?user_code=${encodeURIComponent(userCode)}`
      : '/device'
    const normalizedCallbackUrl = normalizeAuthCallbackURL(callbackUrl, '/device')
    authClient.signIn.social({ provider: provider as 'google' | 'discord', callbackURL: normalizedCallbackUrl })
  }

  if (success) {
    return (
      <div style={styles.successContainer}>
        <div style={styles.successIcon}>✓</div>
        <h2 style={styles.successTitle}>Device Approved!</h2>
        <p style={styles.successText}>
          Your device is now signed in. This page can be closed.
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
        <button onClick={startOver} style={{ ...styles.button, ...styles.approveButton, marginTop: '16px' }}>
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

      {request ? (
        // The request as the server recorded it: approve only your own app's
        <div style={styles.requestCard}>
          <p style={styles.approveText}>
            <strong>{request.clientName ?? `An app this server doesn't recognize (${request.clientId})`}</strong>{' '}
            is asking to sign in to your account.
          </p>
          <p style={styles.requestCode}>{request.userCode}</p>
          {request.scope && <p style={styles.requestScope}>Access requested: {request.scope}</p>}
          <p style={styles.requestWarning}>
            Approve only if this code is showing right now on a device you have. If you didn&apos;t start this, deny it.
          </p>
        </div>
      ) : (
        // Allow manual code entry if not pre-filled from QR
        !initialUserCode && (
          <div style={styles.codeInputWrapper}>
            <label style={styles.codeLabel}>Enter the code shown on your device</label>
            <input
              type="text"
              value={userCode}
              onChange={(e) => setUserCode(e.target.value.toUpperCase())}
              placeholder="ABCDEFGH"
              style={styles.codeInput}
              maxLength={8}
            />
          </div>
        )
      )}

      {!request && initialUserCode && (
        <p style={styles.approveText}>
          Sign in to your device with this account? Check the request first.
        </p>
      )}

      {error && <div style={styles.errorContainer}><p style={styles.errorText}>{error}</p></div>}

      <div style={styles.buttonContainer}>
        {error === 'Device code has expired' ? (
          <button onClick={startOver} style={{ ...styles.button, ...styles.approveButton }}>
            Enter New Code
          </button>
        ) : request ? (
          <>
            <button
              onClick={approve}
              disabled={approving || denying || !request.clientName}
              style={{
                ...styles.button,
                ...styles.approveButton,
                ...((approving || denying || !request.clientName) ? styles.buttonDisabled : {})
              }}
            >
              {approving ? 'Approving…' : 'Approve Device'}
            </button>
            <button
              onClick={deny}
              disabled={approving || denying}
              style={{ ...styles.button, ...styles.denyButton, ...((approving || denying) ? styles.buttonDisabled : {}) }}
            >
              {denying ? 'Denying…' : 'Deny'}
            </button>
          </>
        ) : (
          <button
            onClick={() => review(userCode)}
            disabled={reviewing || !isValidCodeFormat(userCode)}
            style={{
              ...styles.button,
              ...styles.approveButton,
              ...((reviewing || !isValidCodeFormat(userCode)) ? styles.buttonDisabled : {})
            }}
          >
            {reviewing ? 'Checking…' : 'Continue'}
          </button>
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
  requestCard: { textAlign: 'left' as const, marginBottom: '16px', padding: '16px', border: '1px solid #e2e8f0', borderRadius: '8px' },
  requestCode: { fontSize: '24px', letterSpacing: '4px', fontFamily: 'monospace', textAlign: 'center' as const, color: '#111', margin: '0 0 12px 0' },
  requestScope: { fontSize: '14px', color: '#555', margin: '0 0 12px 0' },
  requestWarning: { fontSize: '13px', color: '#9b2c2c', margin: '0', lineHeight: '1.4' },
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
