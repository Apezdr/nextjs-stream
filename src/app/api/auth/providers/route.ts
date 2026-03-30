// src/app/api/auth/providers/route.ts
// Returns a list of configured authentication providers in JSON format.
// Used by clients to dynamically display available sign-in options.
import { connection, NextResponse } from 'next/server'
import { auth } from '@src/lib/auth'

interface Provider {
  id: string
  name: string
  type: 'social'
}

export async function GET() {
  await connection();
  try {
    // Extract configured providers from the auth instance
    const socialProviders = (auth as any).options?.socialProviders || {}
    
    const providers: Provider[] = Object.keys(socialProviders)
      .filter(key => {
        // Only include providers that have both clientId and clientSecret configured
        const provider = socialProviders[key]
        return provider?.clientId && provider?.clientSecret
      })
      .map(id => ({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1), // Capitalize first letter
        type: 'social' as const,
      }))

    return NextResponse.json({
      providers,
      count: providers.length,
    })
  } catch (error) {
    console.error('Error fetching auth providers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch authentication providers' },
      { status: 500 }
    )
  }
}
