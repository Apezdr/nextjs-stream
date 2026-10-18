# Notification Framework — Design Writeup

## New-content notices: what ships

This section describes what the app does today. The rest of the document is a design for a later framework. The code is `src/utils/sync/run/newContent.js` (its module header says the same thing), with `src/utils/notifications/MediaNotificationOrchestrator.js` composing and delivering the notices.

### When it runs
Once per sync run (a full pass, not a skipped tick), after every file server's pass and after post-sync cleanup has deleted what it deletes.

### What counts as new
The app keeps a permanent set of the titles it has announced (`Media.AnnouncedTitles`). Each title has one key, built from folder names and never from a database id:
- a movie: its folder name (`originalTitle`);
- an episode: its show's folder name, its season number and its episode number.

A movie or an episode is announced when, after the run:
1. a pass wrote it this run, created or updated (a title skipped on its gate was not written);
2. it is still in the library (a title cleanup deleted this run is not announced);
3. a list would show it (it has a video a browser can play, or a transcoder link);
4. its key is not in the set, and is not waiting to be delivered.

How long ago a file server first saw the title plays no part. A movie whose folder arrives before its video (a placeholder, or a scan in the middle of an import) is announced when the video arrives and the movie becomes visible. A title added during an outage is announced on the first run after it.

A title two servers have is one title, and is announced once.

### The baseline
On a database where the set has never been started, the first run announces nothing. Instead it puts every movie and episode the library holds after that run into the set, hidden ones included, and leaves a flag (`new-content-baseline` in `app_config.migrations`). On an upgrade, this means the existing library is never announced. On a fresh install, the first sync into an empty database announces nothing either. If seeding fails, nothing is announced and no flag is written, so the next run seeds again. Seeding can be repeated safely.

### Retries
The notices for a run's titles are queued (`Media.NewContentOutbox`) with the keys they announce. Every run delivers every queued entry, oldest first, whether or not that run wrote anything. When an entry is delivered, it is removed, and only then do its keys go into the set. When delivery fails, the entry stays queued and the next run tries again.

Nothing is lost: a key is in the queue until the set has it. Nothing is sent twice:
- each notification's id is derived from the queued entry, the notice and the user, so delivering an entry again adds only the notifications the last attempt did not;
- a title waiting in the queue is not queued a second time.

An entry is delivered as it was queued: a title deleted while its notice waits is still named in it.

### Titles removed and added back
A title stays in the set after it leaves the library. If it comes back later (a folder restored, a document re-created after cleanup, a show re-created under a new id with every episode inserted again), it is not announced again. If the owner ever wants returning titles announced, the set is the one place to change: remove a key when its title leaves the library.

### Grouping and the digest
- Movies are grouped five to a notice. One movie gets its own notice, which links to its page.
- Episodes get one notice per show, linking to the episode when there is one and to the show otherwise.
- When a run's titles would come to more than five notices, one digest is sent instead. A first sync of a new library, or a newly added server, sends one digest, not hundreds of notices.

### Recipients
Accounts with `approved: true` and without `limitedAccess` (which may not be able to open the content). This is decided in one place, `src/utils/notifications/recipients.js`.

---

## 1. Why we're building this

The new domain-driven sync architecture (`src/utils/sync/`) reaches users only through the legacy `MediaNotificationOrchestrator`, which the run calls once, after every server's pass and after post-sync cleanup (`run/newContent`, from `run/postSync` `runAfterSyncJobs`) — the domain services themselves produce no user-facing notifications. The legacy orchestrator works but is procedural, tightly coupled to the flat-sync result shape, and operates on a "load all users, fan out per entity" model that doesn't scale.

Rather than port the legacy approach, we're designing a notification subsystem that's **event-driven, content-keyed, preference-aware, and decoupled from sync wall-clock time** — and structured so the relevance layer can extract cleanly into an ML microservice when that becomes useful.

### Constraints
- Sync must never block on notification work.
- No `getAllUsers()` paths anywhere.
- Bounded heap and event-loop pressure under bulk imports (e.g., 500 episodes in a single run).
- Reuse existing `NotificationManager` / `NotificationTypes` for delivery; replace only orchestration.
- In-app delivery only at MVP; web push / email / Discord pluggable later.

---

## 2. User-facing notification tiers

