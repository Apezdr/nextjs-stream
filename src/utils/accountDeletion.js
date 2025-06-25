import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { nanoid } from 'nanoid'

/**
 * Account deletion utility functions
 * Handles GDPR/CCPA compliant account deletion with audit logging
 */

/**
 * Create a deletion request for an authenticated user
 * @param {string} userId - User ID requesting deletion
 * @param {string} reason - Optional reason for deletion
 * @returns {Promise<Object>} Created deletion request
 */
export async function createAuthenticatedDeletionRequest(userId, reason = null) {
  const client = await clientPromise
  const db = client.db('Users')
  
  // Check if user exists
  const user = await db.collection('AuthenticatedUsers').findOne({ _id: new ObjectId(userId) })
  if (!user) {
    throw new Error('User not found')
  }
  
  // Check for existing pending request
  const existingRequest = await db.collection('DeletionRequests').findOne({
    userId: new ObjectId(userId),
    status: 'pending'
  })
  
  if (existingRequest) {
    throw new Error('A deletion request is already pending for this user')
  }
  
  const deletionRequest = {
    _id: new ObjectId(),
    userId: new ObjectId(userId),
    email: user.email,
    requestType: 'authenticated',
    status: 'pending',
    reason,
    requestedAt: new Date(),
    scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days grace period
    createdAt: new Date(),
    updatedAt: new Date()
  }
  
  await db.collection('DeletionRequests').insertOne(deletionRequest)
  
  // Create audit log entry
  await createDeletionAuditLog({
    deletionRequestId: deletionRequest._id,
    action: 'request_created',
    performedBy: userId,
    details: { requestType: 'authenticated', reason }
  })
  
  return deletionRequest
}

/**
 * Create a deletion request for a public user (email-based)
 * @param {string} email - Email address requesting deletion
 * @param {string} reason - Optional reason for deletion
 * @param {string} clientIp - Client IP address for rate limiting
 * @returns {Promise<Object>} Created deletion request and verification token
 */
export async function createPublicDeletionRequest(email, reason = null, clientIp = null) {
  const client = await clientPromise
  const db = client.db('Users')
  
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format')
  }
  
  // Check if user exists
  const user = await db.collection('AuthenticatedUsers').findOne({ email })
  if (!user) {
    throw new Error('No account found with this email address')
  }
  
  // Check for existing pending request
  const existingRequest = await db.collection('DeletionRequests').findOne({
    email,
    status: 'pending'
  })
  
  if (existingRequest) {
    throw new Error('A deletion request is already pending for this email')
  }
  
  // Rate limiting check (max 3 requests per IP per hour)
  if (clientIp) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentRequests = await db.collection('DeletionRequests').countDocuments({
      'metadata.clientIp': clientIp,
      requestedAt: { $gte: oneHourAgo }
    })
    
    if (recentRequests >= 3) {
      throw new Error('Too many deletion requests from this IP address. Please try again later.')
    }
  }
  
  const deletionRequest = {
    _id: new ObjectId(),
    userId: user._id,
    email,
    requestType: 'public',
    status: 'pending_verification',
    reason,
    requestedAt: new Date(),
    scheduledDeletionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days grace period
    metadata: {
      clientIp,
      userAgent: null // Can be added if needed
    },
    createdAt: new Date(),
    updatedAt: new Date()
  }
  
  await db.collection('DeletionRequests').insertOne(deletionRequest)
  
  // Create verification token
  const verificationToken = await createDeletionVerificationToken(deletionRequest._id, email)
  
  // Create audit log entry
  await createDeletionAuditLog({
    deletionRequestId: deletionRequest._id,
    action: 'public_request_created',
    performedBy: null,
    details: { requestType: 'public', reason, clientIp }
  })
  
  return { deletionRequest, verificationToken }
}

/**
 * Create a verification token for email verification
 * @param {ObjectId} deletionRequestId - Deletion request ID
 * @param {string} email - Email address
 * @returns {Promise<Object>} Created verification token
 */
export async function createDeletionVerificationToken(deletionRequestId, email) {
  const client = await clientPromise
  const db = client.db('Users')
  
  const token = nanoid(32)
  const verificationToken = {
    _id: new ObjectId(),
    deletionRequestId,
    email,
    token,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    used: false,
    createdAt: new Date()
  }
  
  await db.collection('DeletionVerificationTokens').insertOne(verificationToken)
  return verificationToken
}

/**
 * Verify a deletion request using email verification token
 * @param {string} token - Verification token
 * @returns {Promise<Object>} Updated deletion request
 */
