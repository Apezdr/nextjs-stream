import { NextResponse } from 'next/server'
import { createPublicDeletionRequest } from '@src/utils/accountDeletion'
import {
  sendEmailVerificationNotification,
  sendAdminDeletionRequestNotification
} from '@src/utils/deletionEmailService'
import {
  checkRateLimit,
  getClientIP,
  createRateLimitHeaders,
  RATE_LIMITS
} from '@src/utils/rateLimiter'

/**
 * POST /api/public/delete-request
 * Create a new account deletion request for public users (requires email verification)
 */
export async function POST(request) {
  try {
    // Apply rate limiting
    const rateLimitResult = checkRateLimit(request, RATE_LIMITS.DELETION_REQUEST, 'deletion')
    
    if (rateLimitResult.isLimited) {
      return NextResponse.json(
        {
          error: 'Too many deletion requests from this IP address. Please try again later.',
          retryAfter: rateLimitResult.retryAfter
        },
        {
          status: 429,
          headers: {
            ...createRateLimitHeaders(rateLimitResult)
          }
        }
      )
    }

    const body = await request.json()
    const { email, reason } = body

    // Validate email
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email address is required' },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Validate reason if provided
    if (reason && typeof reason !== 'string') {
      return NextResponse.json(
        { error: 'Reason must be a string' },
        { status: 400 }
      )
    }

    if (reason && reason.length > 500) {
      return NextResponse.json(
        { error: 'Reason must be less than 500 characters' },
        { status: 400 }
      )
    }

    // Create deletion request with verification token
    const { deletionRequest, verificationToken } = await createPublicDeletionRequest(
      email.trim().toLowerCase(),
      reason?.trim() || null,
      clientIP
    )

    // Send email verification notification
    await sendEmailVerificationNotification(
      email.trim().toLowerCase(),
      verificationToken.token,
      deletionRequest
    )

    // Send notification to admins
    await sendAdminDeletionRequestNotification(deletionRequest)

    return NextResponse.json({
      success: true,
      message: 'Account deletion request created. Please check your email to verify the request.',
      data: {
        requestId: deletionRequest._id,
        status: deletionRequest.status,
        email: deletionRequest.email,
        verificationRequired: true,
        verificationExpiresAt: verificationToken.expiresAt
      }
    })

  } catch (error) {
    console.error('Error creating public deletion request:', error)

    // Handle specific error cases
    if (error.message === 'No account found with this email address') {
      return NextResponse.json(
        { error: 'No account found with this email address' },
        { status: 404 }
      )
    }

    if (error.message === 'A deletion request is already pending for this email') {
      return NextResponse.json(
        { error: 'A deletion request is already pending for this email address' },
        { status: 409 }
      )
    }

    if (error.message === 'Invalid email format') {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    if (error.message.includes('Too many deletion requests')) {
      return NextResponse.json(
        { 
          error: error.message,
          retryAfter: 3600
        },
        { 
          status: 429,
          headers: {
            'Retry-After': '3600'
          }
        }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create deletion request' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/public/delete-request
 * Get information about public deletion requests (limited info for security)
 */
export async function GET(request) {
  try {
    const url = new URL(request.url)
    const email = url.searchParams.get('email')

    if (!email) {
      return NextResponse.json(
        { error: 'Email parameter is required' },
        { status: 400 }
      )
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    const clientIP = getClientIP(request)
    
    // Apply rate limiting for status checks too
    if (isRateLimited(`status_${clientIP}`, 10, 60 * 60 * 1000)) { // 10 status checks per hour per IP
      return NextResponse.json(
        { 
          error: 'Too many status check requests from this IP address. Please try again later.',
          retryAfter: 3600
        },
        { 
          status: 429,
          headers: {
            'Retry-After': '3600'
          }
        }
      )
    }

    // Import here to avoid circular dependencies
    const { getDeletionRequests } = await import('@src/utils/accountDeletion')

    // Get deletion requests for this email (limited info for security)
    const { requests } = await getDeletionRequests(
      { email: email.trim().toLowerCase() },
      { page: 0, limit: 1 }
    )

    if (requests.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          hasActiveRequest: false,
          message: 'No deletion request found for this email address'
        }
      })
    }

    const request_data = requests[0]

    // Only return limited information for security
    return NextResponse.json({
      success: true,
      data: {
        hasActiveRequest: ['pending', 'pending_verification'].includes(request_data.status),
        status: request_data.status,
        requestedAt: request_data.requestedAt,
        scheduledDeletionAt: request_data.status === 'pending' ? request_data.scheduledDeletionAt : null,
        requiresVerification: request_data.status === 'pending_verification'
      }
    })

  } catch (error) {
    console.error('Error getting public deletion request status:', error)
    return NextResponse.json(
      { error: 'Failed to get deletion request status' },
      { status: 500 }
    )
  }
}