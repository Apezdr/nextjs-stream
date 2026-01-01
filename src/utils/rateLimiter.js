/**
 * Simple in-memory rate limiter utility
 * In production, this should be replaced with Redis or database-backed rate limiting
 */

class RateLimiter {
  constructor() {
    this.store = new Map()
    this.cleanupInterval = null
    this.startCleanup()
  }

  /**
   * Check if a request should be rate limited
   * @param {string} key - Unique identifier for the rate limit (e.g., IP address, user ID)
   * @param {number} maxRequests - Maximum number of requests allowed
   * @param {number} windowMs - Time window in milliseconds
   * @returns {Object} Rate limit result
   */
  isRateLimited(key, maxRequests = 10, windowMs = 60 * 60 * 1000) {
    const now = Date.now()
    const windowStart = now - windowMs

    if (!this.store.has(key)) {
      this.store.set(key, {
        requests: [],
        firstRequest: now
      })
    }

    const bucket = this.store.get(key)
    
    // Remove old requests outside the window
    bucket.requests = bucket.requests.filter(timestamp => timestamp > windowStart)
    
    // Check if limit exceeded
    if (bucket.requests.length >= maxRequests) {
      const oldestRequest = Math.min(...bucket.requests)
      const resetTime = oldestRequest + windowMs
      const retryAfter = Math.ceil((resetTime - now) / 1000)

      return {
        isLimited: true,
        remaining: 0,
        resetTime,
        retryAfter: Math.max(retryAfter, 1)
      }
    }

    // Add current request
    bucket.requests.push(now)
    this.store.set(key, bucket)

    return {
      isLimited: false,
      remaining: maxRequests - bucket.requests.length,
      resetTime: bucket.requests[0] + windowMs,
      retryAfter: 0
    }
  }

  /**
   * Get current rate limit status without incrementing
   * @param {string} key - Unique identifier
   * @param {number} maxRequests - Maximum requests allowed
   * @param {number} windowMs - Time window in milliseconds
   * @returns {Object} Current status
   */
  getStatus(key, maxRequests = 10, windowMs = 60 * 60 * 1000) {
    const now = Date.now()
    const windowStart = now - windowMs

    if (!this.store.has(key)) {
      return {
        remaining: maxRequests,
        resetTime: now + windowMs,
        isLimited: false
      }
    }

    const bucket = this.store.get(key)
    const validRequests = bucket.requests.filter(timestamp => timestamp > windowStart)
    
    return {
      remaining: Math.max(0, maxRequests - validRequests.length),
      resetTime: validRequests.length > 0 ? validRequests[0] + windowMs : now + windowMs,
      isLimited: validRequests.length >= maxRequests
    }
  }

  /**
   * Reset rate limit for a specific key
   * @param {string} key - Key to reset
   */
  reset(key) {
    this.store.delete(key)
  }

  /**
   * Clear all rate limit data
   */
  clear() {
    this.store.clear()
  }

  /**
   * Start automatic cleanup of expired entries
   */
  startCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    // Clean up every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 5 * 60 * 1000)
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now()
    const maxAge = 24 * 60 * 60 * 1000 // 24 hours

    for (const [key, bucket] of this.store.entries()) {
      // Remove entries older than 24 hours
      if (now - bucket.firstRequest > maxAge) {
        this.store.delete(key)
        continue
      }

      // Clean up old requests within the bucket
      const validRequests = bucket.requests.filter(timestamp => 
        now - timestamp < maxAge
      )

      if (validRequests.length === 0) {
        this.store.delete(key)
      } else {
        bucket.requests = validRequests
        this.store.set(key, bucket)
      }
    }
  }

  /**
   * Get statistics about the rate limiter
   * @returns {Object} Statistics
   */
  getStats() {
    return {
      totalKeys: this.store.size,
      totalRequests: Array.from(this.store.values()).reduce(
        (sum, bucket) => sum + bucket.requests.length, 
        0
      )
    }
  }
}

// Create singleton instance
const rateLimiter = new RateLimiter()

// Predefined rate limit configurations
export const RATE_LIMITS = {
  // Account deletion requests
  DELETION_REQUEST: {
    maxRequests: 3,
    windowMs: 60 * 60 * 1000 // 1 hour
  },
  
  // Status checks
  STATUS_CHECK: {
    maxRequests: 10,
    windowMs: 60 * 60 * 1000 // 1 hour
  },
  
  // Email verification
  EMAIL_VERIFICATION: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000 // 1 hour
  },
  
  // General API requests
  API_GENERAL: {
    maxRequests: 100,
    windowMs: 60 * 60 * 1000 // 1 hour
  },
  
  // Admin operations
  ADMIN_OPERATIONS: {
    maxRequests: 50,
    windowMs: 60 * 60 * 1000 // 1 hour
  }
}

/**
 * Helper function to extract client IP from request
 * @param {Request} request - The request object
 * @returns {string} Client IP address
 */
export function getClientIP(request) {
  // Check various headers for the real IP
  const forwarded = request.headers.get('x-forwarded-for')
  const realIP = request.headers.get('x-real-ip')
  const cfConnectingIP = request.headers.get('cf-connecting-ip')
  
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  
  if (realIP) {
    return realIP
  }
  
  if (cfConnectingIP) {
    return cfConnectingIP
  }
  
  // Fallback
  return 'unknown'
}

/**
 * Middleware function to check rate limits
 * @param {Request} request - The request object
 * @param {Object} config - Rate limit configuration
 * @param {string} keyPrefix - Optional prefix for the rate limit key
 * @returns {Object} Rate limit result
 */
export function checkRateLimit(request, config = RATE_LIMITS.API_GENERAL, keyPrefix = '') {
  const clientIP = getClientIP(request)
  const key = keyPrefix ? `${keyPrefix}_${clientIP}` : clientIP
  
  return rateLimiter.isRateLimited(key, config.maxRequests, config.windowMs)
}

/**
 * Create rate limit headers for response
 * @param {Object} rateLimitResult - Result from rate limiter
 * @returns {Object} Headers object
 */
export function createRateLimitHeaders(rateLimitResult) {
  const headers = {
    'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(rateLimitResult.resetTime / 1000).toString()
  }

  if (rateLimitResult.isLimited) {
    headers['Retry-After'] = rateLimitResult.retryAfter.toString()
  }

  return headers
}

export default rateLimiter