Three tiers, distinguished by *why* the user is being told and how interruptive delivery should be:

| Tier | Trigger | Delivery |
|---|---|---|
| **1 — Asked-for** | Explicit interest: watchlist match, next episode of show being actively watched | Push (when channels exist), in-app immediately |
| **2 — Curated** | Inferred interest: new arrivals matching taste, re-engagement on stale shows | Daily/weekly digest |
| **3 — Silent** | Everything else (random library additions, metadata refreshes, quality upgrades) | In-app feed only |

Tier 3 is the default. Users opt *into* Tiers 1 and 2 per category.

---

## 3. Architecture

```
┌────────────────┐
│ run/newContent │  emits { kind, tmdbId, originalTitle } only,
└───────┬────────┘  once per run, after cleanup
        │  one in-memory push, non-blocking
        ▼
┌────────────────┐
│ SyncEventBus   │  existing observability bus
│ + 'entity:     │  one new event type
│   created'     │
└───────┬────────┘
        │  subscriber registered at boot
        ▼
┌────────────────┐
│ NotificationBus│  bounded queue (10k), 5s drain window
│                │  overflow → coalesce by (kind, tmdbId)
└───────┬────────┘
        │  per drain: one batch
        ▼
┌────────────────┐
│ Targeting      │  rules run concurrently, failures isolated
│ Service        │  3 indexed queries per batch regardless of size
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ Aggregation    │  dedup by groupKey, apply prefs, enforce
│ Service        │  per-user cooldowns
└───────┬────────┘
        │  bulkWrite
        ▼
┌────────────────┐
│ Notifications  │  reuses existing collection + types
│ collection     │
└───────┬────────┘
        │  (later)
        ▼
┌────────────────┐
│ Channel        │  web push / email / Discord — pluggable
│ Dispatcher     │
└────────────────┘
```

**Key property:** the sync's passes have zero notification imports (`run/serverPass` has none; the run's `run/newContent` calls `MediaNotificationOrchestrator`, and this design replaces that call). Subscribe-at-boot pattern makes the integration deletable without sync changes.

---

## 4. Core interfaces

```ts
// src/utils/notifications/types.ts

export type EntityKind = 'movie' | 'show' | 'season' | 'episode'

export interface NotificationEvent {
  kind: EntityKind
  tmdbId: string
  originalTitle: string
  showTmdbId?: string
  seasonN?: number
  episodeN?: number
  entityCreatedAt: Date
}

export interface PartitionedBatch {
  movies:   NotificationEvent[]
  shows:    NotificationEvent[]
  seasons:  NotificationEvent[]
  episodes: NotificationEvent[]
  windowStartedAt: Date
}

export interface TargetMatch {
  userId: string
  reason: string                       // 'next_episode' | 'watchlist' | ...
  contentRef: { kind: EntityKind; id: string; parentId?: string }
  groupKey: string                     // e.g. "show:tt0944947:s2"
  priority: number                     // higher wins on dedup
  data?: Record<string, unknown>
  // ML-extension fields, populated by scoring layer when present:
  score?: number                       // 0-1 predicted relevance
  optimalDeliveryAt?: Date             // send-time optimization
}

export interface TargetingRule {
  name: string
  reason: string
  priority: number
  appliesTo(batch: PartitionedBatch): boolean
  query(batch: PartitionedBatch, ctx: TargetingContext): Promise<TargetMatch[]>
}
```

The `score` and `optimalDeliveryAt` fields are placeholders for ML output. Deterministic rules leave them undefined; ML scoring populates them later.

---

## 5. Targeting rules

Three sync-driven rules + one scheduled rule.

### Rule 1: Watchlist match
- **Trigger:** new movie, new show, or new episode/season of a watchlisted show
- **Query:** one `find` against `Watchlist` keyed by `tmdbId`
- **Edge case:** filter `Watchlist.dateAdded > entity.createdAt` to avoid notifying on adoption-after-the-fact

### Rule 2: Next episode
- **Trigger:** new episode for a show the user has watched recently
- **Query:** one aggregation against `WatchHistory`, keyed by `metadata.id`, sorted by `(season DESC, episode DESC)`, grouped to find latest watched per user per show
- **Recency window:** **90 days** (decided)
- **Threshold:** `playbackTime > 300s` to filter abandoned plays
- **Cooldown:** **1 notification per show per 24h** (enforced in aggregation layer, decided)

