'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

interface QRAuthClientProps {
  qrSessionId: string;
  isAuthenticated: boolean;
  user: {
    name: string;
    email: string;
    image: string;
  } | null;
}

export default function QRAuthClient({ qrSessionId, isAuthenticated, user }: QRAuthClientProps) {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleApprove = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/approve-qr-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ qrSessionId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to approve TV sign-in');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = (provider: string) => {
    // Redirect to OAuth with QR session context
    signIn(provider, { 
      callbackUrl: `/auth-complete?qrSessionId=${qrSessionId}` 
    });
  };

  if (success) {
    return (
      <div style={styles.successContainer}>
        <div style={styles.successIcon}>✓</div>
        <h2 style={styles.successTitle}>TV Sign-In Approved!</h2>
        <p style={styles.successText}>
          You can now return to your TV. This page can be closed.
        </p>
      </div>
    );
  }

  if (isAuthenticated && user) {
    return (
      <div>
        <div style={styles.userInfo}>
          {user.image && (
            <img 
              src={user.image} 
              alt="Profile" 
              style={styles.avatar}
            />
          )}
          <div>
            <p style={styles.userName}>{user.name}</p>
            <p style={styles.userEmail}>{user.email}</p>
          </div>
        </div>

        <p style={styles.approveText}>
          Do you want to sign in to your TV with this account?
        </p>

        {error && (
          <div style={styles.errorContainer}>
            <p style={styles.errorText}>{error}</p>
          </div>
        )}

        <div style={styles.buttonContainer}>
          <button
            onClick={handleApprove}
            disabled={loading}
            style={{
              ...styles.button,
              ...styles.approveButton,
              ...(loading ? styles.buttonDisabled : {})
            }}
          >
            {loading ? 'Approving...' : 'Approve TV Sign-In'}
          </button>
        </div>
      </div>
    );
  }

  // User not authenticated - show login options
  return (
    <div>
      <p style={styles.loginText}>
        Sign in to approve this TV device:
      </p>

      {error && (
        <div style={styles.errorContainer}>
          <p style={styles.errorText}>{error}</p>
        </div>
      )}

      <div style={styles.buttonContainer}>
        <button
          onClick={() => handleSignIn('google')}
          style={{...styles.button, ...styles.googleButton}}
        >
          Sign in with Google
        </button>
        
        <button
          onClick={() => handleSignIn('discord')}
          style={{...styles.button, ...styles.discordButton}}
        >
          Sign in with Discord
        </button>
      </div>
    </div>
  );
}

const styles = {
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '24px',
    padding: '16px',
    backgroundColor: '#f8f9fa',
    borderRadius: '8px'
  },
  avatar: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    objectFit: 'cover' as const
  },
  userName: {
    fontSize: '18px',
    fontWeight: 'bold',
    color: '#333',
    margin: '0 0 4px 0'
  },
  userEmail: {
    fontSize: '14px',
    color: '#666',
    margin: '0'
  },
  approveText: {
    fontSize: '16px',
    color: '#333',
    marginBottom: '24px',
    lineHeight: '1.5'
  },
  loginText: {
    fontSize: '16px',
    color: '#333',
    marginBottom: '24px',
    lineHeight: '1.5'
  },
  buttonContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px'
  },
  button: {
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    width: '100%'
  },
  approveButton: {
    backgroundColor: '#0070f3',
    color: 'white'
  },
  googleButton: {
    backgroundColor: '#4285f4',
    color: 'white'
  },
  discordButton: {
    backgroundColor: '#5865f2',
    color: 'white'
  },
  buttonDisabled: {
    opacity: 0.6,
    cursor: 'not-allowed'
  },
  errorContainer: {
    backgroundColor: '#fee',
    border: '1px solid #fcc',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '16px'
  },
  errorText: {
    color: '#c53030',
    fontSize: '14px',
    margin: '0'
  },
  successContainer: {
    textAlign: 'center' as const
  },
  successIcon: {
    fontSize: '48px',
    color: '#38a169',
    marginBottom: '16px'
  },
  successTitle: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#38a169',
    marginBottom: '12px'
  },
  successText: {
    fontSize: '16px',
    color: '#666',
    lineHeight: '1.5'
  }
};