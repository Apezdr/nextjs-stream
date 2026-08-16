import {
  buildContentRating,
  normalizeContentDescriptors,
  normalizeContentRatingCode,
} from '@src/utils/contentRatingSchema'

const MAX_PROVIDER_RESULTS = 256
const MAX_RELEASE_RECORDS = 128
const TMDB_PROVENANCE = Object.freeze({ provider: 'tmdb', source: 'TMDB' })

const MOVIE_RELEASE_TYPE_PRIORITY = new Map([
  [3, 0],
  [2, 1],
  [1, 2],
  [4, 3],
  [5, 4],
  [6, 5],
])

function providerResults(payload, nestedKey) {
  if (Array.isArray(payload?.results)) return payload.results.slice(0, MAX_PROVIDER_RESULTS)
  if (Array.isArray(payload?.[nestedKey]?.results)) {
    return payload[nestedKey].results.slice(0, MAX_PROVIDER_RESULTS)
  }
  return []
}

function isUsResult(result) {
  return typeof result?.iso_3166_1 === 'string' && result.iso_3166_1.trim().toUpperCase() === 'US'
}

function releaseDateSortKey(value) {
  if (typeof value !== 'string' || value.length > 64) return '\uffff'
  const trimmed = value.trim()
  return trimmed && Number.isFinite(Date.parse(trimmed)) ? trimmed : '\uffff'
}

function descriptorSortKey(value) {
  return normalizeContentDescriptors(value).join('\u0001').toLocaleLowerCase('en-US')
}

export function selectUsMovieContentRating(payload) {
  const candidates = []

  for (const result of providerResults(payload, 'release_dates').filter(isUsResult)) {
    if (!Array.isArray(result.release_dates)) continue

    for (const release of result.release_dates.slice(0, MAX_RELEASE_RECORDS)) {
      if (!release || typeof release !== 'object') continue
      if (!MOVIE_RELEASE_TYPE_PRIORITY.has(release.type)) continue

      const contentRating = normalizeContentRatingCode(release.certification, 'movie')
      if (!contentRating) continue

      candidates.push({
        contentRating,
        descriptors: normalizeContentDescriptors(release.descriptors),
        releaseTypePriority: MOVIE_RELEASE_TYPE_PRIORITY.get(release.type),
        releaseDate: releaseDateSortKey(release.release_date),
      })
    }
  }

  candidates.sort((left, right) =>
    left.releaseTypePriority - right.releaseTypePriority ||
    left.releaseDate.localeCompare(right.releaseDate) ||
    left.contentRating.localeCompare(right.contentRating) ||
    descriptorSortKey(left.descriptors).localeCompare(descriptorSortKey(right.descriptors))
  )

  const selected = candidates[0]
  return selected
    ? buildContentRating(selected.contentRating, 'movie', selected.descriptors, TMDB_PROVENANCE)
    : null
}

export function selectUsTvContentRating(payload) {
  const candidates = providerResults(payload, 'content_ratings')
    .filter(isUsResult)
    .map((result) => ({
      contentRating: normalizeContentRatingCode(result.rating, 'tv'),
      descriptors: normalizeContentDescriptors(result.descriptors),
    }))
    .filter((result) => result.contentRating)

  candidates.sort((left, right) =>
    left.contentRating.localeCompare(right.contentRating) ||
    descriptorSortKey(left.descriptors).localeCompare(descriptorSortKey(right.descriptors))
  )

  const selected = candidates[0]
  return selected
    ? buildContentRating(selected.contentRating, 'tv', selected.descriptors, TMDB_PROVENANCE)
    : null
}

export const tmdbContentRatingProvider = Object.freeze({
  id: 'tmdb',
  getContentRating({ mediaType, metadata }) {
    if (!metadata || typeof metadata !== 'object') return null
    if (mediaType === 'movie') return selectUsMovieContentRating(metadata.release_dates)
    if (mediaType === 'tv') return selectUsTvContentRating(metadata.content_ratings)
    return null
  },
})
