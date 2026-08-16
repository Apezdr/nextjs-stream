import {
  MOVIE_CONTENT_RATINGS,
  TV_CONTENT_RATINGS,
  SUPPORTED_CONTENT_RATINGS,
  isSupportedContentRating,
  normalizeContentDescriptors,
  normalizeContentRating,
  normalizeContentRatingCode,
} from '@src/utils/contentRatingSchema'
import {
  selectUsMovieContentRating,
  selectUsTvContentRating,
  tmdbContentRatingProvider,
} from '@src/utils/contentRatingTmdbProvider'
import { wikidataContentRatingEnricher } from '@src/utils/contentRatingWikidataEnricher'

export {
  MOVIE_CONTENT_RATINGS,
  TV_CONTENT_RATINGS,
  SUPPORTED_CONTENT_RATINGS,
  isSupportedContentRating,
  normalizeContentDescriptors,
  normalizeContentRating,
  normalizeContentRatingCode,
  selectUsMovieContentRating,
  selectUsTvContentRating,
}

export const CONTENT_RATING_PROVIDERS = Object.freeze([tmdbContentRatingProvider])
export const CONTENT_RATING_ENRICHERS = Object.freeze([wikidataContentRatingEnricher])

function readProperty(value, key) {
  try {
    return value?.[key]
  } catch {
    return undefined
  }
}

function readOwnDataProperty(value, key) {
  if (!value || typeof value !== 'object') return { exists: false, value: undefined }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor)) {
      return { exists: Boolean(descriptor), value: undefined }
    }
    return { exists: true, value: descriptor.value }
  } catch {
    return { exists: false, value: undefined }
  }
}

export function isContentRatingSuppressed(media) {
  const override = readOwnDataProperty(media, 'contentRatingOverride')
  return override.exists && override.value === null
}

export function getContentRatingForDisplay(media, legacyRating = null) {
  if (isContentRatingSuppressed(media)) return null
  return readProperty(media, 'contentRating') || legacyRating || null
}

function normalizeExternalId(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? String(value) : null
  }
  if (typeof value !== 'string' || value.length > 128) return null
  const id = value.trim()
  return id || null
}

function firstExternalId(...values) {
  for (const value of values) {
    const id = normalizeExternalId(value)
    if (id) return id
  }
  return null
}

function collectExternalIds(media, metadata) {
  const externalIds = {}
  const tmdb = firstExternalId(
    readProperty(media, 'tmdbId'),
    readProperty(metadata, 'id'),
    readProperty(media, 'showTmdbId')
  )
  const imdb = firstExternalId(
    readProperty(media, 'imdbId'),
    readProperty(metadata, 'imdb_id')
  )
  const tvdb = firstExternalId(
    readProperty(media, 'tvdbId'),
    readProperty(metadata, 'tvdb_id')
  )

  if (tmdb) externalIds.tmdb = tmdb
  if (imdb) externalIds.imdb = imdb
  if (tvdb) externalIds.tvdb = tvdb
  return Object.freeze(externalIds)
}

export function resolveContentRatingCandidates(candidates, mediaType) {
  if (!Array.isArray(candidates)) return null

  for (const candidate of candidates) {
    const normalized = normalizeContentRating(candidate, mediaType)
    if (normalized) return normalized
  }
  return null
}

export function resolveContentRatingWithProviders(
  media,
  mediaType,
  providers = CONTENT_RATING_PROVIDERS,
  enrichers = CONTENT_RATING_ENRICHERS
) {
  if (!media || typeof media !== 'object') return null

  const override = readOwnDataProperty(media, 'contentRatingOverride')
  if (override.exists) {
    if (override.value === null) return null
    const normalizedOverride = normalizeContentRating(override.value, mediaType)
    if (normalizedOverride) return normalizedOverride
  }

  const metadataValue = readProperty(media, 'metadata')
  const metadata = metadataValue && typeof metadataValue === 'object' ? metadataValue : null

  const context = Object.freeze({
    mediaType,
    metadata,
    externalIds: collectExternalIds(media, metadata),
  })

  const enrich = (baseRating) => {
    let current = baseRating
    for (const enricher of Array.isArray(enrichers) ? enrichers : []) {
      let candidate = null
      try {
        candidate = enricher?.enrichContentRating?.(current, context)
      } catch {
        continue
      }
      const normalized = normalizeContentRating(candidate, mediaType)
      if (
        !normalized ||
        normalized.contentRating !== current.contentRating ||
        normalized.country !== current.country ||
        normalized.system !== current.system ||
        normalized.mediaType !== current.mediaType ||
        normalized.provider !== current.provider ||
        normalized.source !== current.source
      ) continue
      current = normalized
    }
    return current
  }

  const direct = normalizeContentRating(readProperty(media, 'contentRating'), mediaType)
  if (direct) return enrich(direct)
  if (!metadata) return null

  const normalizedMetadata = normalizeContentRating(
    readProperty(metadata, 'contentRating'),
    mediaType
  )
  if (normalizedMetadata) return enrich(normalizedMetadata)

  for (const provider of Array.isArray(providers) ? providers : []) {
    let candidate = null
    try {
      candidate = provider?.getContentRating?.(context)
    } catch {
      continue
    }

    const resolved = resolveContentRatingCandidates([candidate], mediaType)
    if (resolved) return enrich(resolved)
  }

  const legacy = normalizeContentRating(
    readProperty(metadata, 'rating'),
    mediaType,
    { provider: 'legacy', source: 'TMDB' }
  )
  return legacy ? enrich(legacy) : null
}

export function resolveContentRating(media, mediaType) {
  return resolveContentRatingWithProviders(media, mediaType, CONTENT_RATING_PROVIDERS)
}
