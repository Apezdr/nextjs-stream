// src/app/(styled)/device/not-approved.tsx
// Component shown to authenticated but not-yet-approved users
export default function NotApproved({ userName }: { userName?: string }) {
  return (
    <div style={styles.container}>
      <div style={styles.icon}>🔒</div>
      <h2 style={styles.title}>Approval Required</h2>
      <p style={styles.message}>
        {userName && `Hi ${userName}, your `}
        Account approval is pending. You'll be able to authorize devices once an administrator approves your account.
      </p>
      <p style={styles.subtext}>
        Please contact your administrator if you believe this is an error.
      </p>
    </div>
  )
}

const styles = {
  container: {
    textAlign: 'center' as const,
    padding: '20px',
  },
  icon: {
    fontSize: '48px',
    marginBottom: '16px',
  },
  title: {
    fontSize: '24px',
    fontWeight: 'bold',
    color: '#333',
    marginBottom: '16px',
  },
  message: {
    fontSize: '16px',
    color: '#666',
    lineHeight: '1.6',
    marginBottom: '12px',
  },
  subtext: {
    fontSize: '14px',
    color: '#999',
    lineHeight: '1.5',
  },
}
