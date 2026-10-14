// src/lib/arr/profileChoices.ts
// The quality profiles the role editor offers for arr.request, live from
// Radarr and Sonarr. A service that's unset or unreachable says so instead:
// the editor can still grant all of its profiles, or none.
import 'server-only'
import { SERVICE_NAMES } from './errors'
import { ArrError, readArrConfig } from './http'
import { getRadarrOptions } from './radarr'
import { getSonarrOptions } from './sonarr'
import type { ArrService, QualityProfile } from './types'

export type ProfileChoices = Record<ArrService, { profiles: QualityProfile[] } | { unavailable: string }>

async function choicesFor(service: ArrService): Promise<ProfileChoices[ArrService]> {
  const resolved = readArrConfig(service)
  if ('missing' in resolved) return { unavailable: `${SERVICE_NAMES[service]} isn’t set up on this server.` }
  try {
    const options =
      service === 'radarr' ? await getRadarrOptions(resolved.config) : await getSonarrOptions(resolved.config)
    return { profiles: options.qualityProfiles }
  } catch (error) {
    if (!(error instanceof ArrError)) throw error
    return { unavailable: `Couldn’t reach ${SERVICE_NAMES[service]} to list its quality profiles.` }
  }
}

export async function arrProfileChoices(): Promise<ProfileChoices> {
  const [radarr, sonarr] = await Promise.all([choicesFor('radarr'), choicesFor('sonarr')])
  return { radarr, sonarr }
}
