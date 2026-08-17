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
| Framework | Next.js 16, App Router |
| UI | React 19, Tailwind CSS 3 |
| Language | Mixed TypeScript / JavaScript |
| Database | MongoDB, driver 7, reached through `clientPromise` in `src/lib/mongodb.ts` |
| Authentication | better-auth 1.x — see `src/lib/auth.ts` |
| Player | `@vidstack/react` |
| External metadata | TMDB |
| Tests | Jest 30 + React Testing Library, jsdom environment |
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
| `npm run analyze` | Build with bundle analysis |
| `npm run knip` | Dead-code analysis, read-only |
| `npm run lint` | **Mutating.** Runs `eslint --fix .` across the whole repository |
| `npm run knip:fix` | **Mutating.** Runs `knip --fix`, which deletes code |

`lint-staged` is configured in `package.json`, but no hook installer (husky or
equivalent) is present, so nothing runs it automatically on commit.

## Directory layout

- `src/app/` — App Router pages and API routes
- `src/components/` — React components, grouped by feature
- `src/lib/` — core utilities: MongoDB client, auth configuration
- `src/utils/` — business logic and database operations
- `src/contexts/` — React contexts for global state
- `__tests__/` — Jest tests
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
`shouldUseNewArchitecture()` in `src/utils/sync/featureFlags.js` returns true
unless explicitly forced off via `USE_NEW_SYNC_ARCHITECTURE`. It uses a strategy
pattern with domain services (`MovieSyncService`, `EpisodeSyncService`, and
siblings) and TypeScript interfaces.

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
place of an admin session, so treat it as a secret, not an identifier.

### Common sync mistakes

- Using `title` for a filesystem path or a database key. Use `originalTitle`.
- Assigning a field without checking priority first, which overwrites
  higher-priority data.
- Substituting a default value so execution can continue after an error. The
  sync path must rely on data properly passed through the functions.

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

## Conventions

- Authenticated routes live under `/api/authenticated/`. Path is a convention,
  not an enforcement mechanism — see the trust-boundary rule in
  [AGENTS.md](AGENTS.md).
- Use `clientPromise` from `@src/lib/mongodb` for database access.
- Components use Tailwind, skeleton loading states, and React hooks; follow
  accessibility practice.
- Use error boundaries and toast notifications; log errors without exposing
  sensitive data.
- Environment configuration lives in `.env.local`. `README.md` owns the full
  variable list.

## knip configuration

Decisions encoded in `knip.json`, recorded so nobody "cleans them up":

- `media-icons` is in `ignoreDependencies` — it is used internally by
  `@vidstack/react`, not imported directly by our source. It is pinned to `1.1.5`
  because `@vidstack/react` imports `accessibilityPaths`, which exists only in
  `1.x`.
- `sharp` is in `ignoreDependencies` — Next.js image optimisation uses it at
  runtime.
- `@eslint/js` is in `ignoreDependencies`.
- Entry globs use directory wildcards (`Landing/**/*`) so lazy-loaded siblings
  are covered.
- `ignoreExportsUsedInFile: true` avoids false positives for module-local
  helpers.
- `react-countup` is used through direct imports in search count components.
