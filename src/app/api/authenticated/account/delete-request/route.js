import { NextResponse } from 'next/server'
import { signedInGate } from '@src/lib/roles/gates'
import { 
  createAuthenticatedDeletionRequest,
  cancelDeletionRequest,
  getDeletionRequests,
  getDeletionRequestById
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
    const user = await signedInGate.route()
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
    const user = await signedInGate.route()
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
        // Open, and not yet started: once an admin starts it the account is signed out
        hasActiveRequest: currentRequest.status === 'pending',
        request: {
          id: currentRequest._id,
          status: currentRequest.status,
          // 'public': made with the account's email on the public form, perhaps not by its owner
          requestType: currentRequest.requestType,
          requestedAt: currentRequest.requestedAt,
          reason: currentRequest.reason,
          canCancel: currentRequest.status === 'pending'
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
    const user = await signedInGate.route()
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

    // The request asked for, and only when it is this user's own: anyone
    // else's answers as if it did not exist
    const deletionRequest = await getDeletionRequestById(requestId)

    if (!deletionRequest || String(deletionRequest.userId) !== String(user.id)) {
      return NextResponse.json(
        { error: 'Deletion request not found or access denied' },
        { status: 404 }
      )
    }

    // Check if request can be cancelled
    if (deletionRequest.status !== 'pending') {
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
    await sendDeletionCancellationConfirmation(user.id, cancelledRequest)

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