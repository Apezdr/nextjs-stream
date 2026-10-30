/**
 * A server's library credits: the credits file at its library root, for
 * shared assets no title folder holds (the site's poster collage), stored
 * per server in `Media.LibraryCredits` (`_id` = the server's id)
 * (CREDITS_SIDECAR.md, Library scope).
 *
 * The processor publishes the file's locator in its manifests, beside the
 * titles (`library.credits`): the same four states as a title's. Each
 * server's library is its own, so the server that publishes it owns it and
 * nothing is ranked across servers. The one rule every credits file follows
 * applies (core/credits):
 *
 *  - a new, valid file is stored with its source and hash;
 *  - a failure keeps the last valid credits and records why in
 *    `creditsStatus`. One that may clear by itself (`retry`) is reported by
 *    the run as an error, so the pass is not recorded as complete and the
 *    next tick runs again; one in the published bytes waits for an edit,
 *    which moves the manifest;
 *  - the credits are removed only on the server's own confirmed absence;
 *    a processor that publishes no `library` value says nothing.
 *
 * The manifests are the server's answer this run (run/manifestTick), so the
 * server answered: its own absence is authoritative.
 */

import { CREDITS_DEFERRAL, planCredits, type CreditsOutcome, type StoredCredits } from '../core/credits'
import { buildWithResources } from '../infrastructure/fileSystem/prefetch'
import type { ServerConfig } from '../core/types'

/** The collection, in the Media database. */
export const LIBRARY_CREDITS_COLLECTION = 'LibraryCredits'

/** What the run needs of the collection. */
interface LibraryCreditsCollection {
  findOne(filter: { _id: string }): Promise<(StoredCredits & { _id: string }) | null>
  updateOne(filter: { _id: string }, update: Record<string, unknown>, options: { upsert: boolean }): Promise<unknown>
  deleteOne(filter: { _id: string }): Promise<unknown>
}

export interface LibraryCreditsResult {
  action: CreditsOutcome['action']
  /** A failure that may clear by itself: the run reports it, so the next tick runs again. */
  retry: boolean
  errors: string[]
  changes: string[]
}

/**
 * The library's credits locator a server's manifests publish: the movies
 * manifest's, else the TV manifest's; undefined when neither has one.
 *
 * @param manifests - The server's parsed manifests this run (run/manifestSource KindManifest)
 */
export function libraryCreditsLocator(manifests: { movies?: { library?: any }; tv?: { library?: any } } | undefined): unknown {
  const fromMovies = manifests?.movies?.library
  if (fromMovies && Object.prototype.hasOwnProperty.call(fromMovies, 'credits')) return fromMovies.credits
  const fromTv = manifests?.tv?.library
  if (fromTv && Object.prototype.hasOwnProperty.call(fromTv, 'credits')) return fromTv.credits
  return undefined
}

/**
 * Apply one server's library credits for this run.
 *
 * @param args.collection - `Media.LibraryCredits`
 * @param args.serverConfig - The server, as its pass has it
 * @param args.manifests - Its manifests this run
 * @param args.syncRunId - Stamped on what is written
 */
export async function syncLibraryCredits({
  collection,
  serverConfig,
  manifests,
  syncRunId,
  now = new Date(),
}: {
  collection: LibraryCreditsCollection
  serverConfig: Pick<ServerConfig, 'id' | 'priority'>
  manifests: Parameters<typeof libraryCreditsLocator>[0]
  syncRunId?: string | null
  now?: Date
}): Promise<LibraryCreditsResult> {
  const serverId = serverConfig.id
  const reported = libraryCreditsLocator(manifests)
  const value = reported && typeof reported === 'object' ? (reported as Record<string, unknown>) : null
  const has = (key: string) => Boolean(value && value[key] !== undefined && value[key] !== null && value[key] !== '')
  // This server alone answers for its library. A url or an error is its
  // claim; `absent: true` its confirmed absence; anything else says nothing.
  const reporters = {
    urls: has('url') ? [serverId] : [],
    errors: has('error') ? [serverId] : [],
    absent: value?.absent === true ? [serverId] : [],
    holders: [serverId],
  }

  const stored = await collection.findOne({ _id: serverId })
  const { outcome } = await buildWithResources(
    (resources) => {
      const planned = planCredits(
        {
          stored,
          reported,
          reporters,
          scope: 'library',
          run: { serverConfig: serverConfig as ServerConfig, allEnabledServersProbed: true },
          now,
        },
        (request) => resources.read(request)
      )
      return { plan: { needs: resources.needs }, outcome: planned }
    },
    { mediaType: 'library', title: `library of ${serverId}` }
  )

  if (outcome.action === 'removed') {
    await collection.deleteOne({ _id: serverId })
  } else if (Object.keys(outcome.set).length > 0 || outcome.unset.length > 0) {
    const update: Record<string, unknown> = {
      $set: { ...outcome.set, serverId, lastSynced: now, ...(syncRunId ? { syncRunId } : {}) },
    }
    if (outcome.unset.length > 0) update.$unset = Object.fromEntries(outcome.unset.map((field) => [field, '']))
    await collection.updateOne({ _id: serverId }, update, { upsert: true })
  }

  return {
    action: outcome.action,
    retry: outcome.holdBack === CREDITS_DEFERRAL,
    errors: outcome.errors,
    changes: outcome.changes,
  }
}
