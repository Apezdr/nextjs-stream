/**
 * How the TV builders read a blurhash file. Pure: the prefetch step fetched
 * it (infrastructure/fileSystem/prefetch); this only looks it up.
 */

import type { RunConfig } from '../../core/types'
import { fileServerUrl } from '../../infrastructure/fileSystem/urls'
import type { Resources } from '../../core/resources'

/**
 * What the blurhash file at a payload's path holds, read through
 * fetchMetadataMultiServer at its full URL on this server: null when the
 * fetch failed, when it has not been handed yet (recorded as a need), or when
 * the path makes no URL (then nothing is asked for).
 */
export function readBlurhashFile(resources: Resources, path: string, run: Pick<RunConfig, 'serverConfig'>): unknown {
  let url: string
  try {
    url = fileServerUrl(path, run.serverConfig)
  } catch {
    return null // a failed fetch, reported through the blurhash rule's outcome
  }
  return resources.data({ kind: 'blurhash', serverId: run.serverConfig.id, path: url })
}
