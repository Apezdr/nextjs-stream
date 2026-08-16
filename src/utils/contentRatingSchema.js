export const MOVIE_CONTENT_RATINGS = Object.freeze(['G', 'PG', 'PG-13', 'R', 'NC-17', 'NR'])
export const TV_CONTENT_RATINGS = Object.freeze([
  'TV-Y',
  'TV-Y7',
  'TV-Y7-FV',
  'TV-G',
  'TV-PG',
  'TV-14',
  'TV-MA',
])
export const SUPPORTED_CONTENT_RATINGS = Object.freeze([
  ...MOVIE_CONTENT_RATINGS,
  ...TV_CONTENT_RATINGS,
])

const MAX_DESCRIPTOR_INPUTS = 32
export const MAX_CONTENT_DESCRIPTORS = 8
const MAX_DESCRIPTOR_LENGTH = 160
const MAX_CONTENT_RATING_ENRICHMENTS = 4
const MAX_ENRICHMENT_FIELDS = 8
const CONTENT_RATING_ENRICHMENT_FIELDS = new Set([
  'contentRating',
  'descriptors',
  'certificateId',
])

const MOVIE_ALIASES = new Map([
  ['G', 'G'],
  ['PG', 'PG'],
  ['PG-13', 'PG-13'],
  ['PG13', 'PG-13'],
  ['PG 13', 'PG-13'],
  ['R', 'R'],
  ['NC-17', 'NC-17'],
  ['NC17', 'NC-17'],
  ['NC 17', 'NC-17'],
  ['NR', 'NR'],
  ['UNRATED', 'NR'],
  ['NOT RATED', 'NR'],
  ['RATED G', 'G'],
  ['RATED PG', 'PG'],
  ['RATED PG-13', 'PG-13'],
  ['RATED R', 'R'],
  ['RATED NC-17', 'NC-17'],
])

const TV_ALIASES = new Map([
  ['TV-Y', 'TV-Y'],
  ['TVY', 'TV-Y'],
  ['TV Y', 'TV-Y'],
  ['TV-Y7', 'TV-Y7'],
  ['TVY7', 'TV-Y7'],
  ['TV Y7', 'TV-Y7'],
  ['TV-Y7-FV', 'TV-Y7-FV'],
  ['TV-Y7 FV', 'TV-Y7-FV'],
  ['TV Y7 FV', 'TV-Y7-FV'],
  ['TVY7FV', 'TV-Y7-FV'],
  ['TV-G', 'TV-G'],
  ['TVG', 'TV-G'],
  ['TV G', 'TV-G'],
  ['TV-PG', 'TV-PG'],
  ['TVPG', 'TV-PG'],
  ['TV PG', 'TV-PG'],
  ['TV-14', 'TV-14'],
  ['TV14', 'TV-14'],
  ['TV 14', 'TV-14'],
  ['TV-MA', 'TV-MA'],
  ['TVMA', 'TV-MA'],
  ['TV MA', 'TV-MA'],
])

function cleanRatingInput(value) {
  if (typeof value !== 'string' || value.length > 32) return null

  const cleaned = value.trim().toUpperCase().replaceAll('_', ' ').replace(/\s+/g, ' ')
  if (!cleaned || !/^[A-Z0-9 -]+$/.test(cleaned)) return null
  return cleaned
}

export function normalizeContentRatingCode(value, mediaType = null) {
  const cleaned = cleanRatingInput(value)
  if (!cleaned) return null

  if (mediaType === 'movie') return MOVIE_ALIASES.get(cleaned) || null
  if (mediaType === 'tv') return TV_ALIASES.get(cleaned) || null
  if (mediaType !== null && mediaType !== undefined) return null

  return MOVIE_ALIASES.get(cleaned) || TV_ALIASES.get(cleaned) || null
}

export function isSupportedContentRating(value) {
  return typeof value === 'string' && SUPPORTED_CONTENT_RATINGS.includes(value)
}

function hasUnsafeDescriptorCharacter(value) {
  if (
    value.includes('<') ||
    value.includes('>') ||
    /&(?:lt|gt|#0*(?:60|62)|#x0*3[ce]);/i.test(value) ||
    /\p{Cf}/u.test(value)
  ) {
    return true
  }

  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)
    return (
      codePoint <= 31 ||
      (codePoint >= 127 && codePoint <= 159) ||
      codePoint === 0x061c ||
      codePoint === 0x200e ||
      codePoint === 0x200f ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    )
  })
}

