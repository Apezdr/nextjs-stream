# Architecture — nextjs-stream

Vendor-neutral reference for how this project is built. Engineering *rules* live
in [AGENTS.md](AGENTS.md); this file holds the project truth those rules point
at. It is a current-state document: when behaviour changes, change it here in
the same commit.

**Required reading before changing anything under `src/utils/sync/` or
`src/utils/flatSync/`.**

## Stack

`package.json` is authoritative for exact versions. Majors only here, so this
table cannot drift into a lie:

| Piece | What is installed |
| --- | --- |
| Framework | Next.js 16, App Router, plus one remaining Pages Router route |
| UI | React 19, Tailwind CSS 3 |
| Language | Mixed TypeScript / JavaScript |
| Database | MongoDB, driver 7, reached through `src/lib/mongodb.ts` — see Conventions, there are two pools |
| Authentication | better-auth 1.x — see `src/lib/auth.ts` |
| Player | `@videojs/react` |
| External metadata | TMDB |
| Tests | Jest 30, jsdom environment. `@testing-library/jest-dom` matchers only — `@testing-library/react` is **not** installed |
| Dead-code analysis | knip 6 |

TypeScript runs with `"strict": false` and `"strictNullChecks": true`
(`tsconfig.json`). It is not fully strict — do not assume strict-mode
guarantees.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server on port 3232 |
| `npm run build` | Production build |
| `npm run start` | Production server |
| `npm test` / `npm run test:watch` | Jest |
| `npx tsc --noEmit` | Typecheck, read-only. Passes clean on this branch |
| `npm run knip` | Dead-code analysis, read-only |
| `npm run analyze` | **Does nothing useful.** It is `ANALYZE=true next build`, but nothing reads `ANALYZE` and `@next/bundle-analyzer` is not installed, so it is a plain production build. Do not cite it as bundle evidence |
| `npm run lint` | **Mutating.** Runs `eslint --fix .` across the whole repository |
| `npm run knip:fix` | **Mutating.** Runs `knip --fix`, which deletes code |
| `npm run knip:report` | **Mutating.** Writes `knip-report.json` into the repo root, which is not gitignored |

`lint-staged` is configured in `package.json`, but no hook installer (husky or
equivalent) is present, so nothing runs it automatically on commit. `prettier`
itself is not a declared dependency, so `npx lint-staged` would fetch it from the
network.

## Sensitive dependencies

- `@videojs/react` is pinned exactly to `10.0.0-beta.26` while v10 remains in
  beta. Only `src/components/MediaPlayer/videojs.js` may import it directly.
  Treat that file as a beta-drift firewall and absorb upstream API renames
  there instead of scattering them across the app.
- `better-auth` is pinned exactly to `1.6.9` temporarily. From `1.6.11`
  onward, `POST /device/approve` and `/device/deny` reject with
  `400 invalid_request` unless `GET /device?user_code=…` has already bound the
  code to the verifying session; `src/app/(styled)/device/device-auth-client.tsx`
  does not make that call yet, so upgrading would break QR/TV sign-in. When
  this hold is lifted, also set `advanced.ipAddress.trustedProxies` in
  `src/lib/auth.ts` before moving past `1.6.21`, or unresolved client IPs
  behind Cloudflare/Apache collapse every device into one shared rate-limit
  bucket.

## Directory layout

- `src/app/` — App Router pages and API routes
- `src/pages/` — one surviving Pages Router route, the Chromecast receiver
- `src/components/` — React components, grouped by feature
- `src/lib/` — core utilities: MongoDB client, auth configuration
- `src/utils/` — business logic and database operations
- `src/contexts/` — React contexts for global state
- `__tests__/` — Jest tests, plus colocated `src/**/__tests__/` directories
- `__mocks__/` — mocks for external dependencies

Path aliases are `@src/*` and `@components/*`.

Prefer TypeScript for new files in `src/lib/` and `src/app/api/`. JavaScript is
acceptable for components and utilities.

## Dual-title architecture

Two distinct title fields exist and they are not interchangeable.

**`originalTitle`** is the filesystem key. It is the actual folder name on the
media servers, and it is the primary key for database lookups. Use it for every
filesystem path and every database key.

**`title`** is the pretty display name from TMDB. Use it for UI only.

```javascript
// ✅ originalTitle for filesystem and database
const posterPath = `/movies/${movie.originalTitle}/poster.jpg`
const found = await repository.findByOriginalTitle(originalTitle)

// ✅ title for display
const displayName = movie.title // "The Matrix"

// ❌ title in a path — this 404s
const wrongPath = `/movies/${movie.title}/poster.jpg`
```

This invariant reaches beyond the sync trees: routing, admin actions and media
pages all rely on it.

## Multi-server field-level priority

Media data arrives from several servers. Priority is resolved per field, not per
document.

- Each field can have a different source server depending on availability.
- Server priority decides precedence — lower number wins.
- `fieldAvailability` is a pre-computed map of which servers hold data for each
  field.
- Field-level source tracking (`metadataSource`, `videoSource`, `posterSource`,
  and so on) records provenance and enables granular conflict resolution.

Check priority before writing any field:

```javascript
import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'

const canUpdate = isCurrentServerHighestPriorityForField(
  fieldAvailability,
  'movies',
  originalTitle, // the key is always originalTitle
  'posterURL',
  serverConfig
)

if (canUpdate) {
  movie.posterURL = newUrl
  movie.posterSource = serverConfig.id
}
```

## Sync system

Data is stored in flat collections — `FlatMovies`, `FlatTVShows`, `FlatSeasons`,
`FlatEpisodes` — rather than nested documents. Two orchestration paths write to
them.

