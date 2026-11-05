/**
 * User Query Factory
 * 
 * Centralized user collection queries for Better Auth integration.
 * Handles ObjectId/string conversion automatically and provides consistent
 * query patterns across the application.
 *
 * Every write here also drops the user's cached sessions in Redis
 * (authSessionStore.forgetUserSessions): better-auth caches each session with
 * its user, and refreshes that copy only for writes made through better-auth.
 * Write users only through these helpers, never through collection().
 * 
 * @module lib/userQueries
 */

import { ObjectId } from 'mongodb'
import { mongoClient } from './mongodb'
import { forgetUserSessions } from './authSessionStore'

/**
 * Get the Users database instance
 * Uses environment variable or defaults to 'Users'
 */
const getUsersDb = () => mongoClient.db(process.env.MONGODB_AUTH_DB || 'Users')

/**
 * Convert various userId formats to the proper database format
 * 
 * Handles the inconsistency in Better Auth where generateId returns
 * a hex string but some code expects ObjectId.
 * 
 * @param {string|ObjectId} id - User ID in any format
 * @returns {string|ObjectId|null} Properly formatted user ID for queries
 */
function normalizeUserId(id) {
  if (!id) return null
  
  // Already an ObjectId
  if (typeof id === 'object' && id._bsontype === 'ObjectId') {
    return id
  }
  
  // String format - try to convert to ObjectId
  if (typeof id === 'string') {
    try {
      // Validate it's a valid ObjectId string (24 hex characters)
      if (/^[0-9a-fA-F]{24}$/.test(id)) {
        return new ObjectId(id)
      }
      // Invalid format, return as-is (will likely fail query)
      return id
    } catch (err) {
      console.warn('Failed to convert userId to ObjectId:', id, err)
      return id
    }
  }
  
  return id
}

/**
 * User query factory - provides centralized access to user collection
 */