### Rule 3: New season for followed show
- **"Followed" definition is an open design problem.** Fixed time windows are wrong because release cadences vary wildly (sitcom yearly, *Stranger Things* unpredictable). Better signals to combine in the rule's internal logic:
  - User watched the prior season's finale → high confidence
  - User completed >70% of prior season → medium confidence
  - Show's typical inter-season gap from TMDB metadata → cadence-aware threshold
  - Explicit follow toggle (Tier B feature, when added)
- The framework just calls `rule.query(batch)`; the rule's internals can evolve. **This is a strong candidate for an ML model** (see §10).

### Rule 4 (scheduled, NOT sync-driven): Re-engagement
- **Trigger:** nightly job, not the bus
- **Query:** find users with `lastWatched` in [14, 90] days, `$lookup` against catalog for newer content
- **Cooldown:** strict — once per user per show per week, enforced via `Notifications.groupKey + createdAt`

---

## 6. Aggregation layer (sketch)

Takes the flat `TargetMatch[]` from targeting and:

1. **Groups** by `(userId, groupKey)` keeping the highest-priority `reason` on tie.
2. **Filters** by user preferences (`User.preferences.notifications.*`):
   - Per-category enable/disable
   - Quiet hours (defer until window opens)
   - Per-show mute list
   - Backfill gating (`event.entityCreatedAt > user.notificationsEnabledAt`)
3. **Enforces cooldowns** by checking existing `Notifications` documents:
   - Same `(userId, groupKey)` already pending → merge into existing (`$inc episodeCount`, update `data`)
   - Same `(userId, groupKey)` sent within cooldown window → drop
4. **Persists** via single `bulkWrite` per drain (mix of inserts and updates).

The cooldown ("1 notification per show per 24h") is a query like:
```js
db.Notifications.findOne({
  userId, groupKey, createdAt: { $gte: new Date(Date.now() - 86400e3) }
})
```
keyed by the existing `{ groupKey: 1, userId: 1 }` index.

---

## 7. Sync integration (`run/newContent`)

Three minimal changes in `src/utils/sync/`, plus one boot file:

### 7.1 `BaseRepository.upsert` returns `wasCreated`
```ts
async upsert(doc): Promise<{ document; wasCreated: boolean }> {
  const result = await this.collection.updateOne(
    { originalTitle: doc.originalTitle }, { $set: doc }, { upsert: true }
  )
  return { document: doc, wasCreated: result.matchedCount === 0 }
}
```

### 7.2 Strategies bubble `created` into `SyncResult`
```ts
interface SyncResult {
  // existing fields…
  created?: boolean
  tmdbId?: string
}
```

### 7.3 `run/newContent` emits one event per title new to the library
Not where a title's results come back: a created document is not necessarily new content (cleanup can delete a document whose title comes back, a show re-created under a new `_id` inserts its episodes again, a first sync creates everything). Each pass records every movie and episode it writes into the run's `run/writtenMedia` record as the title finishes, keyed by folder names, so a title two servers have is one candidate. Once per run, after every pass and after post-sync cleanup has decided deletions, `run/newContent` keeps the candidates still there, listed (`isWebVisible`) and not in the announced-titles set (see "New-content notices: what ships" above). It would emit for those:
```ts
for (const title of newToTheLibrary) {        // run/newContent selectAnnounceable
  syncEventBus.emitEntityCreated({
    kind: title.kind,                          // 'movie' | 'episode'
    tmdbId: title.tmdbId,
    // The folder name: a movie result's entityId; for an episode, its show's
    // folder name from the result's metadata.showOriginalTitle. An episode or
    // season result's entityId is "<show> S<n>E<m>" / "<show> S<n>", never a key.
    originalTitle: title.kind === 'movie' ? title.originalTitle : title.showOriginalTitle,
    showTmdbId: title.showTmdbId,
    seasonN: title.seasonNumber,
    episodeN: title.episodeNumber,
    createdAt: title.initialDiscoveryDate,
  })
}
```
The announced-titles set keeps the "at most once per title" promise whichever delivery sits behind the event.