export async function verifyDeletionRequest(token) {
  const client = await clientPromise
  const db = client.db('Users')
  
  // Find and validate token
  const verificationToken = await db.collection('DeletionVerificationTokens').findOne({
    token,
    used: false,
    expiresAt: { $gt: new Date() }
  })
  
  if (!verificationToken) {
    throw new Error('Invalid or expired verification token')
  }
  
  // Mark token as used
  await db.collection('DeletionVerificationTokens').updateOne(
    { _id: verificationToken._id },
    { 
      $set: { 
        used: true, 
        usedAt: new Date() 
      } 
    }
  )
  
  // Update deletion request status
  const deletionRequest = await db.collection('DeletionRequests').findOneAndUpdate(
    { _id: verificationToken.deletionRequestId },
    { 
      $set: { 
        status: 'pending',
        verifiedAt: new Date(),
        updatedAt: new Date()
      } 
    },
    { returnDocument: 'after' }
  )
  
  if (!deletionRequest) {
    throw new Error('Deletion request not found')
  }
  
  // Create audit log entry
  await createDeletionAuditLog({
    deletionRequestId: verificationToken.deletionRequestId,
    action: 'email_verified',
    performedBy: null,
    details: { email: verificationToken.email }
  })
  
  return deletionRequest
}

/**
 * Get all deletion requests (admin function)
 * @param {Object} filters - Optional filters
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} Deletion requests with pagination info
 */
export async function getDeletionRequests(filters = {}, pagination = { page: 0, limit: 20 }) {
  const client = await clientPromise
  const db = client.db('Users')
  
  const { page, limit } = pagination
  const skip = page * limit
  
  // Build query
  const query = {}
  if (filters.status) query.status = filters.status
  if (filters.requestType) query.requestType = filters.requestType
  if (filters.email) query.email = { $regex: filters.email, $options: 'i' }
  
  // Get total count
  const total = await db.collection('DeletionRequests').countDocuments(query)
  
  // Get requests with user data
  const requests = await db.collection('DeletionRequests').aggregate([
    { $match: query },
    { $sort: { requestedAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from: 'AuthenticatedUsers',
        localField: 'userId',
        foreignField: '_id',
        as: 'user'
      }
    },
    {
      $addFields: {
        user: { $arrayElemAt: ['$user', 0] }
      }
    }
  ]).toArray()
  
  return {
    requests,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: (page + 1) * limit < total
    }
  }
}

/**
 * Cancel a deletion request
 * @param {string} deletionRequestId - Deletion request ID
 * @param {string} performedBy - User ID performing the cancellation
 * @param {string} reason - Reason for cancellation
 * @returns {Promise<Object>} Updated deletion request
 */
export async function cancelDeletionRequest(deletionRequestId, performedBy, reason = null) {
  const client = await clientPromise
  const db = client.db('Users')
  
  const deletionRequest = await db.collection('DeletionRequests').findOneAndUpdate(
    { 
      _id: new ObjectId(deletionRequestId),
      status: { $in: ['pending', 'pending_verification'] }
    },
    { 
      $set: { 
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: performedBy,
        cancellationReason: reason,
        updatedAt: new Date()
      } 
    },
    { returnDocument: 'after' }
  )
  
  if (!deletionRequest) {
    throw new Error('Deletion request not found or cannot be cancelled')
  }
  
  // Create audit log entry
  await createDeletionAuditLog({
    deletionRequestId: new ObjectId(deletionRequestId),
    action: 'request_cancelled',
    performedBy,
    details: { reason }
  })
  
  return deletionRequest
}

/**
 * Execute account deletion
 * @param {string} deletionRequestId - Deletion request ID
 * @param {string} performedBy - Admin user ID performing the deletion
 * @returns {Promise<Object>} Deletion result
 */
export async function executeAccountDeletion(deletionRequestId, performedBy) {
  const client = await clientPromise
  const session = client.startSession()
  
  try {
    await session.withTransaction(async () => {
      const usersDb = client.db('Users')
      const mediaDb = client.db('Media')
      
      // Get deletion request
      const deletionRequest = await usersDb.collection('DeletionRequests').findOne(
        { _id: new ObjectId(deletionRequestId) },
        { session }
      )
      
      if (!deletionRequest) {
        throw new Error('Deletion request not found')
      }
      
      if (deletionRequest.status !== 'pending') {
        throw new Error('Deletion request is not in pending status')
      }
      
      const userId = deletionRequest.userId
      const userEmail = deletionRequest.email
      
      // Delete user data across all collections
      const deletionResults = await deleteUserDataAcrossCollections(userId, userEmail, session)
      
      // Update deletion request status
      await usersDb.collection('DeletionRequests').updateOne(
        { _id: new ObjectId(deletionRequestId) },
        { 
          $set: { 
            status: 'completed',
            completedAt: new Date(),
            completedBy: performedBy,
            deletionResults,
            updatedAt: new Date()
          } 
        },
        { session }
      )
      
      // Create audit log entry
      await createDeletionAuditLog({
        deletionRequestId: new ObjectId(deletionRequestId),
        action: 'deletion_completed',
        performedBy,
        details: { deletionResults }
      }, session)
      
      return { success: true, deletionResults }
    })
    
    return { success: true }
  } catch (error) {
    throw error
  } finally {
    await session.endSession()
  }
}

