/**
 * Log sanitizer utility to prevent OOM errors from logging large objects
 * Particularly important for objects containing blurhash strings
 */

const BLURHASH_TRUNCATE_LENGTH = 20
const MAX_STRING_LENGTH = 200
const MAX_ARRAY_ITEMS = 5

/**
 * Sanitize an object for safe logging by truncating/removing large values
 */
export function sanitizeForLog(obj: any, maxDepth = 2, currentDepth = 0): any {
  if (obj === null || obj === undefined) return obj
  
  // Prevent deep recursion
  if (currentDepth >= maxDepth) {
    return '[Max depth reached]'
  }

  // Handle primitives
  if (typeof obj !== 'object') {
    if (typeof obj === 'string' && obj.length > MAX_STRING_LENGTH) {
      return `${obj.substring(0, MAX_STRING_LENGTH)}... (${obj.length} chars)`
    }
    return obj
  }

  // Handle arrays
  if (Array.isArray(obj)) {
    if (obj.length > MAX_ARRAY_ITEMS) {
      return [
        ...obj.slice(0, MAX_ARRAY_ITEMS).map(item => sanitizeForLog(item, maxDepth, currentDepth + 1)),
        `... (${obj.length - MAX_ARRAY_ITEMS} more items)`
      ]
    }
    return obj.map(item => sanitizeForLog(item, maxDepth, currentDepth + 1))
  }

  // Handle objects
  const sanitized: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    // Special handling for blurhash fields
    if (key.toLowerCase().includes('blurhash') && typeof value === 'string') {
      sanitized[key] = value.length > BLURHASH_TRUNCATE_LENGTH
        ? `${value.substring(0, BLURHASH_TRUNCATE_LENGTH)}... (${value.length} chars)`
        : value
    }
    // Recursively sanitize nested objects
    else {
      sanitized[key] = sanitizeForLog(value, maxDepth, currentDepth + 1)
    }
  }
  
  return sanitized
}

/**
 * Create a minimal summary of an entity for logging (without large fields)
 */
export function createEntitySummary(entity: any): string {
  if (!entity) return 'null'
  
  const parts: string[] = []
  
  if (entity.title) parts.push(`title="${entity.title}"`)
  if (entity.originalTitle && entity.originalTitle !== entity.title) {
    parts.push(`originalTitle="${entity.originalTitle}"`)
  }
  if (entity._id) parts.push(`id=${entity._id}`)
  if (entity.syncVersion) parts.push(`v${entity.syncVersion}`)
  
  return parts.join(', ') || 'entity'
}

/**
 * Safe wrapper for JSON.stringify with sanitization
 */
export function safeStringify(obj: any, maxDepth = 2): string {
  try {
    return JSON.stringify(sanitizeForLog(obj, maxDepth), null, 2)
  } catch (error) {
    return '[Serialization Error]'
  }
}
