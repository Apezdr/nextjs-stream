/**
 * Which titles a manifest tick passes over.
 *
 * A full pass visits every title of every server, and for almost all of them
 * every server's gate matches, so the pass skips them without a write. A
 * manifest tick passes over only the titles where a full pass would do
 * anything, by these rules (per kind, among the titles some answering server
 * lists; `s` is an answering server that lists the title `t`):
 *
 *   R1  s's manifest hash for t is not the hash it last applied for t;
 *   R2  the servers listing t are not the servers it was last applied from
 *       (t is new, a server gained or lost it or did not answer, or t's last
 *       pass did not finish cleanly: its `applied` entry was cleared);
 *   R3  t's movie or show document has no gate for s (an admin edit, a removal
 *       held back, a deferral, a failure, another server's write);
 *   R4  t has no movie or show document (created by the pass);
 *   R5  TV: the database holds fewer episodes or seasons for t's show than s
 *       lists (the drift check of TVShowSyncService's gate-match branch,
 *       counted by core/seasonCounts);
 *   R6  TV: t's show has no visibleEpisodeCount (the gate-match branch's
 *       one-time backfill);
 *   R7  s's list version for the kind is not the one it was last read with.
 *
 * A title none of them selects has the entries, the servers and the gates its
 * last clean pass left, so every server's pass would skip it on its gate. A
 * title they select that turns out unchanged is skipped by the pass on its
 * gate, exactly as in a full pass. Episode gates are not a rule: under a
 * matching show gate a full pass never visits the episodes.
 *
 * Every map here is a Map, so any folder name is a key.
 */

import { expectedSeasonCounts } from '@src/utils/sync/core/seasonCounts'

const KINDS = ['tv', 'movies']

function addReason(selected, title, reason) {
  const reasons = selected.get(title)
  if (!reasons) selected.set(title, [reason])
  else if (!reasons.includes(reason)) reasons.push(reason)
}

/**
 * Per kind, every title the answering servers list, with the servers that list
 * it, in server order.
 *
 * @param {Map<string, {tv: {titles: Map}, movies: {titles: Map}}>} manifests
 * @returns {{tv: Map<string, string[]>, movies: Map<string, string[]>}}
 */
export function listersByTitle(manifests) {
  const listers = { tv: new Map(), movies: new Map() }
  for (const [serverId, kinds] of manifests) {
    for (const kind of KINDS) {
      for (const title of kinds[kind].titles.keys()) {
        const servers = listers[kind].get(title)
        if (servers) servers.push(serverId)
        else listers[kind].set(title, [serverId])
      }
    }
  }
  return listers
}

function sameServers(listers, applied) {
  if (!applied || applied.size !== listers.length) return false
  return listers.every((serverId) => applied.has(serverId))
}

/**
 * R1, R2 and R7: the rules the in-memory state answers on its own. The skip
 * check uses them too: a tick whose manifests all answered 304 still runs when
 * one of them selects a title.
 *
 * @param {Object} input
 * @param {Map<string, {tv: Object, movies: Object}>} input.manifests - This tick's, answering servers only
 * @param {{tv: Map, movies: Map}} input.applied - The state's
 * @param {Map<string, {tv?: Object, movies?: Object}>} [input.held] - The state's manifests (R7)
 * @returns {{tv: Map<string, string[]>, movies: Map<string, string[]>}} Title → reasons
 */
export function stateRules({ manifests, applied, held = new Map() }) {
  const selected = { tv: new Map(), movies: new Map() }
  const listers = listersByTitle(manifests)
  for (const kind of KINDS) {
    const versionMoved = new Set()
    for (const [serverId, kinds] of manifests) {
      const before = held.get(serverId)?.[kind]
      if (before && before.version !== kinds[kind].version) versionMoved.add(serverId)
    }
    for (const [title, servers] of listers[kind]) {
      const was = applied[kind].get(title)
      for (const serverId of servers) {
        if (manifests.get(serverId)[kind].titles.get(title).hash !== was?.get(serverId)) addReason(selected[kind], title, 'R1')
        if (versionMoved.has(serverId)) addReason(selected[kind], title, 'R7')
      }
      if (!sameServers(servers, was)) addReason(selected[kind], title, 'R2')
    }
  }
  return selected
}

/**
 * R3 to R6: the rules the database answers (readSelectionFacts).
 *
 * @param {Object} input
 * @param {Map<string, {tv: Object, movies: Object}>} input.manifests - This tick's, answering servers only
 * @param {Awaited<ReturnType<typeof readSelectionFacts>>} input.facts
 * @returns {{tv: Map<string, string[]>, movies: Map<string, string[]>}} Title → reasons
 */
