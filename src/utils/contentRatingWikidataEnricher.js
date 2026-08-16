import {
  normalizeContentDescriptors,
  normalizeContentRating,
  normalizeContentRatingCertificateId,
} from '@src/utils/contentRatingSchema'

const RATING_CODES_BY_ENTITY = Object.freeze({
  Q18665330: 'G',
  Q18665334: 'PG',
  Q18665339: 'PG-13',
  Q18665344: 'R',
  Q18665349: 'NC-17',
})

function readOwnDataProperty(value, key) {
  if (!value || typeof value !== 'object') return undefined
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function normalizeTmdbMovieId(value) {
  const candidate = typeof value === 'number' && Number.isInteger(value)
    ? String(value)
    : typeof value === 'string'
      ? value
      : ''
  return /^[1-9]\d{0,7}$/.test(candidate) ? candidate : null
}

function normalizeImdbId(value) {
  return typeof value === 'string' && /^tt\d{7,8}$/.test(value) ? value : null
}

function normalizeEntityId(value) {
  return typeof value === 'string' && /^Q[1-9]\d{0,15}$/.test(value) ? value : null
}

function normalizeStatementId(value) {
  return typeof value === 'string' && /^Q[1-9]\d{0,15}\$[A-Za-z0-9-]{1,80}$/.test(value)
    ? value
    : null
}

function normalizeOfficialReferenceUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (
      hostname !== 'filmratings.com' &&
      !hostname.endsWith('.filmratings.com') &&
      hostname !== 'motionpictures.org' &&
      !hostname.endsWith('.motionpictures.org')
    ) return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function normalizeDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value)
    ? value
    : null
}

function normalizeRetrievedAt(value) {
  if (typeof value !== 'string' || value.length > 40) return null
  const timestamp = new Date(value)
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null
}

function enrichWithWikidata(baseRating, context) {
  if (
    !baseRating ||
    context?.mediaType !== 'movie' ||
    baseRating.mediaType !== 'movie' ||
    baseRating.country !== 'US' ||
    baseRating.system !== 'MPA'
  ) return baseRating

  const envelope = readOwnDataProperty(context.metadata, 'contentRatingEnrichments')
  const block = readOwnDataProperty(envelope, 'wikidata')
  if (!block || typeof block !== 'object' || readOwnDataProperty(block, 'schema') !== 1) {
    return baseRating
  }

  const contextTmdbId = normalizeTmdbMovieId(context.externalIds?.tmdb)
  const blockTmdbId = normalizeTmdbMovieId(readOwnDataProperty(block, 'tmdbMovieId'))
  if (!contextTmdbId || blockTmdbId !== contextTmdbId) return baseRating

  const contextImdbId = normalizeImdbId(context.externalIds?.imdb)
  const rawBlockImdbId = readOwnDataProperty(block, 'imdbId')
  const blockImdbId = rawBlockImdbId == null ? null : normalizeImdbId(rawBlockImdbId)
  if (rawBlockImdbId != null && !blockImdbId) return baseRating
  if (contextImdbId && blockImdbId && contextImdbId !== blockImdbId) return baseRating

  const sourceId = normalizeEntityId(readOwnDataProperty(block, 'entityId'))
  const ratingSourceId = normalizeEntityId(readOwnDataProperty(block, 'ratingEntityId'))
  const expectedCode = RATING_CODES_BY_ENTITY[ratingSourceId]
  if (
    !sourceId ||
    !expectedCode ||
    readOwnDataProperty(block, 'contentRating') !== expectedCode ||
    baseRating.contentRating !== expectedCode
  ) return baseRating

  const providerDescriptors = normalizeContentDescriptors(readOwnDataProperty(block, 'descriptors'))
  const adoptsDescriptors = baseRating.descriptors.length === 0 && providerDescriptors.length > 0
  const descriptors = adoptsDescriptors ? providerDescriptors : baseRating.descriptors

  const certificateProperty = readOwnDataProperty(block, 'certificateProperty')
  const certificateId = ['P14671', 'P2676'].includes(certificateProperty)
    ? normalizeContentRatingCertificateId(readOwnDataProperty(block, 'certificateId'))
    : null
  const fields = ['contentRating']
  if (adoptsDescriptors) fields.push('descriptors')
  if (certificateId) fields.push('certificateId')

  const statementId = normalizeStatementId(readOwnDataProperty(block, 'statementId'))
  const referenceUrl = normalizeOfficialReferenceUrl(readOwnDataProperty(block, 'referenceUrl'))
  const referencePublisherId = normalizeEntityId(readOwnDataProperty(block, 'referencePublisherId'))
  const referencePublicationDate = normalizeDateOnly(
    readOwnDataProperty(block, 'referencePublicationDate')
  )
  const retrievedAt = normalizeRetrievedAt(readOwnDataProperty(block, 'retrievedAt'))
  const externalIds = {
    tmdb: contextTmdbId,
    ...(contextImdbId || blockImdbId ? { imdb: contextImdbId || blockImdbId } : {}),
  }
  const existingEnrichments = Array.isArray(baseRating.enrichments)
    ? baseRating.enrichments.filter((enrichment) => enrichment?.provider !== 'wikidata')
    : []

  return normalizeContentRating({
    ...baseRating,
    descriptors,
    ...(certificateId ? { certificateId } : {}),
    enrichments: [
      ...existingEnrichments,
      {
        provider: 'wikidata',
        source: 'Wikidata',
        fields,
        sourceId,
        ratingSourceId,
        ...(statementId ? { statementId } : {}),
        externalIds,
        ...(certificateId ? { certificateProperty } : {}),
        ...(referenceUrl ? { referenceUrl } : {}),
        ...(referencePublisherId ? { referencePublisherId } : {}),
        ...(referencePublicationDate ? { referencePublicationDate } : {}),
        ...(retrievedAt ? { retrievedAt } : {}),
      },
    ],
  }, 'movie') || baseRating
}

export const wikidataContentRatingEnricher = Object.freeze({
  id: 'wikidata',
  enrichContentRating(baseRating, context) {
    try {
      return enrichWithWikidata(baseRating, context)
    } catch {
      return baseRating
    }
  },
})