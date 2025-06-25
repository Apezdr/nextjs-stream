import { NextResponse } from 'next/server'
import { isAdmin } from '@src/utils/routeAuth'
import { 
  getDeletionRequests,
  cancelDeletionRequest,
  executeAccountDeletion,
  getDeletionAuditLogs,
  cleanupExpiredTokens
} from '@src/utils/accountDeletion'
import { 
  sendDeletionCancellationConfirmation,
  sendDeletionCompletionNotification,
  sendDeletionFailureNotification
} from '@src/utils/deletionEmailService'

/**
 * GET /api/authenticated/admin/deletion-requests
 * Get all deletion requests with filtering and pagination (admin only)
 */
export async function GET(request) {
  try {
    // Authenticate admin
    const admin = await isAdmin(request)
    if (admin instanceof Response) {
      return admin
    }

    const url = new URL(request.url)
    
    // Parse query parameters
    const page = parseInt(url.searchParams.get('page') || '0', 10)
    const limit = parseInt(url.searchParams.get('limit') || '20', 10)
    const status = url.searchParams.get('status')
    const requestType = url.searchParams.get('requestType')
    const email = url.searchParams.get('email')
    const action = url.searchParams.get('action')

    // Validate pagination parameters
    if (page < 0 || limit < 1 || limit > 100) {
      return NextResponse.json(
        { error: 'Invalid pagination parameters' },
        { status: 400 }
      )
    }

    // Handle special actions
    if (action === 'cleanup-tokens') {
      const cleanedCount = await cleanupExpiredTokens()
      return NextResponse.json({
        success: true,
        message: `Cleaned up ${cleanedCount} expired verification tokens`,
        data: { cleanedCount }
      })
    }

    // Build filters
    const filters = {}
    if (status) filters.status = status
    if (requestType) filters.requestType = requestType
    if (email) filters.email = email

    // Get deletion requests
    const result = await getDeletionRequests(filters, { page, limit })

    // Add additional computed fields
    const enhancedRequests = result.requests.map(request => ({
      ...request,
      daysUntilDeletion: request.scheduledDeletionAt 
        ? Math.ceil((new Date(request.scheduledDeletionAt) - new Date()) / (1000 * 60 * 60 * 24))
        : null,
      canCancel: ['pending', 'pending_verification'].includes(request.status),
      canExecute: request.status === 'pending' && new Date(request.scheduledDeletionAt) <= new Date()
    }))

    return NextResponse.json({
      success: true,
      data: {
        requests: enhancedRequests,
        pagination: result.pagination,
        filters: filters
      }
    })

  } catch (error) {
    console.error('Error getting deletion requests:', error)
    return NextResponse.json(
      { error: 'Failed to get deletion requests' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/authenticated/admin/deletion-requests
 * Perform actions on deletion requests (admin only)
 */
export async function POST(request) {
  try {
    // Authenticate admin
    const admin = await isAdmin(request)
    if (admin instanceof Response) {
      return admin
    }

    const body = await request.json()
    const { action, requestId, reason } = body

    if (!action || !requestId) {
      return NextResponse.json(
        { error: 'Action and requestId are required' },
        { status: 400 }
      )
    }

    switch (action) {
      case 'cancel':
        return await handleCancelRequest(requestId, admin.id, reason)
      
      case 'execute':
        return await handleExecuteRequest(requestId, admin.id)
      
      case 'get-audit-logs':
        return await handleGetAuditLogs(requestId)
      
      default:
        return NextResponse.json(
          { error: 'Invalid action' },
          { status: 400 }
        )
    }

  } catch (error) {
    console.error('Error performing deletion request action:', error)
    return NextResponse.json(
      { error: 'Failed to perform action' },
      { status: 500 }
    )
  }
}

/**
 * Handle cancelling a deletion request
 */
async function handleCancelRequest(requestId, adminId, reason) {
  try {
    // Get the request first to get user info
    const { requests } = await getDeletionRequests(
      { _id: requestId },
      { page: 0, limit: 1 }
    )

    if (requests.length === 0) {
      return NextResponse.json(
        { error: 'Deletion request not found' },
        { status: 404 }
      )
    }

    const deletionRequest = requests[0]

    // Cancel the request
    const cancelledRequest = await cancelDeletionRequest(
      requestId,
      adminId,
      reason || 'Cancelled by administrator'
    )

    // Send cancellation notification
    if (deletionRequest.userId) {
      // Authenticated user
      await sendDeletionCancellationConfirmation(
        deletionRequest.userId.toString(),
        deletionRequest.email,
        cancelledRequest
      )
    } else {
      // Public user
      await sendDeletionCancellationConfirmation(
        null,
        deletionRequest.email,
        cancelledRequest
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Deletion request cancelled successfully',
      data: {
        requestId: cancelledRequest._id,
        status: cancelledRequest.status,
        cancelledAt: cancelledRequest.cancelledAt,
        cancelledBy: cancelledRequest.cancelledBy
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

/**
 * Handle executing a deletion request
 */
async function handleExecuteRequest(requestId, adminId) {
  try {
    // Get the request first to get user info
    const { requests } = await getDeletionRequests(
      { _id: requestId },
      { page: 0, limit: 1 }
    )

    if (requests.length === 0) {
      return NextResponse.json(
        { error: 'Deletion request not found' },
        { status: 404 }
      )
    }

    const deletionRequest = requests[0]

    // Validate that the request can be executed
    if (deletionRequest.status !== 'pending') {
      return NextResponse.json(
        { error: 'Only pending deletion requests can be executed' },
        { status: 400 }
      )
    }

    // Execute the deletion
    const result = await executeAccountDeletion(requestId, adminId)

    // Send completion notification
    await sendDeletionCompletionNotification(
      deletionRequest.email,
      result.deletionResults || {}
    )

    return NextResponse.json({
      success: true,
      message: 'Account deletion executed successfully',
      data: {
        requestId,
        completedAt: new Date(),
        completedBy: adminId,
        deletionResults: result.deletionResults
      }
    })

  } catch (error) {
    console.error('Error executing deletion request:', error)

    // Get the request for failure notification
    try {
      const { requests } = await getDeletionRequests(
        { _id: requestId },
        { page: 0, limit: 1 }
      )

      if (requests.length > 0) {
        await sendDeletionFailureNotification(requests[0], error)
      }
    } catch (notificationError) {
      console.error('Error sending failure notification:', notificationError)
    }

    if (error.message === 'Deletion request not found') {
      return NextResponse.json(
        { error: 'Deletion request not found' },
        { status: 404 }
      )
    }

    if (error.message === 'Deletion request is not in pending status') {
      return NextResponse.json(
        { error: 'Only pending deletion requests can be executed' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to execute deletion request' },
      { status: 500 }
    )
  }
}

/**
 * Handle getting audit logs for a deletion request
 */
async function handleGetAuditLogs(requestId) {
  try {
    const auditLogs = await getDeletionAuditLogs(requestId)

    return NextResponse.json({
      success: true,
      data: {
        requestId,
        auditLogs: auditLogs.map(log => ({
          id: log._id,
          action: log.action,
          performedAt: log.performedAt,
          performedBy: log.performer ? {
            id: log.performer._id,
            name: log.performer.name,
            email: log.performer.email
          } : null,
          details: log.details,
          ipAddress: log.ipAddress
        }))
      }
    })

  } catch (error) {
    console.error('Error getting audit logs:', error)
    return NextResponse.json(
      { error: 'Failed to get audit logs' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/authenticated/admin/deletion-requests
 * Bulk operations on deletion requests (admin only)
 */
export async function DELETE(request) {
  try {
    // Authenticate admin
    const admin = await isAdmin(request)
    if (admin instanceof Response) {
      return admin
    }

    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    const requestIds = url.searchParams.get('requestIds')?.split(',') || []

    if (!action) {
      return NextResponse.json(
        { error: 'Action parameter is required' },
        { status: 400 }
      )
    }

    if (requestIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one request ID is required' },
        { status: 400 }
      )
    }

    if (requestIds.length > 10) {
      return NextResponse.json(
        { error: 'Maximum 10 requests can be processed at once' },
        { status: 400 }
      )
    }

    switch (action) {
      case 'bulk-cancel':
        return await handleBulkCancel(requestIds, admin.id)
      
      default:
        return NextResponse.json(
          { error: 'Invalid bulk action' },
          { status: 400 }
        )
    }

  } catch (error) {
    console.error('Error performing bulk deletion request action:', error)
    return NextResponse.json(
      { error: 'Failed to perform bulk action' },
      { status: 500 }
    )
  }
}

/**
 * Handle bulk cancellation of deletion requests
 */
async function handleBulkCancel(requestIds, adminId) {
  const results = []

  for (const requestId of requestIds) {
    try {
      const result = await handleCancelRequest(requestId, adminId, 'Bulk cancelled by administrator')
      results.push({
        requestId,
        success: true,
        data: result.data
      })
    } catch (error) {
      results.push({
        requestId,
        success: false,
        error: error.message
      })
    }
  }

  const successCount = results.filter(r => r.success).length
  const failureCount = results.filter(r => !r.success).length

  return NextResponse.json({
    success: true,
    message: `Bulk cancellation completed: ${successCount} successful, ${failureCount} failed`,
    data: {
      results,
      summary: {
        total: requestIds.length,
        successful: successCount,
        failed: failureCount
      }
    }
  })
}