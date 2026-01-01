'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import * as React from 'react'

interface PageProps {
  params: Promise<{ provider: string }>
}

export default function NativeSignInPage({ params }: PageProps) {
  // Use React.use to unwrap the params Promise
  const resolvedParams = React.use(params) as { provider: string }
  const { provider } = resolvedParams
  
  const search = useSearchParams()
  const sessionId = search?.get('sessionId')
  const qrSessionId = search?.get('qrSessionId')
  const callback = search?.get('callbackUrl') || '/'
  
  // For session-based auth, we need to pass the sessionId or qrSessionId through the flow
  let finalCallback = callback
  if (sessionId) {
    finalCallback = `${callback}${callback.includes('?') ? '&' : '?'}sessionId=${sessionId}`
  } else if (qrSessionId) {
    finalCallback = `${callback}${callback.includes('?') ? '&' : '?'}qrSessionId=${qrSessionId}`
  }

  useEffect(() => {
    // This will:
    // 1. GET /api/auth/csrf
    // 2. POST /api/auth/signin/:provider with CSRF
    // 3. Redirect to the IdP (Google/Discord)
    // 4. Finally return /api/auth/callback and invoke our custom redirect() callback
    signIn(provider, { callbackUrl: finalCallback })
  }, [provider, finalCallback])

  return (
    <div style={{height:'100vh',display:'flex',justifyContent:'center',alignItems:'center',color:'#333'}}>
      <p>Redirecting to {provider}…</p>
    </div>
  )
}
