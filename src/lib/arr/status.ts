// src/lib/arr/status.ts
// Chip states for a page of watchlist cards, in one request. A service that
// isn't set up or doesn't answer is reported once in `services` and its titles
// are left out, so the cards just show no chip.
import 'server-only'
import { createLogger } from '@src/lib/logger'
import { ArrError, readArrConfig } from './http'
import { movieStatuses } from './radarr'
import { seriesStatuses } from './sonarr'
import {
  ARR_SERVICES,
  titleKey,
  type ArrMediaType,
  type ArrService,
  type ArrStatusResponse,
  type TitleRef,
} from './types'

const log = createLogger('ArrStatus')

/** Cards per request: the watchlist shows up to 100 at a time. */
export const MAX_STATUS_ITEMS = 200

/**
 * `movie:603,tv:1399` → the titles it names, or null when it isn't that shape
 * or names too many. Duplicates collapse.
 */
export function parseStatusItems(raw: string | null): TitleRef[] | null {
  if (!raw) return []
  const keys = [...new Set(raw.split(',').map((key) => key.trim()).filter(Boolean))]
  if (keys.length > MAX_STATUS_ITEMS) return null
  const items: TitleRef[] = []
  for (const key of keys) {
    const match = /^(movie|tv):(\d{1,10})$/.exec(key)
    if (!match) return null
    const tmdbId = Number(match[2])
    if (!Number.isSafeInteger(tmdbId) || tmdbId <= 0) return null
    items.push({ mediaType: match[1] as ArrMediaType, tmdbId })
  }
  return items
}

// The chips poll, so a service that stays down would log on every poll; this
// logs the change into and out of each failure instead.
const lastOutcome = new Map<ArrService, string>()

function noteOutcome(service: ArrService, failure: ArrError | null) {
  const outcome = failure ? failure.message : 'ok'
  const previous = lastOutcome.get(service)
  if (previous === outcome) return
  lastOutcome.set(service, outcome)
  if (failure) log.warn({ service, reason: failure.reason, httpStatus: failure.httpStatus }, 'Arr status request failed')
  else if (previous) log.info({ service }, 'Arr status request recovered')
}

const SERVICE_MEDIA_TYPE: Record<ArrService, ArrMediaType> = { radarr: 'movie', sonarr: 'tv' }

export async function getArrStatuses(items: TitleRef[]): Promise<ArrStatusResponse> {
  const response: ArrStatusResponse = { services: { radarr: 'ok', sonarr: 'ok' }, items: {} }
  const idsByType: Record<ArrMediaType, number[]> = { movie: [], tv: [] }
  for (const item of items) idsByType[item.mediaType].push(item.tmdbId)

  await Promise.all(
    ARR_SERVICES.map(async (service) => {
      const resolved = readArrConfig(service)
      if ('missing' in resolved) {
        response.services[service] = 'not_configured'
        return
      }
      const mediaType = SERVICE_MEDIA_TYPE[service]
      const tmdbIds = idsByType[mediaType]
      if (tmdbIds.length === 0) return
      try {
        const statuses =
          service === 'radarr'
            ? await movieStatuses(resolved.config, tmdbIds)
            : await seriesStatuses(resolved.config, tmdbIds)
        for (const [tmdbId, status] of statuses) response.items[titleKey(mediaType, tmdbId)] = status
        noteOutcome(service, null)
      } catch (error) {
        if (!(error instanceof ArrError)) throw error
        response.services[service] = 'unreachable'
        noteOutcome(service, error)
      }
    })
  )
  return response
}

