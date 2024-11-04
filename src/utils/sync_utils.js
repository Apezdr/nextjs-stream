/**
 * Filters out the locked fields from the update data, supporting nested fields.
 * Returns a flat object with dot-notated keys for unlocked fields.
 *
 * @param {Object} existingDoc - The existing document from currentDB.
 * @param {Object} updateData - The proposed update data.
 * @returns {Object} - The filtered update data excluding locked fields.
 */
function filterLockedFields(existingDoc, updateData) {
  const lockedFields = existingDoc.lockedFields || {}
  const result = {}

  function isFieldLocked(fieldPath) {
    const parts = fieldPath.split('.')
    let current = lockedFields

    for (const part of parts) {
      if (current[part] === true) {
        return true
      } else if (typeof current[part] === 'object' && current[part] !== null) {
        current = current[part]
      } else {
        return false
      }
    }
    return false
  }

  function process(obj, path = '', existingObj = existingDoc) {
    for (const key in obj) {
      const value = obj[key]
      const fullPath = path ? `${path}.${key}` : key

      if (isFieldLocked(fullPath)) {
        continue
      }

      // Get the corresponding value in existing document
      const existingValue = existingObj ? existingObj[key] : undefined

      // If the value is an object and the existing value is null or not an object, set the whole object
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (existingValue === null || typeof existingValue !== 'object')
      ) {
        // Set the entire object instead of flattening
        result[fullPath] = value
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Continue processing nested objects
        process(value, fullPath, existingValue)
      } else {
        result[fullPath] = value
      }
    }
  }

  process(updateData)
  return result
}

export { filterLockedFields }