/**
 * Delete user data across all collections
 * @param {ObjectId} userId - User ID
 * @param {string} userEmail - User email
 * @param {Object} session - MongoDB session for transaction
 * @returns {Promise<Object>} Deletion results
 */
async function deleteUserDataAcrossCollections(userId, userEmail, session) {
  const client = await clientPromise
  const usersDb = client.db('Users')
  const mediaDb = client.db('Media')
  
  const results = {}
  
  // Delete from AuthenticatedUsers
  const userResult = await usersDb.collection('AuthenticatedUsers').deleteOne(
    { _id: userId },
    { session }
  )
  results.AuthenticatedUsers = userResult.deletedCount
  
  // Delete from SSOAccounts
  const ssoResult = await usersDb.collection('SSOAccounts').deleteMany(
    { userId },
    { session }
  )
  results.SSOAccounts = ssoResult.deletedCount
  
  // Delete from session
  const sessionResult = await usersDb.collection('session').deleteMany(
    { userId },
    { session }
  )
  results.session = sessionResult.deletedCount
  
  // Delete from authSessions
  const authSessionResult = await usersDb.collection('authSessions').deleteMany(
    { 'tokens.user.id': userId.toString() },
    { session }
  )
  results.authSessions = authSessionResult.deletedCount
  
  // Delete from usedTokens (if any are tied to this user)
  const usedTokensResult = await usersDb.collection('usedTokens').deleteMany(
    { userId: userId.toString() },
    { session }
  )
  results.usedTokens = usedTokensResult.deletedCount
  
  // Delete user activity data from Media database
  const playbackResult = await mediaDb.collection('PlaybackStatus').deleteMany(
    { userId: userId.toString() },
    { session }
  )
  results.PlaybackStatus = playbackResult.deletedCount
  
  // Delete notifications
  const notificationsResult = await mediaDb.collection('Notifications').deleteMany(
    { userId },
    { session }
  )
  results.Notifications = notificationsResult.deletedCount
  
  // Delete any user-specific preferences or settings
  const preferencesResult = await mediaDb.collection('UserPreferences').deleteMany(
    { userId },
    { session }
  )
  results.UserPreferences = preferencesResult.deletedCount || 0
  
  return results
}

/**
 * Create an audit log entry for deletion actions
 * @param {Object} logData - Audit log data
 * @param {Object} session - Optional MongoDB session
 * @returns {Promise<Object>} Created audit log entry
 */
export async function createDeletionAuditLog(logData, session = null) {
  const client = await clientPromise
  const db = client.db('Users')
  
  const auditLog = {
    _id: new ObjectId(),
    deletionRequestId: logData.deletionRequestId,
    action: logData.action,
    performedBy: logData.performedBy ? new ObjectId(logData.performedBy) : null,
    performedAt: new Date(),
    details: logData.details || {},
    ipAddress: logData.ipAddress || null,
    userAgent: logData.userAgent || null
  }
  
  const options = session ? { session } : {}
  await db.collection('DeletionAuditLog').insertOne(auditLog, options)
  
  return auditLog
}

/**
 * Get deletion audit logs for a specific request
 * @param {string} deletionRequestId - Deletion request ID
 * @returns {Promise<Array>} Audit log entries
 */
export async function getDeletionAuditLogs(deletionRequestId) {
  const client = await clientPromise
  const db = client.db('Users')
  
  const logs = await db.collection('DeletionAuditLog').aggregate([
    { $match: { deletionRequestId: new ObjectId(deletionRequestId) } },
    { $sort: { performedAt: 1 } },
    {
      $lookup: {
        from: 'AuthenticatedUsers',
        localField: 'performedBy',
        foreignField: '_id',
        as: 'performer'
      }
    },
    {
      $addFields: {
        performer: { $arrayElemAt: ['$performer', 0] }
      }
    }
  ]).toArray()
  
  return logs
}

/**
 * Check for deletion requests that are ready for automatic execution
 * @returns {Promise<Array>} Deletion requests ready for execution
 */
export async function getReadyForDeletion() {
  const client = await clientPromise
  const db = client.db('Users')
  
  const now = new Date()
  const requests = await db.collection('DeletionRequests').find({
    status: 'pending',
    scheduledDeletionAt: { $lte: now }
  }).toArray()
  
  return requests
}

/**
 * Cleanup expired verification tokens
 * @returns {Promise<number>} Number of tokens cleaned up
 */
export async function cleanupExpiredTokens() {
  const client = await clientPromise
  const db = client.db('Users')
  
  const result = await db.collection('DeletionVerificationTokens').deleteMany({
    expiresAt: { $lt: new Date() }
  })
  
  return result.deletedCount
}