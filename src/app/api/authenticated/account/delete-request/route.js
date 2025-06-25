import { NextResponse } from 'next/server'
import { isAuthenticated } from '@src/utils/routeAuth'
import { 
  createAuthenticatedDeletionRequest,
  cancelDeletionRequest,
  getDeletionRequests 
} from '@src/utils/accountDeletion'
import { 
  sendDeletionRequestConfirmation,
  sendDeletionCancellationConfirmation,
  sendAdminDeletionRequestNotification 
} from '@src/utils/deletionEmailService'

/**
 * POST /api/authenticated/account/delete-request
 * Create a new account deletion request for authenticated users
 */
export async function POST(request) {
  try {
    // Authenticate user
    const user = await isAuthenticated(request)
    if (user instanceof Response) {
      return user
    }

    const body = await request.json()
    const { reason } = body

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

    // Create deletion request
    const deletionRequest = await createAuthenticatedDeletionRequest(
      user.id,
      reason?.trim() || null
    )

    // Send confirmation notification to user
    await sendDeletionRequestConfirmation(user.id, deletionRequest)

    // Send notification to admins
    await sendAdminDeletionRequestNotification(deletionRequest)

    return NextResponse.json({
      success: true,
      message: 'Account deletion request created successfully',
      data: {
        requestId: deletionRequest._id,
        status: deletionRequest.status,
        scheduledDeletionAt: deletionRequest.scheduledDeletionAt,
        requestedAt: deletionRequest.requestedAt
      }
    })

  } catch (error) {
    console.error('Error creating deletion request:', error)

    // Handle specific error cases
    if (error.message === 'User not found') {
      return NextResponse.json(
        { error: 'User account not found' },
        { status: 404 }
      )
    }

    if (error.message === 'A deletion request is already pending for this user') {
      return NextResponse.json(
        { error: 'A deletion request is already pending for your account' },
        { status: 409 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to create deletion request' },
      { status: 500 }
    )
  }
}

/**
 * GET /api/authenticated/account/delete-request
 * Get deletion request status for authenticated user
 */
export async function GET(request) {
  try {
    // Authenticate user
    const user = await isAuthenticated(request)
    if (user instanceof Response) {
      return user
    }

    // Get user's deletion requests
    const { requests } = await getDeletionRequests(
      { userId: user.id },
      { page: 0, limit: 10 }
    )

    // Find the most recent request
    const currentRequest = requests.length > 0 ? requests[0] : null

    if (!currentRequest) {
      return NextResponse.json({
        success: true,
        data: {
          hasActiveRequest: false,
          request: null
        }
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        hasActiveRequest: ['pending', 'pending_verification'].includes(currentRequest.status),
        request: {
          id: currentRequest._id,
          status: currentRequest.status,
          requestType: currentRequest.requestType,
          requestedAt: currentRequest.requestedAt,
          scheduledDeletionAt: currentRequest.scheduledDeletionAt,
          reason: currentRequest.reason,
          canCancel: ['pending', 'pending_verification'].includes(currentRequest.status)
        }
      }
    })

  } catch (error) {
    console.error('Error getting deletion request status:', error)
    return NextResponse.json(
      { error: 'Failed to get deletion request status' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/authenticated/account/delete-request
 * Cancel an existing deletion request
 */
export async function DELETE(request) {
  try {
    // Authenticate user
    const user = await isAuthenticated(request)
    if (user instanceof Response) {
      return user
    }

    const url = new URL(request.url)
    const requestId = url.searchParams.get('requestId')
    const reason = url.searchParams.get('reason')

    if (!requestId) {
      return NextResponse.json(
        { error: 'Request ID is required' },
        { status: 400 }
      )
    }

    // Validate that the request belongs to the authenticated user
    const { requests } = await getDeletionRequests(
      { _id: requestId, userId: user.id },
      { page: 0, limit: 1 }
    )

    if (requests.length === 0) {
      return NextResponse.json(
        { error: 'Deletion request not found or access denied' },
        { status: 404 }
      )
    }

    const deletionRequest = requests[0]

    // Check if request can be cancelled
    if (!['pending', 'pending_verification'].includes(deletionRequest.status)) {
      return NextResponse.json(
        { error: 'This deletion request cannot be cancelled' },
        { status: 400 }
      )
    }

    // Cancel the deletion request
    const cancelledRequest = await cancelDeletionRequest(
      requestId,
      user.id,
      reason?.trim() || 'Cancelled by user'
    )

    // Send cancellation confirmation
    await sendDeletionCancellationConfirmation(
      user.id,
      user.email,
      cancelledRequest
    )

    return NextResponse.json({
      success: true,
      message: 'Deletion request cancelled successfully',
      data: {
        requestId: cancelledRequest._id,
        status: cancelledRequest.status,
        cancelledAt: cancelledRequest.cancelledAt
      }
    })

  } catch (error) {
    console.error('Error cancelling deletion request:', error)

    if (error.message === 'Deletion request not found or cannot be cancelled') {
      return NextResponse.json(
        { error: 'Deletion request not found or cannot be cancelled' },
        { status: 404 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to cancel deletion request' },
      { status: 500 }
    )
  }
}