A separate legacy `Movies` collection still exists and is still read by
`src/utils/recommendations/index.js`, `src/utils/auth_database.js`,
`src/utils/sync/chapters.js` and `src/utils/sync/videoAvailability.js`. It is not
the flat collection and nothing new should be pointed at it.

**Domain-driven sync (`src/utils/sync/domain/`) is the live default.**
`shouldUseNewArchitecture()` in `src/utils/sync/featureFlags.js` returns `true`
in every environment branch. `USE_NEW_SYNC_ARCHITECTURE` is read and logged but
cannot turn the new path off — and `.env.example` ships it as `false`, which has
no effect. The only real off-switches are the runtime `forceOld` option and the
automatic fallback in `flatSync/index.js`. It uses a strategy pattern with domain
services (`MovieSyncService`, `EpisodeSyncService`, and siblings) and TypeScript
interfaces.

Its defining property is a **single write chokepoint per entity**:
`BaseRepository.smartUpsert`, `EpisodeRepository.smartBulkUpsert` and
`SeasonRepository.smartBulkUpsert`. That is where `lockedFields` enforcement
(`computeDiff`) and `manualFields` cleanup (`manualFieldsToClear`) live.

**Legacy flat sync (`src/utils/flatSync/`) is deprecated and remains the
automatic fallback** if the new architecture throws or fails a compatibility
check (`flatSync/index.js`). It has no single chokepoint: each field — poster,
backdrop, metadata — issues its own `updateOne` per media type. Fix bugs in it;
do not add features to it.

Writing a new sync strategy:

```javascript
class NewSyncStrategy implements SyncStrategy {
  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const originalTitle = context.entityOriginalTitle || entity?.originalTitle
    const dataPath = `/movies/${originalTitle}/data.json`

    if (this.shouldUpdateField('fieldName', originalTitle, context)) {
      // update, and record the source
    }
  }

  private shouldUpdateField(fieldPath: string, mediaTitle: string, context: SyncContext): boolean {
    return isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'movies', mediaTitle, fieldPath, context.serverConfig
    )
  }
}
```

Supporting components: `SyncManager` orchestrates and carries both titles;
`MovieMetadataStrategy` and `MovieAssetStrategy` handle metadata and assets with
priority checks; `BaseRepository` keys everything on `originalTitle`;
`SyncContext` carries `entityTitle` and `entityOriginalTitle`.

To trigger a sync locally:

```
POST http://localhost:3232/api/authenticated/admin/sync
X-Webhook-ID: <your WEBHOOK_ID — never commit the real value>
```

`X-Webhook-ID` is a bearer credential. `src/utils/routeAuth.js` accepts it in
place of an admin session, so treat it as a secret, not an identifier. It is
also accepted as a `?webhookId=` query parameter, which puts the secret into
URLs, browser history and access logs — prefer the header, and never build a
link that carries it.

### Common sync mistakes

- Using `title` for a filesystem path or a database key. Use `originalTitle`.
- Assigning a field without checking priority first, which overwrites
  higher-priority data.
- Putting sync or bulk work on the request-serving MongoDB pool. See Conventions.

## Other subsystems

- **Media management** — multi-server, priority-based ownership; hash-based sync
  optimisation; multiple qualities (4K, HDR, Dolby Vision); integrations with
  Radarr, Sonarr, Tdarr and SABnzbd.
- **Authentication** — better-auth with a MongoDB adapter, a custom user approval
  system (admin-controlled or auto-approval), and QR-code authentication for
  mobile devices.
- **Watchlist** — personal and shared playlists, dual search against the internal
  database and TMDB, external media via TMDB, deduplication and deterministic
  hydration.

## Video player

- The web player stack is `@videojs/react` (Video.js v10 React framework).
- The old vidstack, `media-icons`, and top-level `hls.js` dependencies were
  removed. HLS now comes through `@videojs/media`'s bundled hls.js via
  `HlsJsVideo`.
- Banner trailer and hover-card previews do not use the player framework. They
  use the YouTube IFrame API in `src/components/VideoPreview/`, with a plain
  `<video>` branch for direct-file clips.

## Conventions

- Authenticated routes live under `/api/authenticated/`. Path is a convention,
  not an enforcement mechanism — see the trust-boundary rule in
  [AGENTS.md](AGENTS.md).
- **There are two MongoDB pools and picking the wrong one has caused an outage.**
  Request, route-handler and RSC paths use the default export:
  `import clientPromise from '@src/lib/mongodb'`. Sync orchestration, bulk
  writes, index builds and full-collection scans use `getSyncClientPromise()`.
  `src/lib/mongodb.ts` records why: sync work exhausted the shared pool and
  request queries queued 4-5 seconds for a connection checkout. Never hand the
  request client to a process-cached sync adapter.
- Components use Tailwind, skeleton loading states, and React hooks; follow
  accessibility practice.
- Use error boundaries and toast notifications; log errors without exposing
  sensitive data.
- Environment configuration lives in `.env.local`. `.env.example` is the
  complete variable template; `README.md` covers the setup narrative and does
  not list every variable.

## knip configuration

Decisions encoded in `knip.json`, recorded so nobody "cleans them up":

- `sharp` is in `ignoreDependencies`, but it is no longer declared in
  `package.json` — Next.js resolves it as its own optional dependency, so the
  entry is vestigial.
- `@eslint/js` is in `ignoreDependencies` because `eslint.config.js` requires it
  while `package.json` does not declare it; it resolves transitively through
  `eslint`.
- Entry globs use directory wildcards (`Landing/**/*`) so lazy-loaded siblings
  are covered.
- `ignoreExportsUsedInFile: true` avoids false positives for module-local
  helpers.
