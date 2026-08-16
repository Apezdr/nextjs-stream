import { normalizeContentRating } from '@src/utils/contentRatingSchema'

const INVALID_SELECTION = 'Invalid content rating selection.'

function emptyResult() {
  return { error: null, set: {}, unset: {} }
}

function invalidResult() {
  return { error: INVALID_SELECTION, set: {}, unset: {} }
}

function ownDataValue(value, key) {
  if (!value || typeof value !== 'object') return { exists: false, value: undefined }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor) return { exists: false, value: undefined }
    if (!('value' in descriptor)) return { exists: true, invalid: true, value: undefined }
    return { exists: true, value: descriptor.value }
  } catch {
    return { exists: true, invalid: true, value: undefined }
  }
}

export function prepareContentRatingOverrideUpdate(
  payload,
  mediaType,
  { isCreate = false } = {}
) {
  const intentProperty = ownDataValue(payload, 'contentRatingIntent')
  if (!intentProperty.exists) return emptyResult()
  if (intentProperty.invalid || !['automatic', 'set', 'suppress'].includes(intentProperty.value)) {
    return invalidResult()
  }

  const locksProperty = ownDataValue(payload, 'lockedFields')
  if (locksProperty.invalid) return invalidResult()
  const ratingLock = ownDataValue(locksProperty.value, 'contentRating')
  if (ratingLock.invalid) return invalidResult()
  const locked = ratingLock.value === true

  if (intentProperty.value === 'automatic') {
    if (locked) return invalidResult()
    return {
      error: null,
      set: {},
      unset: isCreate
        ? {}
        : {
            contentRatingOverride: '',
            'manualFields.contentRating': '',
          },
    }
  }

  if (!locked) return invalidResult()

  const codeProperty = ownDataValue(payload, 'contentRatingCode')
  if (codeProperty.invalid || typeof codeProperty.value !== 'string' || codeProperty.value.length > 32) {
    return invalidResult()
  }
  const code = codeProperty.value.trim()

  if (intentProperty.value === 'suppress') {
    if (code !== '') return invalidResult()
    return {
      error: null,
      set: {
        contentRatingOverride: null,
        'manualFields.contentRating': true,
      },
      unset: {},
    }
  }

  if (!code) return invalidResult()
  const descriptorsProperty = ownDataValue(payload, 'contentRatingDescriptors')
  if (descriptorsProperty.invalid) return invalidResult()
  if (descriptorsProperty.exists && !Array.isArray(descriptorsProperty.value)) {
    return invalidResult()
  }

  const normalized = normalizeContentRating(
    {
      contentRating: code,
      descriptors: descriptorsProperty.exists ? descriptorsProperty.value : [],
    },
    mediaType,
    {
      provider: 'manual',
      source: 'Manual',
    }
  )
  if (!normalized) return invalidResult()

  return {
    error: null,
    set: {
      contentRatingOverride: normalized,
      'manualFields.contentRating': true,
    },
    unset: {},
  }
}
