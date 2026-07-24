/**
 * Manual validation for the ClientErrorReport envelope.
 * Contract: docs/react-native-app/client-error-reporting-contract.md
 *
 * Envelope fields are validated strictly (client faults get a 400 so the
 * fire-and-forget client never retries them as 5xx), while `message` and
 * `details` are stored raw per the contract — freeform platform text that
 * must not be normalized. Only oversize abuse guards touch them.
 */

export const VALID_SEVERITIES = ['fatal', 'error', 'warning']

// Known categories per contract; the field is extensible so unknown
// subsystem strings are accepted, just length-capped.
export const KNOWN_CATEGORIES = ['playback', 'network', 'auth', 'crash', 'other']

const MAX_MESSAGE_CHARS = 32000
const MAX_SHORT_STRING = 256

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function optionalString(value, maxLength = MAX_SHORT_STRING) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  return value.slice(0, maxLength)
}

/**
 * Validate and sanitize a client error report body.
 * Unknown top-level keys are dropped; `details` is passed through verbatim.
 *
 * @param {unknown} body - Parsed JSON request body
 * @returns {{ valid: true, report: Object } | { valid: false, error: string }}
 */
export function validateClientErrorReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { valid: false, error: 'Report body must be a JSON object' }
  }

  if (body.schemaVersion !== 1) {
    return { valid: false, error: 'Unsupported schemaVersion (expected 1)' }
  }

  if (!isNonEmptyString(body.category) || body.category.length > 50) {
    return { valid: false, error: 'category must be a non-empty string (max 50 chars)' }
  }

  if (!VALID_SEVERITIES.includes(body.severity)) {
    return { valid: false, error: `severity must be one of: ${VALID_SEVERITIES.join(', ')}` }
  }

  if (!isNonEmptyString(body.message)) {
    return { valid: false, error: 'message must be a non-empty string' }
  }

  if (!isNonEmptyString(body.dedupeKey) || body.dedupeKey.length > MAX_SHORT_STRING) {
    return { valid: false, error: `dedupeKey must be a non-empty string (max ${MAX_SHORT_STRING} chars)` }
  }

  if (!isNonEmptyString(body.occurredAt)) {
    return { valid: false, error: 'occurredAt must be an ISO 8601 string' }
  }

  const app = body.app
  if (!app || typeof app !== 'object' || Array.isArray(app)) {
    return { valid: false, error: 'app must be an object' }
  }
  if (!isNonEmptyString(app.version) || app.version.length > 100) {
    return { valid: false, error: 'app.version must be a non-empty string' }
  }
  if (!isNonEmptyString(app.platform) || app.platform.length > 50) {
    return { valid: false, error: 'app.platform must be a non-empty string' }
  }

  if (body.device !== undefined && body.device !== null) {
    if (typeof body.device !== 'object' || Array.isArray(body.device)) {
      return { valid: false, error: 'device must be an object when provided' }
    }
  }

  if (body.details !== undefined && body.details !== null) {
    if (typeof body.details !== 'object' || Array.isArray(body.details)) {
      return { valid: false, error: 'details must be an object when provided' }
    }
  }

  // Store the raw message; truncate only as an oversize abuse guard.
  const messageTruncated = body.message.length > MAX_MESSAGE_CHARS
  const message = messageTruncated ? body.message.slice(0, MAX_MESSAGE_CHARS) : body.message

  // Parse the client clock when possible; keep the raw string either way.
  const occurredAtDate = new Date(body.occurredAt)

  const device = body.device || {}

  const report = {
    schemaVersion: 1,
    category: body.category,
    severity: body.severity,
    message,
    messageTruncated,
    dedupeKey: body.dedupeKey,
    occurredAt: body.occurredAt,
    occurredAtDate: Number.isNaN(occurredAtDate.getTime()) ? null : occurredAtDate,
    app: {
      version: app.version,
      otaUpdateId: optionalString(app.otaUpdateId, 100),
      platform: app.platform,
      isTV: app.isTV === true,
    },
    device: {
      model: optionalString(device.model),
      brand: optionalString(device.brand),
      manufacturer: optionalString(device.manufacturer),
      osVersion: optionalString(device.osVersion, 50),
      apiLevel: typeof device.apiLevel === 'number' ? device.apiLevel : null,
    },
    details: body.details || {},
  }

  return { valid: true, report }
}
