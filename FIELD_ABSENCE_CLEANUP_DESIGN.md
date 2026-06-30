# Field Absence Cleanup — Design

Drop stale optional fields from sync entities (movies, TV shows, seasons, episodes) when **no file server reports them as available anymore**.

## Problem

Today the new domain-driven sync (`src/utils/sync/`) is **additive only**. Every asset/content/metadata strategy follows the same shape:

```ts
const assetRelativePath = fileServerData.urls[fileServerKey]
if (!assetRelativePath) {
  continue   // ← silent skip — never clears the existing DB value
}
```

Concrete skip points already in tree:

- [src/utils/sync/domain/movies/strategies/MovieAssetStrategy.ts:213-219](src/utils/sync/domain/movies/strategies/MovieAssetStrategy.ts#L213-L219)
- [src/utils/sync/domain/tvShows/strategies/TVShowAssetStrategy.ts:138-141](src/utils/sync/domain/tvShows/strategies/TVShowAssetStrategy.ts#L138-L141)
- [src/utils/sync/domain/seasons/strategies/SeasonPosterStrategy.ts](src/utils/sync/domain/seasons/strategies/SeasonPosterStrategy.ts)
- [src/utils/sync/domain/episodes/strategies/EpisodeContentStrategy.ts](src/utils/sync/domain/episodes/strategies/EpisodeContentStrategy.ts)

Result: a `logo`, `backdrop`, `chapterURL`, episode `thumbnail`, season poster, or per-language caption that previously lived on server A and was deleted will linger in MongoDB indefinitely. The frontend then renders a 404'd asset URL.

The priority helper at [src/utils/sync/utils.js:170-195](src/utils/sync/utils.js#L170-L195) already handles "nobody has this field" correctly — it returns `true` for an empty `serversWithData` array — but no caller ever exercises that branch because the per-server strategies short-circuit on missing local data before getting there.

## Goals

1. After a full multi-server sync pass completes for an entity, any tracked optional field whose `fieldAvailability[mediaType][originalTitle][fieldPath]` is **empty** and which **currently has a value in the DB** must be unset (`$unset`) in a single consolidated write.
2. Reuse the existing `fieldAvailability` data — no new HTTP calls, no per-server rescans.
3. Apply uniformly to movies, TV shows, seasons, episodes via one shared module.
4. Be *resilient*: never clear because of a transient server outage. An empty `serversWithData` must mean "all enabled servers were probed and none had it," not "we skipped server A on this run."
5. Per project rule (CLAUDE.md): no defaulting through errors. If we cannot prove the field is absent everywhere, leave it alone.

## Non-goals

- Not a generic GDPR/data-retention tool.
- Not removing required fields (`title`, `originalTitle`, `_id`, etc.).
- Not removing the entity itself when all assets vanish — that's a separate "orphan reaper" concern.
- Not retroactive: cleanup runs as part of normal sync, not as a backfill cron. (A one-shot admin endpoint is mentioned in **Future** below.)

## Proposed module

New file: [src/utils/sync/core/FieldAbsenceCleaner.ts](src/utils/sync/core/FieldAbsenceCleaner.ts)

`core/` already houses the cross-cutting contracts (`types.ts`, `fieldPaths.ts`, `events.ts`, `logger.ts`, `validation.ts`). Field absence detection is cross-cutting in exactly the same way — every domain consumes it but none owns it.

### Public API

```ts
// src/utils/sync/core/FieldAbsenceCleaner.ts

export interface CleanableField {
  /** Entity property name (what we $unset) */
  entityField: string
  /** fieldAvailability path (what we look up) */
  fieldPath: string
  /** Optional companion fields to clear together (e.g. posterBlurhash, posterSource) */
  companions?: string[]
}

export interface AbsenceCleanupInput {
  mediaType: 'movies' | 'tv'
  /** Filesystem key — originalTitle for movies/shows; compound for season/episode (see below) */
  availabilityKey: string
  /** Current DB document — used to detect "field has a value to clear" */
  entity: Record<string, unknown>
  fieldAvailability: FieldAvailability
  fields: CleanableField[]
  /**
   * Pre-flight gate. Cleanup ONLY runs when this is true. Caller is responsible
   * for asserting that every enabled server was reachable this sync. If even
   * one enabled server failed to respond, pass false and we no-op.
   */
  allEnabledServersProbed: boolean
}

export interface AbsenceCleanupResult {
  /** Field names to $unset — empty array means no-op */
  fieldsToUnset: string[]
  /** Diagnostic strings for SyncResult.changes */
  changes: string[]
}

export function detectAbsentFields(input: AbsenceCleanupInput): AbsenceCleanupResult
```

`detectAbsentFields` is **pure**. It does not write to the DB. It returns the fields the caller should `$unset`. The caller folds them into its existing pending-update / repository write — see "Integration" below.

### Detection rule

For each `field` in `fields`:

```
serversWithData = fieldAvailability[mediaType][availabilityKey]?.[field.fieldPath] ?? []
currentValue    = entity[field.entityField]

absent = serversWithData.length === 0
        && currentValue !== undefined
        && currentValue !== null
        && !(typeof currentValue === 'object' && Object.keys(currentValue).length === 0)
        && allEnabledServersProbed
```

The empty-object guard matters for `captionURLs: {}` and `videoInfo: {}` — those should be cleared with `$unset`, but if they're already empty in the DB the unset is a no-op and we shouldn't pollute `changes[]`.

### Why a per-call `allEnabledServersProbed` flag

`fieldAvailability` is built incrementally as each server is scanned. If server B's HTTP call fails, B's contributions never enter the map, and a field that genuinely lives only on B would look "absent." Cleaning it would be a data-loss bug.

The orchestrators (`MovieSyncService`, `TVShowSyncService`, `SeasonSyncService`, `EpisodeSyncService`) already know how many enabled servers they intended to probe and how many succeeded. They pass that bit through. If sync was scoped to a single server (`SyncOperation.SingleServer`), the flag is `false` — single-server runs are never authoritative.

## Per-entity integration

Cleanup runs **once per entity per sync pass**, after all per-server strategies have finished contributing to `pendingUpdates`. It folds an `$unset` payload into the same write the orchestrator already performs.

### 1. Movies

**Where:** `MovieSyncService.syncMovie()` — right before the consolidated `repository.smartUpsert(...)` call that flushes `context.pendingMovieUpdates.get(originalTitle)`.

**Cleanable fields:**

| entityField | fieldPath | companions |
|---|---|---|
| `posterURL` | `urls.poster` | `posterSource`, `posterBlurhash`, `posterBlurhashSource` |
| `backdrop` | `urls.backdrop` | `backdropSource`, `backdropBlurhash`, `backdropBlurhashSource` |
| `logo` | `urls.logo` | `logoSource`, `logoBlurhash` |
| `chapterURL` | `urls.chapters` | `chapterSource` |
| `videoURL` | `urls.mp4` | `videoSource` |
| `mediaLastModified` | `urls.mediaLastModified` | — |

**Captions** are handled per-language. Iterate `Object.keys(entity.captionURLs ?? {})` and for each language build the three subpaths with `getCaptionFieldPath(lang, 'url' | 'srcLang' | 'lastModified')`. If **all three** are absent across all servers, `$unset` `captionURLs.${lang}` (use a dotted MongoDB path). If only some are absent, leave the language alone — captions are an atomic unit.

**Mongo write:** the orchestrator already builds an update doc for `smartUpsert`. Add a parallel `$unset` doc; the BaseRepository should be extended to accept it (see "Repository changes").

### 2. TV shows

**Where:** `TVShowSyncService.syncTVShow()` — after metadata + asset strategies complete, before the show-level write.

**Cleanable fields:** same shape as movies minus the video/caption set.

| entityField | fieldPath | companions |
|---|---|---|
| `posterURL` | `poster` | `posterSource`, `posterBlurhash`, `posterBlurhashSource` |
| `backdrop` | `backdrop` | `backdropSource`, `backdropBlurhash`, `backdropBlurhashSource` |
| `logo` | `logo` | `logoSource` |

**Note:** TV show field paths are **not** prefixed with `urls.` — see [TVShowAssetStrategy.ts](src/utils/sync/domain/tvShows/strategies/TVShowAssetStrategy.ts) for the convention. The `MovieFieldPathMap` does not apply; TV uses raw field names.

`availabilityKey` is the show's `originalTitle`, mediaType `'tv'`.

### 3. Seasons

**Where:** `SeasonSyncService.syncSeason()`, after `SeasonPosterStrategy` + `SeasonMetadataStrategy` finish.

**Cleanable fields:**

| entityField | fieldPath template | companions |
|---|---|---|
| `season_poster` | `seasons.${seasonKey}.season_poster` | `seasonPosterBlurhash`, `season_posterSource` |

`seasonKey` matches the format used by the season strategies (e.g., `"Season 1"`). `availabilityKey` is the **show's** `originalTitle` (seasons piggy-back on the show's `fieldAvailability.tv[showOriginalTitle]` namespace via compound paths).

### 4. Episodes

**Where:** `EpisodeSyncService.syncEpisode()`, after `EpisodeContentStrategy` finishes.

Episodes are **not** keyed in `fieldAvailability` directly. Each episode-level field uses a compound path under the show's bucket: `seasons.${seasonKey}.episodes.${episodeKey}.${field}`. The exact templates live in the episode strategy — re-use those constants, do not invent new ones.

**Cleanable fields:**

| entityField | fieldPath template |
|---|---|
| `videoURL` | `seasons.${seasonKey}.episodes.${episodeKey}.videourl` |
| `thumbnail` | `seasons.${seasonKey}.episodes.${episodeKey}.thumbnail` |
| `thumbnailBlurhash` | `seasons.${seasonKey}.episodes.${episodeKey}.thumbnailBlurhash` |
| `chapterURL` | `seasons.${seasonKey}.episodes.${episodeKey}.chapters` |

Captions: same per-language treatment as movies, but each subpath is prefixed with `seasons.${seasonKey}.episodes.${episodeKey}.`.

`availabilityKey` is still the **show's** `originalTitle`; the field paths carry the season/episode identity.

## Repository changes

`BaseRepository.smartUpsert` currently takes a `Partial<T>` of fields to set. Extend it (or add a sibling `smartUpsertWithUnset`) to accept an `unset?: string[]` argument and translate it to MongoDB `$unset: { [field]: '' }`. The diff/no-op short-circuit must consider unsets when deciding whether to skip the write.

Sketch:

```ts
async smartUpsert(
  filter: Filter<T>,
  set: Partial<T>,
  options?: { unset?: string[] }
): Promise<UpdateResult>
```

If both `set` is empty and `unset` is empty/undefined, the existing no-op path applies.

## SyncResult / observability

Each cleanup adds entries to the existing `SyncResult.changes`:

```
"Cleared logo (absent on all 3 enabled servers)"
"Cleared captionURLs.French (absent on all 3 enabled servers)"
"Cleared seasons.Season 1.season_poster (absent on all 3 enabled servers)"
```

`metadata.fieldsCleared: number` is added for dashboarding. The existing `syncEventBus` (see [src/utils/sync/core/events.ts](src/utils/sync/core/events.ts)) gets a new event:

```ts
syncEventBus.emit('field.cleared', {
  mediaType, availabilityKey, fields: [...],
  reason: 'absent-on-all-servers',
  enabledServerCount,
})
```

This lets the SigNoz integration alert if cleanup volume spikes — typically a sign that a file server is silently underreporting (e.g., a path-prefix regression) and we'd be deleting good data.

## Safety rails

1. **Authoritative-pass gate.** `allEnabledServersProbed === true` is mandatory. Cleanup must never fire on a partial sync.
2. **Per-pass cap.** The orchestrator passes a max-fields-per-entity threshold (default 5). If `fieldsToUnset.length` exceeds the cap, **abort the cleanup for that entity** and emit a `field.cleared.aborted` event with the candidate list. Catastrophic regressions (e.g., file server returns an empty manifest) shouldn't be able to wipe a record in one pass.
3. **Required-field allowlist.** `FieldAbsenceCleaner` rejects any `entityField` not in a small allowlist (per-entity constants). This is belt-and-braces protection against a future caller passing `'title'` or `'_id'`.
4. **Dry-run mode.** Strategy or service config can set `cleanup: 'dry-run'`, which logs and emits events but does not write. Use it for the first production rollout.

## Configuration

Add to `SyncContext`:

```ts
cleanup?: {
  enabled: boolean              // default: false during rollout, then true
  mode?: 'enforce' | 'dry-run'  // default: 'enforce'
  maxFieldsPerEntity?: number   // default: 5
}
```

A feature flag in [next.config.js](next.config.js) or env (`SYNC_FIELD_CLEANUP`) gates `enabled` until we've watched dry-run logs.

## Rollout plan

1. **PR 1 — `core/FieldAbsenceCleaner.ts` + repository unset support + unit tests.** No callers; nothing changes at runtime.
2. **PR 2 — Movies integration in dry-run.** Wire into `MovieSyncService`. Land in `dry-run` mode. Watch `field.cleared` events for one full sync cycle on a staging dataset. Confirm zero false positives.
3. **PR 3 — Movies enforce.** Flip mode after dry-run is clean.
4. **PR 4 — TV shows + seasons + episodes in dry-run, then enforce.** Same two-step.
5. **PR 5 (optional) — admin backfill endpoint.** A one-shot route that runs cleanup against every existing record using the most recent `fieldAvailability` snapshot, for cleaning historical drift.

## Test plan

Unit (`__tests__/sync/core/FieldAbsenceCleaner.test.ts`):

- Empty `serversWithData` + value present + `allEnabledServersProbed=true` → cleared.
- Empty `serversWithData` + value present + `allEnabledServersProbed=false` → no-op.
- Non-empty `serversWithData` → no-op regardless.
- Value already absent in entity → no-op (no `changes[]` noise).
- Empty-object value (`captionURLs: {}`, `videoInfo: {}`) → no-op.
- Caption: 1 of 3 subpaths absent → no-op for that language.
- Caption: all 3 subpaths absent → language cleared.
- Required-field allowlist violation → throws.
- Cap exceeded → returns `[]` and `aborted: true`.

Integration:

- Add a mock with two servers and a movie that has `logo` only on server A. Sync once → logo present. Remove logo from server A's mock manifest. Sync again with both servers up → logo cleared, `fieldsCleared=1` in `SyncResult.metadata`.
- Same scenario but server B times out on the second sync → cleanup skipped, logo retained.
- Same scenario with `cleanup.mode: 'dry-run'` → logo retained, `field.cleared` event still emitted.

## Open questions

1. **Source-tracking fields (`posterSource`, `logoSource`, etc.).** Always include in `companions`, or only when the URL field is also being cleared? Proposal: always — the source is meaningless without the URL.
2. **Per-language caption companions.** `captionURLs.${lang}` is itself a sub-document with `url` / `srcLang` / `lastModified` / `sourceServerId`. Clearing the whole language entry covers all four; do we ever want to clear *just* `lastModified`? Current proposal says no — atomic unit.
3. **TV show field path inconsistency.** Movies use `urls.poster`; TV uses bare `poster`. The `MovieFieldPathMap` exists; should we add an analogous `TVShowFieldPathMap` and `SeasonFieldPathMap` while we're here, so the cleanup tables can use type-safe lookups instead of string literals? Probably yes — small enough to fold into PR 1.

## Future

- Detect entity-level disappearance (e.g., movie folder removed from every server) and flag for a separate "orphan reaper" workflow. Not in scope here.
- Move the `companions` declarations to live next to the entity types in [core/types.ts](src/utils/sync/core/types.ts) so adding a new asset field automatically opts into cleanup with the right group.