export function normalizeContentDescriptors(value) {
  if (!Array.isArray(value)) return []

  const descriptors = []
  const seen = new Set()

  for (const candidate of value.slice(0, MAX_DESCRIPTOR_INPUTS)) {
    if (typeof candidate !== 'string' || candidate.length > MAX_DESCRIPTOR_LENGTH) continue

    const descriptor = candidate.normalize('NFC').trim().replace(/\s+/g, ' ')
    if (!descriptor || hasUnsafeDescriptorCharacter(descriptor)) continue

    const key = descriptor.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue

    seen.add(key)
    descriptors.push(descriptor)
    if (descriptors.length === MAX_CONTENT_DESCRIPTORS) break
  }

  return descriptors
}

// Descriptors may legitimately contain commas, so the editor uses one line
// per descriptor and leaves punctuation intact.
export function parseContentDescriptorInput(value) {
  if (typeof value !== 'string') return []
  return normalizeContentDescriptors(value.split('\n'))
}

function expectedSystem(mediaType) {
  if (mediaType === 'movie') return 'MPA'
  if (mediaType === 'tv') return 'TV Parental Guidelines'
  return null
}

function normalizeProviderId(value) {
  if (typeof value !== 'string' || value.length > 32) return null
  const provider = value.trim().toLowerCase()
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(provider) ? provider : null
}

function normalizeSource(value) {
  if (typeof value !== 'string' || value.length > 32) return null
  const source = value.trim()
  return source && /^[A-Za-z0-9 _-]+$/.test(source) ? source : null
}

function resolveProvenance(value, provenance = null) {
  const requestedProvider = provenance?.provider ?? value?.provider
  const requestedSource = provenance?.source ?? value?.source
  const source = normalizeSource(requestedSource)
  let provider = normalizeProviderId(requestedProvider)

  if (!provider && source === 'TMDB') provider = 'tmdb'
  if (!provider && requestedSource !== undefined) return null
  if (!provider) provider = 'legacy'

  return {
    provider,
    source: source || (provider === 'tmdb' || provider === 'legacy' ? 'TMDB' : provider.toUpperCase()),
  }
}

export function normalizeContentRatingCertificateId(value) {
  if (typeof value !== 'string') return null
  const certificateId = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9 ./-]{0,31}$/.test(certificateId)
    ? certificateId
    : null
}

function normalizeEvidenceId(value) {
  if (typeof value !== 'string' || value.length > 96) return null
  const id = value.trim()
  return /^[A-Za-z0-9][A-Za-z0-9:$._/-]*$/.test(id) ? id : null
}

function normalizeEvidenceFields(value) {
  if (!Array.isArray(value)) return []
  const fields = []
  for (const field of value.slice(0, MAX_ENRICHMENT_FIELDS)) {
    if (!CONTENT_RATING_ENRICHMENT_FIELDS.has(field) || fields.includes(field)) continue
    fields.push(field)
  }
  return fields
}

function normalizeEvidenceExternalIds(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const externalIds = {}
  if (typeof value.tmdb === 'string' && /^[1-9]\d{0,7}$/.test(value.tmdb)) {
    externalIds.tmdb = value.tmdb
  }
  if (typeof value.imdb === 'string' && /^tt\d{7,8}$/.test(value.imdb)) {
    externalIds.imdb = value.imdb
  }
  return Object.keys(externalIds).length > 0 ? externalIds : null
}

