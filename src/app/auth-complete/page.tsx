// src/app/auth-complete/page.tsx
import { auth } from '@src/lib/auth'
import { storeSessionTokens, getAuthSession, generateMobileToken } from '@src/lib/auth'
import { getUserBySessionId } from '@src/lib/auth'
import { redirect } from 'next/navigation'
import CountdownClient from './countdown-client'

export default async function AuthCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ sessionId?: string; error?: string }>
}) {
  // Await the searchParams object to access its properties
  const params = await searchParams
  const sessionId = params?.sessionId
  const error = params?.error
  let tokenStored = false
  let errorMessage = error
  
  if (sessionId && !error) {
    try {
      // Get the current session and user
      const session = await auth()
      
      if (session?.user) {
        // Get the existing auth session
        const authSession = await getAuthSession(sessionId)
        
        if (!authSession) {
          errorMessage = 'Invalid session ID'
        } else if (authSession.status === 'complete') {
          tokenStored = true
        } else {
          // Generate a mobile token
          const mobileSessionToken = await generateMobileToken(
            session.user.id, 
            session.user.id // Using same ID for both parameters as we don't have a separate internal ID
          )
          
          // Store tokens with the session ID
          await storeSessionTokens(sessionId, {
            user: {
              id: session.user.id,
              email: session.user.email || '',
              name: session.user.name || '',
              image: session.user.image || '',
              approved: (session.user as any).approved || false,
              limitedAccess: (session.user as any).limitedAccess || false,
              admin: (session.user as any).admin || false,
            },
            mobileSessionToken,
            sessionId: sessionId,
          })
          
          tokenStored = true
        }
      } else {
        // No session - redirect to sign in
        return redirect(`/api/auth/signin?callbackUrl=/auth-complete?sessionId=${sessionId}`)
      }
    } catch (error) {
      console.error('Error processing authentication:', error)
      errorMessage = 'Authentication processing error'
    }
  }

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      textAlign: 'center',
      padding: '20px',
      color: '#333',
      backgroundColor: '#f8f9fa',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <div style={{
        maxWidth: '500px',
        padding: '40px',
        borderRadius: '12px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
        backgroundColor: 'white'
      }}>
        <h1 style={{ 
          fontSize: '28px', 
          marginBottom: '24px',
          color: errorMessage ? '#e53e3e' : '#0070f3'
        }}>
          {errorMessage 
            ? 'Authentication Error'
            : tokenStored 
              ? 'Authentication Complete!'
              : 'Authentication Successful!'}
        </h1>
        
        <p style={{ fontSize: '18px', marginBottom: '16px' }}>
          {errorMessage 
            ? `Error: ${errorMessage}`
            : 'You can now return to the TV app.'}
        </p>
        
        <p style={{ fontSize: '16px', color: '#666' }}>
          This window can be closed.
          <CountdownClient />
        </p>
      </div>
    </div>
  )
}