export function databaseRules({ manifests, facts }) {
  const selected = { tv: new Map(), movies: new Map() }
  const listers = listersByTitle(manifests)
  const docsOf = { movies: facts.movies, tv: facts.shows }
  for (const kind of KINDS) {
    for (const [title, servers] of listers[kind]) {
      const doc = docsOf[kind].get(title)
      if (!doc) {
        addReason(selected[kind], title, 'R4')
        continue
      }
      for (const serverId of servers) {
        const gate = doc.syncGates?.[serverId]
        if (typeof gate !== 'string' || !gate) addReason(selected[kind], title, 'R3')
      }
      if (kind !== 'tv') continue
      if (doc.visibleEpisodeCount === undefined) addReason(selected.tv, title, 'R6')
      const episodes = facts.episodeCounts.get(doc.showKey) ?? 0
      const seasons = facts.seasonCounts.get(doc.showKey) ?? 0
      for (const serverId of servers) {
        const keys = manifests.get(serverId).tv.titles.get(title).seasons
        const expected = expectedSeasonCounts([...keys].map(([seasonKey, episodeKeys]) => [seasonKey, episodeKeys.length]))
        if (episodes < expected.episodes || seasons < expected.seasons) addReason(selected.tv, title, 'R5')
      }
    }
  }
  return selected
}

/**
 * The titles a tick passes over.
 *
 * @param {Object} input
 * @param {'all'|'select'} input.mode - `all`: every listed title
 * @param {Map<string, {tv: Object, movies: Object}>} input.manifests - This tick's, answering servers only
 * @param {{tv: Map, movies: Map}} [input.applied] - The state's (select only)
 * @param {Map} [input.held] - The state's manifests (select only)
 * @param {Object} [input.facts] - readSelectionFacts (select only)
 * @returns {{tv: Map<string, string[]>, movies: Map<string, string[]>}} Title → reasons
 */
export function selectTitles({ mode, manifests, applied, held, facts }) {
  if (mode === 'all') {
    const listers = listersByTitle(manifests)
    return {
      tv: new Map([...listers.tv.keys()].map((title) => [title, ['all']])),
      movies: new Map([...listers.movies.keys()].map((title) => [title, ['all']])),
    }
  }
  const fromState = stateRules({ manifests, applied, held })
  const fromDatabase = databaseRules({ manifests, facts })
  for (const kind of KINDS) {
    for (const [title, reasons] of fromDatabase[kind]) {
      for (const reason of reasons) addReason(fromState[kind], title, reason)
    }
  }
  return fromState
}

/**
 * What to ask each server for: per kind, the selected titles it lists, or
 * `{all: true}` when that is every title it lists. A kind with nothing
 * selected is not asked at all.
 *
 * @param {{tv: Map<string, *>, movies: Map<string, *>}} selected
 * @param {Map<string, {tv: Object, movies: Object}>} manifests - Answering servers only
 * @returns {Map<string, {tv?: {titles: string[]}|{all: true}, movies?: {titles: string[]}|{all: true}}>}
 */
export function entriesRequests(selected, manifests) {
  const requests = new Map()
  for (const [serverId, kinds] of manifests) {
    const request = {}
    for (const kind of KINDS) {
      const listed = kinds[kind].titles
      const titles = [...listed.keys()].filter((title) => selected[kind].has(title))
      if (titles.length === 0) continue
      request[kind] = titles.length === listed.size ? { all: true } : { titles }
    }
    if (Object.keys(request).length > 0) requests.set(serverId, request)
  }
  return requests
}

/**
 * What R3 to R6 read from the database: every movie and show document's folder
 * name and gates (shows also their id and visibleEpisodeCount), and how many
 * episodes and seasons each show has. Projection scans and two counts by showId.
 *
 * A folder name two documents share selects its title (its gates read as
 * open): the pass then works on it as a full pass would.
 *
 * @param {import('mongodb').Db} db - The media database
 * @returns {Promise<{movies: Map<string, Object>, shows: Map<string, Object>, episodeCounts: Map<string, number>, seasonCounts: Map<string, number>}>}
 */
export async function readSelectionFacts(db) {
  const [movieDocs, showDocs, episodeGroups, seasonGroups] = await Promise.all([
    db.collection('FlatMovies').find({}, { projection: { _id: 0, originalTitle: 1, syncGates: 1 } }).toArray(),
    db.collection('FlatTVShows')
      .find({}, { projection: { _id: 1, originalTitle: 1, syncGates: 1, visibleEpisodeCount: 1 } })
      .toArray(),
    db.collection('FlatEpisodes').aggregate([{ $group: { _id: '$showId', n: { $sum: 1 } } }]).toArray(),
    db.collection('FlatSeasons').aggregate([{ $group: { _id: '$showId', n: { $sum: 1 } } }]).toArray(),
  ])
  const byTitle = (docs, shape) => {
    const map = new Map()
    for (const doc of docs) {
      if (typeof doc.originalTitle !== 'string') continue
      map.set(doc.originalTitle, map.has(doc.originalTitle) ? { ...shape(doc), syncGates: null } : shape(doc))
    }
    return map
  }
  const counts = (groups) => new Map(groups.map((group) => [String(group._id), group.n]))
  return {
    movies: byTitle(movieDocs, (doc) => ({ syncGates: doc.syncGates ?? null })),
    shows: byTitle(showDocs, (doc) => ({
      syncGates: doc.syncGates ?? null,
      showKey: String(doc._id),
      ...(doc.visibleEpisodeCount === undefined ? {} : { visibleEpisodeCount: doc.visibleEpisodeCount }),
    })),
    episodeCounts: counts(episodeGroups),
    seasonCounts: counts(seasonGroups),
  }
}
