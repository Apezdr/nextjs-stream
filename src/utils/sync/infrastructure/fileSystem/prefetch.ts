/**
 * The prefetch step: the files a builder reads, fetched for it.
 *
 * A builder (a movie step, a TV builder) does no I/O. It names the files it
 * reads in its plan's `needs` (core/resources); buildWithResources fetches
 * them here and calls it again with them. Metadata files and blurhashes are
 * read through fetchMetadataMultiServer (./fetchFile): its Redis cache,
 * conditional requests, retries and slot of the sync's one HTTP limiter. The
 * movie artwork step's first read of a blurhash is the one plain request
 * (readBlurhashDirect), in a slot of the pass's throttle when there is one.
 *
 * A fetch that fails comes back as a failed Resource, never as a throw; one
 * that threw carries what it threw, for the builder to log. Nothing here logs:
 * the builders log what they read, where they used to fetch it.
 */

import { httpGet } from '@src/lib/httpHelper'
import { fetchMetadataMultiServer } from './fetchFile'
import { HtmlPageError, Resources, sameRequest } from '../../core/resources'
import type { Resource, ResourceRequest, WritePlan } from '../../core/types'

/** What the fetches of one title's builders share. */
export interface PrefetchContext {
  /** For fetchMetadataMultiServer's debug log. */
  mediaType: 'movie' | 'tv'
  /** The title's folder name, for the same log. */
  title: string
  /** The pass's HTTP throttle, for a direct read; without one it is not throttled. */
  throttle?: { throttleHttp: <T>(fn: () => Promise<T>) => Promise<T> }
}

/**
 * The most calls a builder gets. Each call after the first is made because
 * the one before named a file not fetched yet; a builder reads at most three
 * files, so one that keeps naming new files is stopped here.
 */
const MAX_CALLS = 8

/**
 * Fetch the files a builder needs, one at a time and in the order it read
 * them: the order in which it used to fetch them itself.
 */
export async function fetchResources(needs: readonly ResourceRequest[], context: PrefetchContext): Promise<Resource[]> {
  const fetched: Resource[] = []
  for (const need of needs) fetched.push(await fetchResource(need, context))
  return fetched
}

async function fetchResource(request: ResourceRequest, context: PrefetchContext): Promise<Resource> {
  const { kind, serverId, path, direct } = request
  const asked: ResourceRequest = direct ? { kind, serverId, path, direct } : { kind, serverId, path }
  try {
    const data =
      kind === 'blurhash' && direct
        ? await readBlurhashDirect(path, context.throttle)
        : await fetchMetadataMultiServer(serverId, path, kind === 'metadata' ? 'file' : 'blurhash', context.mediaType, context.title)
    if (kind === 'metadata' ? !data : typeof data !== 'string' || data === '') {
      return { ...asked, ok: false, error: kind === 'metadata' ? 'no metadata file came back' : 'no blurhash came back' }
    }
    return { ...asked, ok: true, data }
  } catch (error) {
    return { ...asked, ok: false, error: error instanceof Error ? error.message : String(error), thrown: { value: error } }
  }
}

/**
 * Run a builder: call it with the files fetched for it so far, fetch what its
 * plan names in `needs`, and call it again, until a call needs nothing more.
 * That call's outcome is the builder's.
 *
 * A call that throws after reading a file it was not handed has that file
 * fetched and is made again: a builder that fetched for itself made that
 * fetch before it threw. A call that throws with everything it read handed
 * throws here.
 */
export async function buildWithResources<O extends { plan: Pick<WritePlan<any>, 'needs'> }>(
  build: (resources: Resources) => O,
  context: PrefetchContext
): Promise<O> {
  let fetched: Resource[] = []
  for (let call = 1; ; call++) {
    const resources = new Resources(fetched)
    let needs: ResourceRequest[]
    try {
      const outcome = build(resources)
      if (outcome.plan.needs.length === 0) return outcome
      needs = outcome.plan.needs
    } catch (error) {
      if (resources.needs.length === 0) throw error
      needs = resources.needs
    }
    const fresh = needs.filter((need) => !fetched.some((resource) => sameRequest(resource, need)))
    if (fresh.length === 0) {
      // Everything it names was handed to it: fetching again would loop.
      throw new Error(`A builder for "${context.title}" asked again for files it was handed: ${needs.map((need) => need.path).join(', ')}`)
    }
    if (call >= MAX_CALLS) {
      throw new Error(
        `A builder for "${context.title}" still named files it was not handed after ${MAX_CALLS} calls: ${fresh.map((need) => need.path).join(', ')}`
      )
    }
    fetched = [...fetched, ...(await fetchResources(fresh, context))]
  }
}

/**
 * One plain read of a blurhash file, through httpGet (which returns its
 * cached copy on a 304): the movie artwork step's first read. Null for an
 * empty file. It logs nothing: an error (httpGet throws on HTTP errors and
 * timeouts) and an HTML error page (HtmlPageError) are thrown, so that the
 * failed resource carries them and the artwork step logs them where it reads
 * the file. The retry step reads the file again through
 * fetchMetadataMultiServer.
 */
export async function readBlurhashDirect(
  blurhashUrl: string,
  throttle?: PrefetchContext['throttle']
): Promise<string | null> {
  const doFetch = async () => {
    const response = await httpGet(
      blurhashUrl,
      {
        timeout: 3000, // 3 second timeout for blurhash (matches legacy)
        responseType: 'text',
        headers: {
          Accept: 'text/plain, */*',
        },
      },
      true // returnCacheDataIfAvailable - return cached data on 304
    )

    // Check Content-Type header - should be text/plain, not text/html (error page)
    const contentType = response.headers['content-type'] || response.headers['Content-Type'] || ''
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      throw new HtmlPageError(contentType)
    }

    // Extract data from wrapper if it's a cached response with _dataType
    // httpHelper stores text as: { _dataType: 'text', _isBuffer: false, data: actualText }
    let blurhashData = response.data
    if (blurhashData && typeof blurhashData === 'object' && blurhashData._dataType === 'text') {
      blurhashData = blurhashData.data
    }

    const trimmedData = blurhashData ? blurhashData.trim() : null

    if (!trimmedData) {
      return null
    }

    return trimmedData
  }

  // Throttled through the pass's ResourceManager when it has one
  if (throttle) {
    return throttle.throttleHttp(doFetch)
  }
  return doFetch()
}
