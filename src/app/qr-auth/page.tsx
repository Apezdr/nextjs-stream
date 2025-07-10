// src/app/qr-auth/page.tsx
import { auth } from '@src/lib/auth';
import { getQRAuthSession } from '@src/lib/auth';
import { redirect } from 'next/navigation';
import QRAuthClient from './qr-auth-client';

export default async function QRAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ qrSessionId?: string }>
}) {
  const params = await searchParams;
  const qrSessionId = params?.qrSessionId;

  if (!qrSessionId) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.errorTitle}>Invalid QR Code</h1>
          <p style={styles.errorText}>
            This QR code is missing required information. Please try scanning again.
          </p>
        </div>
      </div>
    );
  }

  // Get the QR session details
  const qrSession = await getQRAuthSession(qrSessionId);
  
  if (!qrSession) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.errorTitle}>QR Code Expired</h1>
          <p style={styles.errorText}>
            This QR code has expired or is invalid. Please generate a new QR code on your TV.
          </p>
        </div>
      </div>
    );
  }

  if (qrSession.status !== 'pending') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h1 style={styles.errorTitle}>QR Code Already Used</h1>
          <p style={styles.errorText}>
            This QR code has already been used or is no longer valid. Please generate a new QR code on your TV.
          </p>
        </div>
      </div>
    );
  }

  // Check if user is authenticated
  const session = await auth();

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>TV Sign-In</h1>
        <p style={styles.subtitle}>
          {qrSession.deviceInfo ? (
            <>
              <span className='block'>Sign in to your</span>
              <span className='font-bold'>{qrSession.deviceInfo.brand} {qrSession.deviceInfo.model}</span>
            </>
          ) : (
            <>Sign in to your {qrSession.deviceType} device</>
          )}
        </p>
        {qrSession.deviceInfo && qrSession.deviceInfo.model.indexOf(qrSession.deviceInfo.platform) > -1 && (
          <p style={styles.deviceDetails}>
            Platform: {qrSession.deviceInfo.platform}
          </p>
        )}
        
        <QRAuthClient 
          qrSessionId={qrSessionId}
          isAuthenticated={!!session?.user}
          user={session?.user ? {
            name: session.user.name || '',
            email: session.user.email || '',
            image: session.user.image || ''
          } : null}
        />
      </div>
    </div>
  );
}

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#f8f9fa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif'
  },
  card: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '40px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
    maxWidth: '400px',
    width: '100%',
    textAlign: 'center' as const
  },
  title: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '8px'
  },
  subtitle: {
    fontSize: '16px',
    color: '#666',
    marginBottom: '32px'
  },
  errorTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#e53e3e',
    marginBottom: '16px'
  },
  errorText: {
    fontSize: '16px',
    color: '#666',
    lineHeight: '1.5'
  },
  deviceDetails: {
    fontSize: '14px',
    color: '#888',
    marginBottom: '24px',
    fontStyle: 'italic'
  }
};