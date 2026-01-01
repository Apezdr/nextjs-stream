/**
 * Utility functions for handling automatic user approval
 */

/**
 * Check if automatic user approval is enabled
 * @returns {boolean} True if auto-approval is enabled, false otherwise
 */
export function isAutoApprovalEnabled() {
  return process.env.AUTO_APPROVE_USERS?.toString().toLowerCase() === 'true'
}

/**
 * Get the default approval status for new users
 * @returns {boolean} True if users should be auto-approved, false if manual approval is required
 */
export function getDefaultApprovalStatus() {
  return isAutoApprovalEnabled()
}