### 7.4 Subscribe at boot (instrumentation.ts)
```ts
export async function register() {
  registerNotificationRules()
  notificationBus.start()
  syncEventBus.on('entity:created', evt => notificationBus.emit({...evt, entityCreatedAt: evt.createdAt}))
}
```

That's the entire integration surface.

---

## 8. Indexes

Verify or add:
```js
db.Watchlist.createIndex({ tmdbId: 1 })
db.WatchHistory.createIndex(
  { 'metadata.id': 1, 'metadata.season': -1, 'metadata.episode': -1 }
)
db.WatchHistory.createIndex({ userId: 1, lastUpdated: -1 })
db.Notifications.createIndex({ userId: 1, createdAt: -1 })
db.Notifications.createIndex({ groupKey: 1, userId: 1 })
```

The compound WatchHistory index is load-bearing — without it, Rule 2 degrades to a full scan.

---

## 9. Performance properties

| Concern | Mitigation |
|---|---|
| N×M fan-out | Content-keyed targeting; lookup inverted to "for this content, which users?" |
| Sync blocking | Bus emit is sync, drain is decoupled timer; no pass `await`s notification work (the run's `run/newContent` emits once, after cleanup) |
| Per-event DB queries | 3 queries per batch regardless of batch size |
| Heap pressure | Tiny event payloads (~200B), bounded queue (10k events = ~2MB ceiling), overflow coalescing |
| Write storms | `bulkWrite` per drain, group merging |
| Long sync loops | `for await` over Mongo cursors; no `.toArray()` over user collections |
| Listener retention | `setInterval.unref()` on bus drain timer |

**Memory profile under sustained load:** bus + small LRU pref cache + per-batch transient ≈ <10MB resident.

---

## 10. Where ML fits

The framework is structured so **deterministic targeting can stay in-process while ML augments or replaces specific layers**. ML candidates, ranked by value:

### High-value, low-risk ML fits

1. **Engagement scoring on top of deterministic matches.** After rules produce `TargetMatch[]`, an ML model scores each match for predicted user engagement (open rate, click-through). Aggregation filters by score threshold or probabilistically. *Fallback: send all matches if scorer is unavailable.*

2. **Send-time optimization.** Per-user model predicts when this user is most likely to engage with a notification (morning vs evening, weekday vs weekend). Populates `TargetMatch.optimalDeliveryAt`. *Fallback: send immediately.*

3. **Frequency capping.** Per-user model predicts "noise tolerance" — how many notifications before this user disengages. Adjusts cooldowns dynamically. *Fallback: hard 24h cooldown.*

### Strong-fit ML candidates

4. **The "followed show" signal (Rule 3).** This is the single rule where deterministic logic struggles most. A model trained on `(user, show, watch_pattern, ts)` → "would this user want a new-season notification?" is a clean classification problem with rich training data from your `WatchHistory` collection.

5. **Re-engagement targeting (Rule 4).** Which stale shows are worth nudging about, for which users? Deterministic logic ("watched 14–90 days ago") over-targets aggressively. Churn-prediction-style models do this well.

6. **Tier-2 discovery notifications.** "You might like *X*" requires recommendation-system thinking — collaborative filtering, content embeddings, or hybrid. This is the most standard ML problem in the design.

### Don't ML these
- **Watchlist match (Rule 1).** Explicit user signal; no ambiguity. Rule-based forever.
- **Next-episode (Rule 2).** Deterministic by definition — they watched E5, E6 just landed. No model improves on this.
- **Aggregation, persistence, channel dispatch.** Plumbing, not relevance.

---

## 11. ML microservice extraction boundary

The cleanest boundary is at the `TargetMatch[]` interface — between targeting and aggregation. Two viable extraction strategies:

### Option A: ML as scoring layer (recommended)

```
[Main app: TargetingService runs deterministic rules]
      ↓ TargetMatch[] (unscored)
[ML microservice: /score endpoint]
      ↓ TargetMatch[] (with score, optimalDeliveryAt populated)
[Main app: AggregationService filters/persists]
```

**Pros:**
- Deterministic rules stay close to MongoDB (low latency, transactional consistency)
- ML service has a narrow, stable contract: `score(matches, userContext) → matches`
- Service can be entirely stateless (pure model inference)
- Graceful degradation: if service is down, main app uses raw matches with default score
- Service can be in any language (Python/PyTorch makes sense)

**Cons:**
- Per-batch HTTP round-trip latency (~5–50ms)
- User-feature data has to be denormalized to send (or fetched independently by the service from a read replica)

### Option B: ML as full targeting layer

```
[Main app: NotificationBus]
      ↓ PartitionedBatch
[ML microservice: /target endpoint]
      ↓ TargetMatch[]
[Main app: AggregationService persists]
```

**Pros:**
- Consolidates ML rules + deterministic rules behind one service
- Service owns all relevance logic — no split-brain

**Cons:**
- Service needs full read access to `Watchlist` and `WatchHistory` (network coupling, schema coupling)
- Harder to fall back when service is down (no notifications at all vs degraded)
- Higher implementation complexity

**Recommendation: Option A.** Keeps deterministic targeting fast and local, isolates ML risk, and the boundary at `TargetMatch[]` is naturally async-tolerant — you can already imagine batching scoring requests across multiple drains.

### The service contract (Option A)

```http
POST /score
Content-Type: application/json

{
  "matches": [
    { "userId": "u1", "reason": "next_episode", "contentRef": {...}, "groupKey": "show:tt123:s2", "priority": 100 },
    ...
  ],
  "context": { "now": "2026-05-10T..." }
}

→ 200 OK
{
  "matches": [
    { ...input, "score": 0.87, "optimalDeliveryAt": "2026-05-10T19:00:00Z" },
    ...
  ]
}
```

Stateless, idempotent, batch-friendly. The service fetches user features (watch history features, engagement history) from its own read replica or feature store.

### Operational considerations
- **Latency budget:** ~50ms p95 — well within the 5s drain window.
- **Fallback:** if request times out or fails, treat all matches as `score=1.0` (send everything). Better than silent dropping.
- **Versioning:** include a `model_version` in responses so main app can log/A-B which model produced which decisions.
- **Data freshness:** the service's view of user features can lag by minutes — notification scoring isn't latency-critical.

---

## 12. Phased rollout

1. **Phase 1 — Plumbing only.** `BaseRepository.wasCreated`, `run/newContent` emits, `NotificationBus` drains, `TargetingService` runs Rule 1 (watchlist match) only. Aggregation writes to existing `Notifications` collection. Validates the wiring end-to-end with the safest deterministic rule.

2. **Phase 2 — Rule 2 (next-episode) + cooldowns.** Adds the highest-value rule. Aggregation gains group-merge and 24h cooldown.

3. **Phase 3 — Preferences UI.** User-facing settings for category enable/disable, quiet hours, per-show mute. No new rules needed.

4. **Phase 4 — Scheduled re-engagement (Rule 4).** Nightly job, separate from sync path.

5. **Phase 5 — Web push channel.** Service worker + subscription storage + ChannelDispatcher. First non-in-app channel.

6. **Phase 6 — ML scoring service.** Stand up the microservice with Option A boundary. Start with a simple engagement classifier; expand to send-time optimization, then "followed show" detection (Rule 3).

7. **Phase 7 — Tier 2 discovery rule.** Recommendations as notifications, gated behind Tier 2 opt-in.

The framework supports each phase additively — no phase forces refactoring of earlier phases.

---

## 13. Open questions

1. **Worker process split.** If notification work ever moves to a separate process, the boot subscriber needs to live there too. Should we use a Mongo `NotificationEvents` collection as a write-ahead log to fully decouple, or accept that single-process is fine?

2. **"Followed show" signal definition** before any model exists. Need an interim heuristic (e.g., "watched ≥3 episodes of prior season AND last watched <180 days ago") that's good enough for Phase 2 and provides training labels for Phase 6.

3. **Cross-rule cache.** Should `TargetingContext` carry a per-batch `Map` for rules to share intermediate results (e.g., "users with notifications enabled" set)? Small addition, opens optimization later.

4. **Notification preference defaults.** Tier 1 enabled by default? Quiet hours default range? These are product decisions that affect the perception of the system more than its design.

5. **Feature store for ML service.** Standalone Mongo read replica vs purpose-built feature store (e.g., Feast). Probably Phase 6 decision.

---

This design is incremental, testable, performance-bounded, and structured so the relevance layer extracts cleanly into an ML service when the data and use case justify it. The deterministic core ships first; ML augments later without touching plumbing.
