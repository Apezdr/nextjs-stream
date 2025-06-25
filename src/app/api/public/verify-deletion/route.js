import { NextResponse } from 'next/server'
import { verifyDeletionRequest } from '@src/utils/accountDeletion'
import { sendDeletionRequestConfirmation } from '@src/utils/deletionEmailService'
import {
  checkRateLimit,
  createRateLimitHeaders,
  RATE_LIMITS
} from '@src/utils/rateLimiter'

/**
 * GET /api/public/verify-deletion
 * Verify a deletion request using email verification token
 */
export async function GET(request) {
  try {
    // Apply rate limiting
    const rateLimitResult = checkRateLimit(request, RATE_LIMITS.EMAIL_VERIFICATION, 'verify')
    
    if (rateLimitResult.isLimited) {
      return NextResponse.json(
        {
          error: 'Too many verification attempts from this IP address. Please try again later.',
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

    const url = new URL(request.url)
    const token = url.searchParams.get('token')

    if (!token) {
      return NextResponse.json(
        { error: 'Verification token is required' },
        { status: 400 }
      )
    }

    if (typeof token !== 'string' || token.length < 10) {
      return NextResponse.json(
        { error: 'Invalid verification token format' },
        { status: 400 }
      )
    }

    // Verify the deletion request
    const deletionRequest = await verifyDeletionRequest(token)

    // Send confirmation notification (this will be logged since it's a public user)
    await sendDeletionRequestConfirmation(null, deletionRequest)

    // Return success response with redirect information
    return NextResponse.json({
      success: true,
      message: 'Email verification successful. Your account deletion request is now confirmed.',
      data: {
        requestId: deletionRequest._id,
        status: deletionRequest.status,
        email: deletionRequest.email,
        scheduledDeletionAt: deletionRequest.scheduledDeletionAt,
        verifiedAt: deletionRequest.verifiedAt,
        gracePeriodDays: Math.ceil(
          (new Date(deletionRequest.scheduledDeletionAt) - new Date()) / (1000 * 60 * 60 * 24)
        )
      }
    })

  } catch (error) {
    console.error('Error verifying deletion request:', error)

    // Handle specific error cases
    if (error.message === 'Invalid or expired verification token') {
      return NextResponse.json(
        { 
          error: 'Invalid or expired verification token. Please request a new deletion request.',
          code: 'TOKEN_INVALID'
        },
        { status: 400 }
      )
    }

    if (error.message === 'Deletion request not found') {
      return NextResponse.json(
        { 
          error: 'Deletion request not found. The request may have been cancelled or completed.',
          code: 'REQUEST_NOT_FOUND'
        },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { 
        error: 'Failed to verify deletion request. Please try again or contact support.',
        code: 'VERIFICATION_FAILED'
      },
      { status: 500 }
    )
  }
}

/**
 * POST /api/public/verify-deletion
 * Alternative method for verification (for form submissions)
 */
export async function POST(request) {
  try {
    // Apply rate limiting
    const rateLimitResult = checkRateLimit(request, RATE_LIMITS.EMAIL_VERIFICATION, 'verify')
    
    if (rateLimitResult.isLimited) {
      return NextResponse.json(
        {
          error: 'Too many verification attempts from this IP address. Please try again later.',
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
    const { token } = body

    if (!token) {
      return NextResponse.json(
        { error: 'Verification token is required' },
        { status: 400 }
      )
    }

    if (typeof token !== 'string' || token.length < 10) {
      return NextResponse.json(
        { error: 'Invalid verification token format' },
        { status: 400 }
      )
    }

    // Verify the deletion request
    const deletionRequest = await verifyDeletionRequest(token)

    // Send confirmation notification
    await sendDeletionRequestConfirmation(null, deletionRequest)

    return NextResponse.json({
      success: true,
      message: 'Email verification successful. Your account deletion request is now confirmed.',
      data: {
        requestId: deletionRequest._id,
        status: deletionRequest.status,
        email: deletionRequest.email,
        scheduledDeletionAt: deletionRequest.scheduledDeletionAt,
        verifiedAt: deletionRequest.verifiedAt,
        gracePeriodDays: Math.ceil(
          (new Date(deletionRequest.scheduledDeletionAt) - new Date()) / (1000 * 60 * 60 * 24)
        )
      }
    })

  } catch (error) {
    console.error('Error verifying deletion request:', error)

    // Handle specific error cases
    if (error.message === 'Invalid or expired verification token') {
      return NextResponse.json(
        { 
          error: 'Invalid or expired verification token. Please request a new deletion request.',
          code: 'TOKEN_INVALID'
        },
        { status: 400 }
      )
    }

    if (error.message === 'Deletion request not found') {
      return NextResponse.json(
        { 
          error: 'Deletion request not found. The request may have been cancelled or completed.',
          code: 'REQUEST_NOT_FOUND'
        },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { 
        error: 'Failed to verify deletion request. Please try again or contact support.',
        code: 'VERIFICATION_FAILED'
      },
      { status: 500 }
    )
  }
}