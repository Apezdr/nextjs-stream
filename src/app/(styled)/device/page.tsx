// src/app/(styled)/device/page.tsx
// Device authorization verification page — RFC 8628.
// TV apps encode verification_uri_complete (which contains user_code) into a QR code.
// The user scans it, lands here, signs in if needed, then approves the device.
// IMPORTANT: Only APPROVED users can authorize devices.
import { connection } from 'next/server'
import { getSession } from '../../../lib/cachedAuth'
import DeviceAuthClient from './device-auth-client'
import NotApproved from './not-approved'

export default async function DevicePage({
  searchParams,
}: {
  searchParams: Promise<{ user_code?: string }>
}) {
  const params = await searchParams
  const userCode = params?.user_code

  // Get fresh session data
  const session = await getSession();

  // Check authentication and approval status
  const isAuthenticated = !!session?.user
  const isApproved = session?.user?.approved ?? false

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Sign in to your TV</h1>
        <p style={styles.subtitle}>
          Approve the device waiting for authorization
        </p>

        {/* Show not-approved message if user is authenticated but not approved */}
        {isAuthenticated && !isApproved ? (
          <NotApproved userName={session.user.name ?? undefined} />
        ) : (
          <DeviceAuthClient
            userCode={userCode}
            isAuthenticated={isAuthenticated}
            user={
              session?.user
                ? {
                    name: session.user.name ?? '',
                    email: session.user.email ?? '',
                    image: session.user.image ?? '',
                  }
                : null
            }
          />
        )}
      </div>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '40px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
    maxWidth: '420px',
    width: '100%',
    textAlign: 'center' as const,
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px',
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '32px',
  },
}
