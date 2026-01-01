/**
 * Feature flag utilities for sync architecture switching
 * Provides centralized control for migrating from flat sync to new domain-driven architecture
 */

/**
 * Check if new sync architecture should be used
 * @param {Object} options - Override options
 * @param {boolean} options.forceNew - Force use of new architecture regardless of environment
 * @param {boolean} options.forceOld - Force use of old architecture regardless of environment
 * @returns {boolean} True if new architecture should be used
 */
export function shouldUseNewArchitecture(options = {}) {
  // Allow runtime override to force new architecture
  if (options.forceNew === true) {
    console.log('🔬 Feature flag: Forcing NEW sync architecture (runtime override)')
    return true
  }

  // Allow runtime override to force old architecture
  if (options.forceOld === true) {
    console.log('🔬 Feature flag: Forcing OLD sync architecture (runtime override)')
    return false
  }

  // Check environment variable
  const envFlag = process.env.USE_NEW_SYNC_ARCHITECTURE
  
  if (envFlag === 'true' || envFlag === '1') {
    console.log('🆕 Feature flag: Using NEW sync architecture (environment enabled)')
    return true
  }

  // Default to old architecture for safety
  console.log('🔄 Feature flag: Using OLD sync architecture (default/environment disabled)')
  return false
}

/**
 * Get feature flag status for debugging
 * @returns {Object} Feature flag status information
 */
export function getFeatureFlagStatus() {
  const envValue = process.env.USE_NEW_SYNC_ARCHITECTURE
  const shouldUseNew = shouldUseNewArchitecture()

  return {
    environmentVariable: envValue || 'undefined',
    effectiveValue: shouldUseNew,
    source: envValue ? 'environment' : 'default'
  }
}

/**
 * Log feature flag decision with context
 * @param {string} operation - The operation being performed
 * @param {boolean} usingNew - Whether new architecture is being used
 * @param {string} reason - Reason for the decision
 */
export function logFeatureFlagDecision(operation, usingNew, reason = '') {
  const architecture = usingNew ? 'NEW domain-driven' : 'OLD flat sync'
  const emoji = usingNew ? '🆕' : '🔄'
  
  console.log(`${emoji} ${operation}: Using ${architecture} architecture${reason ? ` (${reason})` : ''}`)
}

/**
 * Validate feature flag configuration
 * @returns {Object} Validation results
 */
export function validateFeatureFlagConfig() {
  const envValue = process.env.USE_NEW_SYNC_ARCHITECTURE
  const warnings = []
  const errors = []

  // Check for common configuration issues
  if (envValue && !['true', 'false', '1', '0'].includes(envValue.toLowerCase())) {
    warnings.push(`USE_NEW_SYNC_ARCHITECTURE has unexpected value: "${envValue}". Use "true" or "false".`)
  }

  // Check if new architecture dependencies are available
  try {
    // This will help catch import issues early
    require('./SyncManager')
    require('./core')
    require('./infrastructure')
  } catch (error) {
    errors.push(`New sync architecture dependencies not available: ${error.message}`)
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    currentConfig: getFeatureFlagStatus()
  }
}

/**
 * Helper for testing - temporarily override feature flag
 * @param {boolean} useNew - Whether to use new architecture
 * @param {Function} fn - Function to execute with override
 * @returns {Promise} Result of the function
 */
export async function withFeatureFlagOverride(useNew, fn) {
  const originalValue = process.env.USE_NEW_SYNC_ARCHITECTURE
  
  try {
    process.env.USE_NEW_SYNC_ARCHITECTURE = useNew ? 'true' : 'false'
    console.log(`🧪 Temporarily overriding feature flag: USE_NEW_SYNC_ARCHITECTURE=${useNew}`)
    
    return await fn()
  } finally {
    // Restore original value
    if (originalValue !== undefined) {
      process.env.USE_NEW_SYNC_ARCHITECTURE = originalValue
    } else {
      delete process.env.USE_NEW_SYNC_ARCHITECTURE
    }
    console.log(`🔄 Restored feature flag to original state`)
  }
}