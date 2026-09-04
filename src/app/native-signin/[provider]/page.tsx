'use client'

import { useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { authClient } from '@src/lib/auth-client'
import { normalizeAuthCallbackURL } from '@src/utils/authCallbackUrl'
import * as React from 'react'

interface PageProps {
  params: Promise<{ provider: string }>
}

export default function NativeSignInPage({ params }: PageProps) {
  const resolvedParams = React.use(params) as { provider: string }
  const { provider } = resolvedParams

  const search = useSearchParams()
  const callback = search?.get('callbackUrl') || '/'
  const normalizedCallback = normalizeAuthCallbackURL(callback, '/')

  useEffect(() => {
    authClient.signIn.social({ provider: provider as 'google' | 'discord', callbackURL: normalizedCallback })
  }, [provider, normalizedCallback])

  return (
    <div style={{height:'100vh',display:'flex',justifyContent:'center',alignItems:'center',color:'#333'}}>
      <p>Redirecting to {provider}…</p>
    </div>
  )
}