function normalizeEvidenceUrl(value) {
  if (typeof value !== 'string' || value.length > 512) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
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

function normalizeContentRatingEnrichment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const provenance = resolveProvenance(value)
  if (!provenance) return null

  const fields = normalizeEvidenceFields(value.fields)
  if (fields.length === 0) return null
  const sourceId = normalizeEvidenceId(value.sourceId)
  const ratingSourceId = normalizeEvidenceId(value.ratingSourceId)
  const statementId = normalizeEvidenceId(value.statementId)
  const externalIds = normalizeEvidenceExternalIds(value.externalIds)
  const certificateProperty = typeof value.certificateProperty === 'string'
    && /^P\d{1,10}$/.test(value.certificateProperty)
    ? value.certificateProperty
    : null
  const referenceUrl = normalizeEvidenceUrl(value.referenceUrl)
  const referencePublisherId = normalizeEvidenceId(value.referencePublisherId)
  const referencePublicationDate = normalizeDateOnly(value.referencePublicationDate)
  const retrievedAt = normalizeRetrievedAt(value.retrievedAt)

  return {
    ...provenance,
    fields,
    ...(sourceId ? { sourceId } : {}),
    ...(ratingSourceId ? { ratingSourceId } : {}),
    ...(statementId ? { statementId } : {}),
    ...(externalIds ? { externalIds } : {}),
    ...(certificateProperty ? { certificateProperty } : {}),
    ...(referenceUrl ? { referenceUrl } : {}),
    ...(referencePublisherId ? { referencePublisherId } : {}),
    ...(referencePublicationDate ? { referencePublicationDate } : {}),
    ...(retrievedAt ? { retrievedAt } : {}),
  }
}

function normalizeContentRatingEnrichments(value) {
  if (!Array.isArray(value)) return []
  const enrichments = []
  const providers = new Set()

  for (const candidate of value.slice(0, MAX_CONTENT_RATING_ENRICHMENTS)) {
    try {
      const enrichment = normalizeContentRatingEnrichment(candidate)
      if (!enrichment || providers.has(enrichment.provider)) continue
      providers.add(enrichment.provider)
      enrichments.push(enrichment)
    } catch {
      continue
    }
  }
  return enrichments
}

export function buildContentRating(
  contentRating,
  mediaType,
  descriptors = [],
  provenance = null,
  extensions = null
) {
  const normalizedProvenance = resolveProvenance(null, provenance)
  if (!normalizedProvenance) return null

  const normalizedDescriptors = normalizeContentDescriptors(descriptors)
  const certificateId = normalizeContentRatingCertificateId(extensions?.certificateId)
  const enrichments = normalizeContentRatingEnrichments(extensions?.enrichments)
    .map((enrichment) => ({
      ...enrichment,
      fields: enrichment.fields.filter((field) =>
        field === 'contentRating' ||
        (field === 'descriptors' && normalizedDescriptors.length > 0) ||
        (field === 'certificateId' && certificateId)
      ),
    }))
    .filter((enrichment) => enrichment.fields.length > 0)

  return {
    contentRating,
    country: 'US',
    system: expectedSystem(mediaType),
    mediaType,
    descriptors: normalizedDescriptors,
    reason: null,
    source: normalizedProvenance.source,
    provider: normalizedProvenance.provider,
    ...(certificateId ? { certificateId } : {}),
    ...(enrichments.length > 0 ? { enrichments } : {}),
  }
}

function normalizeContentRatingValue(value, mediaType, provenance) {
  if (typeof value === 'string') {
    const contentRating = normalizeContentRatingCode(value, mediaType)
    if (!contentRating) return null

    const resolvedType = mediaType || (MOVIE_CONTENT_RATINGS.includes(contentRating) ? 'movie' : 'tv')
    return buildContentRating(contentRating, resolvedType, [], provenance)
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const declaredType = value.mediaType
  const resolvedType = mediaType || declaredType
  if (!['movie', 'tv'].includes(resolvedType)) return null
  if (declaredType && declaredType !== resolvedType) return null
  if (value.country !== undefined && (
    typeof value.country !== 'string' || value.country.trim().toUpperCase() !== 'US'
  )) return null
  if (value.system !== undefined && value.system !== expectedSystem(resolvedType)) return null

  const normalizedProvenance = resolveProvenance(value, provenance)
  if (!normalizedProvenance) return null

  const contentRating = normalizeContentRatingCode(value.contentRating, resolvedType)
  if (!contentRating) return null

  return buildContentRating(
    contentRating,
    resolvedType,
    value.descriptors,
    normalizedProvenance,
    value
  )
}

export function normalizeContentRating(value, mediaType = null, provenance = null) {
  try {
    return normalizeContentRatingValue(value, mediaType, provenance)
  } catch {
    return null
  }
}
