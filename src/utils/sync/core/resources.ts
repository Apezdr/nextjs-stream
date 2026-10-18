/**
 * The files a builder is handed on one call, and the ones it read that it was
 * not handed: its needs.
 *
 * A builder (a movie step, a TV builder) does no I/O. It reads each file it
 * needs from here: what the prefetch step fetched for it (a Resource, which
 * says whether the fetch worked), or nothing yet, which records the file as
 * a need. A file not handed yet reads exactly as a failed fetch, so a call
 * made without it decides no differently than one made after the fetch
 * failed. The builder returns its needs in its plan's `needs`; the service
 * fetches them (infrastructure/fileSystem/prefetch) and calls it again with
 * everything fetched so far. Only the plan of a call that needs nothing more
 * is written.
 *
 * Pure: nothing here fetches.
 */

import type { Resource, ResourceRequest } from './types'

/**
 * A plain read answered with an HTML page (an error page) instead of the
 * file. The prefetch step's direct read throws it; the movie artwork step,
 * which reads the file, logs it.
 */
export class HtmlPageError extends Error {
  constructor(readonly contentType: string) {
    super(`Blurhash URL returned HTML (error page), Content-Type: ${contentType}`)
    this.name = 'HtmlPageError'
  }
}

/** Whether two requests are for the same file, read the same way. */
export function sameRequest(a: ResourceRequest, b: ResourceRequest): boolean {
  return a.kind === b.kind && a.serverId === b.serverId && a.path === b.path && Boolean(a.direct) === Boolean(b.direct)
}

export class Resources {
  private readonly missing: ResourceRequest[] = []

  /** @param fetched - What the prefetch step fetched for this builder so far */
  constructor(private readonly fetched: readonly Resource[] = []) {}

  /**
   * The file fetched for the request, or undefined when it was not handed,
   * which records the request as a need.
   */
  read(request: ResourceRequest): Resource | undefined {
    const found = this.fetched.find((resource) => sameRequest(resource, request))
    if (found) return found
    if (!this.missing.some((need) => sameRequest(need, request))) {
      const { kind, serverId, path, direct } = request
      this.missing.push(direct ? { kind, serverId, path, direct } : { kind, serverId, path })
    }
    return undefined
  }

  /**
   * What the file holds when its fetch worked; null when it failed or was not
   * handed (recorded as a need).
   */
  data(request: ResourceRequest): unknown {
    const resource = this.read(request)
    return resource?.ok ? resource.data : null
  }

  /** The files read and not handed, in the order first read, once each. */
  get needs(): ResourceRequest[] {
    return [...this.missing]
  }
}