export const userQueries = {
  /**
   * Convert userId to proper format for querying
   * 
   * @param {string|ObjectId} id - User ID in any format
   * @returns {string|ObjectId|null} Normalized user ID
   * 
   * @example
   * const userId = userQueries.toUserId('507f1f77bcf86cd799439011')
   */
  toUserId: normalizeUserId,

  /**
   * Find user by ID
   * 
   * @param {string|ObjectId} userId - User ID
   * @param {Object} [projection={}] - MongoDB projection object
   * @returns {Promise<Object|null>} User document or null
   * 
   * @example
   * const user = await userQueries.findById(userId)
   * const userIdOnly = await userQueries.findById(userId, { _id: 1 })
   */
  findById: async (userId, projection = {}) => {
    const db = getUsersDb()
    return db.collection('user').findOne(
      { _id: normalizeUserId(userId) },
      Object.keys(projection).length > 0 ? { projection } : {}
    )
  },

  /**
   * Find user by email
   * 
   * @param {string} email - User email address
   * @param {Object} [projection={}] - MongoDB projection object
   * @returns {Promise<Object|null>} User document or null
   * 
   * @example
   * const user = await userQueries.findByEmail('user@example.com')
   */
  findByEmail: async (email, projection = {}) => {
    const db = getUsersDb()
    return db.collection('user').findOne(
      { email },
      Object.keys(projection).length > 0 ? { projection } : {}
    )
  },

  /**
   * Check if user exists by ID
   * 
   * @param {string|ObjectId} userId - User ID
   * @returns {Promise<boolean>} True if user exists
   * 
   * @example
   * if (await userQueries.exists(userId)) {
   *   // User exists
   * }
   */
  exists: async (userId) => {
    const db = getUsersDb()
    const count = await db.collection('user').countDocuments(
      { _id: normalizeUserId(userId) },
      { limit: 1 }
    )
    return count > 0
  },

  /**
   * Get all users with optional filter and projection
   * 
   * @param {Object} [filter={}] - MongoDB filter object
   * @param {Object} [projection={}] - MongoDB projection object
   * @returns {Promise<Array>} Array of user documents
   * 
   * @example
   * const allUsers = await userQueries.findAll()
   * const approvedUsers = await userQueries.findAll({ approved: true })
   */
  findAll: async (filter = {}, projection = {}) => {
    const db = getUsersDb()
    return db.collection('user')
      .find(filter, Object.keys(projection).length > 0 ? { projection } : {})
      .toArray()
  },

  /**
   * Find multiple users matching a query
   * 
   * @param {Object} query - MongoDB query object
   * @param {Object} [projection={}] - MongoDB projection object
   * @returns {Promise<Array>} Array of user documents
   * 
   * @example
   * const adminUsers = await userQueries.find({ role: 'admin' })
   */
  find: async (query, projection = {}) => {
    const db = getUsersDb()
    return db.collection('user')
      .find(query, Object.keys(projection).length > 0 ? { projection } : {})
      .toArray()
  },

  /**
   * Update user by ID
   * 
   * @param {string|ObjectId} userId - User ID
   * @param {Object} update - Update object for $set operation
   * @param {Object} [options={}] - Additional update options
   * @returns {Promise<Object>} MongoDB update result
   * 
   * @example
   * await userQueries.updateById(userId, { approved: true })
   * await userQueries.updateById(userId, { 'preferences.theme': 'dark' })
   */
  updateById: async (userId, update, options = {}) => {
    const db = getUsersDb()
    const result = await db.collection('user').updateOne(
      { _id: normalizeUserId(userId) },
      { $set: update },
      options
    )
    await forgetUserSessions(userId)
    return result
  },

  /**
   * Update user with custom update operation
   * 
   * @param {string|ObjectId} userId - User ID
   * @param {Object} updateOperation - Full MongoDB update operation
   * @param {Object} [options={}] - Additional update options
   * @returns {Promise<Object>} MongoDB update result
   * 
   * @example
   * await userQueries.updateByIdCustom(userId, { 
   *   $set: { approved: true },
   *   $push: { loginHistory: new Date() }
   * })
   */
  updateByIdCustom: async (userId, updateOperation, options = {}) => {
    const db = getUsersDb()
    const result = await db.collection('user').updateOne(
      { _id: normalizeUserId(userId) },
      updateOperation,
      options
    )
    await forgetUserSessions(userId)
    return result
  },

  /**
   * Update every user matching a filter, then drop the cached sessions of each
   * user it matched
   *
   * @param {Object} filter - MongoDB filter
   * @param {Object|Object[]} update - Update document or pipeline
   * @param {Object} [options={}] - Additional update options
   * @returns {Promise<Object>} MongoDB update result
   */
  updateMany: async (filter, update, options = {}) => {
    const users = getUsersDb().collection('user')
    const matched = await users.find(filter, { projection: { _id: 1 } }).toArray()
    const result = await users.updateMany(filter, update, options)
    await forgetUserSessions(matched.map((user) => user._id))
    return result
  },

  /**
   * Delete user by ID
   * 
   * @param {string|ObjectId} userId - User ID
   * @returns {Promise<Object>} MongoDB delete result
   * 
   * @example
   * const result = await userQueries.deleteById(userId)
   * if (result.deletedCount > 0) {
   *   // User deleted
   * }
   */
  deleteById: async (userId) => {
    const db = getUsersDb()
    const result = await db.collection('user').deleteOne(
      { _id: normalizeUserId(userId) }
    )
    await forgetUserSessions(userId)
    return result
  },

  /**
   * Get direct access to the user collection, for reads not covered by the
   * helpers. Writes go through the helpers, which drop cached sessions
   * 
   * @returns {Collection} MongoDB collection object
   * 
   * @example
   * const collection = userQueries.collection()
   * const result = await collection.aggregate([...])
   */
  collection: () => {
    const db = getUsersDb()
    return db.collection('user')
  },
}
