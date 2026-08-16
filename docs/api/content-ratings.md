# Content Ratings

NextJS Stream exposes normalized United States movie and television content
ratings without requiring clients to parse provider-specific responses.

## Metadata contract

Media detail responses may include a top-level `contentRating` object:

```json
{
  "contentRating": "PG-13",
  "country": "US",
  "system": "MPA",
  "mediaType": "movie",
  "descriptors": ["Violence", "Strong Language"],
  "reason": null,
  "source": "TMDB",
  "provider": "tmdb"
}
```

Compatible movie ratings may carry optional field-level evidence:

```json
{
  "contentRating": "R",
  "provider": "tmdb",
  "source": "TMDB",
  "certificateId": "55720",
  "enrichments": [
    {
      "provider": "wikidata",
      "source": "Wikidata",
      "fields": ["contentRating", "certificateId"],
      "sourceId": "Q136163067",
      "ratingSourceId": "Q18665344",
      "externalIds": {
        "tmdb": "1339713",
        "imdb": "tt37287335"
      },
      "certificateProperty": "P2676",
      "retrievedAt": "2026-08-16T00:00:00.000Z"
    }
  ]
}
```

The top-level `provider` and `source` still identify the source that selected
the classification. An enrichment record identifies only the fields it
corroborated or supplied. Optional keys are omitted when absent; existing
unenriched objects retain their original eight-field shape.

Television uses `system: "TV Parental Guidelines"` and `mediaType: "tv"`.
The field is `null` or absent when no valid US rating is available. Missing
data is never represented as `NR`.

`provider` is the canonical provenance identifier. Provider identifiers are
lowercase, bounded tokens such as `tmdb`; `legacy` means the value came through
the pre-provider scalar path and its upstream lineage is not represented by a
provider adapter. Administrator-selected values use `manual`.

`source` remains in the object because it shipped in the first rating contract.
Its existing `TMDB` default is preserved for backward compatibility, including
legacy scalar records, so new clients must use `provider` for provenance.

The legacy `metadata.rating` string also remains unchanged for older web, TV and
native clients. New clients should prefer the top-level normalized object and
fall back to the legacy string during the compatibility window.

## Provider architecture

```text
provider metadata already on the request path
  -> fixed provider adapter registry
  -> normalized candidates
  -> first-valid atomic resolver
  -> application, API and clients
```

TMDB is the only active classification provider. Its adapter owns all parsing
of TMDB `release_dates` and `content_ratings` response shapes. Generic
normalization, the resolver, UI and SVG generator do not inspect those fields.

Wikidata is a separate, frozen field enricher over processor-supplied metadata.
It cannot select or change a rating code. It may add a certificate ID or fill
an otherwise empty descriptor set only for movies when the TMDB ID matches,
the optional IMDb ID does not conflict, and Wikidata's mapped P1657 value is an
exact match for the already-selected MPA code. P7367 descriptors remain one
atomic set; descriptor arrays from different providers are never unioned.

The registry is a frozen in-process list. There is no dynamic loading, provider
configuration, credential lookup or network call in the content-rating
resolver. A future provider is added by implementing the same synchronous
adapter contract over metadata already available to the request and registering
it at the desired precedence position.

Provider adapters receive a transient `externalIds` object assembled from IDs
already present on the media record (`tmdb`, `imdb` and `tvdb` when available).
Those IDs help an adapter identify the media but are not provenance evidence,
are not persisted by this subsystem and are not included in the rating object.

Resolution remains backward-compatible:

1. A valid top-level normalized object.
2. A valid normalized object under `metadata.contentRating`.
3. The first valid candidate from the fixed provider registry.
4. The legacy `metadata.rating` scalar.
5. `null`.

After an automatic candidate is selected, fixed enrichers may add compatible
optional fields without changing its code, country, system, media type or
primary provenance. Manual override and explicit suppression return before the
enrichment phase, so provider evidence never modifies administrator intent.

Candidates are selected atomically. Descriptors and reasons are never filled
from a different candidate, so metadata for `R` cannot be attached to a
`PG-13` classification. Provider failures are isolated and resolution proceeds
to the next provider or legacy fallback.

## Administrative overrides

Movie and TV show editors expose a lockable content-rating selector. The
persisted `contentRatingOverride` field has three states:

- absent — follow automatic provider resolution
- normalized object with `provider: "manual"` and `source: "Manual"` — use the
  selected rating
- `null` — explicitly suppress the rating and render no badge

Locking the field stores the selected rating, or stores suppression when the
administrator chooses `No rating`. Unlocking removes the override and its
manual marker, returning the title to automatic provider metadata. For a locked
rating, administrators may enter descriptors one per line. Descriptors are
trimmed, deduplicated, bounded and sanitized by the same normalization layer as
provider values; blank input persists an empty array. Official rating reasons
remain unavailable and `reason` stays `null`.

The override is distinct from the read-time `contentRating` result. This avoids
persisting a derived provider value merely because an administrator edited an
unrelated field. Scans do not write the override, so it remains stable even
when metadata is refreshed concurrently. Existing documents without an
override require no migration.

Authority levels are not exposed yet. With only one classification provider, labels
such as `official` or `licensed` would make claims this repository cannot prove
and would add no selection information. Registry order is the current explicit
policy. TMDB supplies no stable rating-record identifier or rating-retrieval
timestamp in the consumed contract; those keys appear only inside a validated
enrichment record when its source supplies them.

## Selection

The TMDB movie adapter selects ratings from `release_dates` results whose
`iso_3166_1` is `US`. Empty and unsupported certifications are skipped. Release
types use TMDB's documented numeric meanings and this priority:

1. Theatrical (`3`)
2. Theatrical limited (`2`)
3. Premiere (`1`)
4. Digital (`4`)
5. Physical (`5`)
6. TV (`6`)

Within one type, the earliest valid release date wins. Identical dates use the
canonical rating string and normalized descriptors as deterministic
tie-breakers, so provider array order cannot change the result.

The TMDB television adapter selects only US `content_ratings` results. When
malformed duplicate US rows exist, the canonical rating string and descriptors
provide deterministic tie-breakers.

Supported movie values are `G`, `PG`, `PG-13`, `R`, `NC-17` and `NR`. Explicit
`UNRATED`, `NOT RATED` and `NOT_RATED` values normalize to `NR`; absence and
unknown values do not.

Supported television values are `TV-Y`, `TV-Y7`, `TV-Y7-FV`, `TV-G`, `TV-PG`,
`TV-14` and `TV-MA`. Movie and television values are never mapped across
systems.

Descriptors are retained only from the selected provider record. They are
trimmed, deduplicated, bounded and rendered as text. Markup, control characters,
Unicode format controls, non-string values and overlong values are discarded.
TMDB's movie `note` field is not documented as an official rating reason, so
`reason` remains `null`.

## Data flow and caching

```text
TMDB
  -> existing Node backend
  -> existing authenticated TMDB proxy and Redis/ETag transport
  -> stored or comprehensive metadata already on the request path
  -> TMDB content-rating adapter
  -> provider-neutral resolver and read-time normalization
  -> media detail/API response
  -> detail UI and player
```

Automatic ratings are derived dynamically from metadata already present in
memory. Only an explicit administrative override or suppression is persisted;
there is no migration or rating-specific database query. The existing
`getRating(mediaId, type)` client remains available but is not called by detail
pages; doing so would add an unnecessary request. The existing Redis body cache
and backend/client ETag behavior are unchanged. Provider resolution is
synchronous and adds no browser, provider, MongoDB or Redis request.

Optional Wikidata network access belongs to the media processor's scanner. The
frontend consumes only a namespaced, cached metadata envelope already present
on the normal detail path. Card/list rendering makes zero Wikidata requests,
and the authenticated comprehensive path cannot turn a cold watchlist into
live Wikidata fan-out.

Wikidata coverage is incomplete and community maintained. Many films have no
P7367 descriptors, including the verified Obsession record. Certificate and
reference presence does not create an official reason; `reason` remains
`null`. Missing, conflicting or unavailable enrichment always falls back to
the existing TMDB or manual result.

Movie detail pages render an always-visible, responsive SVG. For G, PG, PG-13,
R and NC-17, the outer SVG embeds exactly one allowlisted same-origin vector
under `/assets/content-ratings/mpa/`; these public-domain templates preserve the
official outlined rating, classification, footer and seal artwork. Their source
and license evidence are recorded beside the assets in
`public/assets/content-ratings/mpa/README.md`.

The local templates store their finite classification colors as black vector
paths. The movie panel therefore needs no runtime monochrome filter, avoiding
rasterization of the small official footer when the SVG is enlarged.

For PG through NC-17, the renderer masks the template's baked placeholder field
and overlays normalized title-specific descriptors, or the explicit `SPECIFIC
CONTENT INFORMATION NOT PROVIDED` state, in Arial/Helvetica Bold. The G template
retains its official `GENERAL AUDIENCES` panel because it has no descriptor
placeholder. NR is rendered as a native inline fallback without an asset
request. The outer canvas is transparent and the rating block remains readable
over white, dark and image backgrounds.

The SVG contains no `foreignObject`, script, style, link or remote asset. Its
classification definition and optional certificate or enrichment evidence are
available through `<desc>`; a definition is not a fabricated title-specific
reason. Raw Wikidata entity, statement, property, external-ID and reference URL
fields are never rendered.

Movie playback replaces the compact top-right badge with the official block,
bounded to 224-256 CSS pixels and 35% of the viewport width. TV detail and
playback remain compact-only. Both forms consume metadata already on the
request path and add no provider, MongoDB or Redis request. A classified
movie panel adds one cacheable local static-asset request; repeated use of the
same asset is browser-cacheable. The compact badge and NR fallback add none.
Search, home, collection and watchlist cards intentionally omit rating UI to
avoid clutter and per-card work.

## SVG badge endpoint

```text
GET /api/rating-badge/v1/{rating}.svg
HEAD /api/rating-badge/v1/{rating}.svg
```

Examples:

```text
/api/rating-badge/v1/PG-13.svg
/api/rating-badge/v1/TV-MA.svg
```

The route is public because it returns only deterministic artwork for a finite
allowlist; it never reads media metadata or authentication state. Clients can
derive the path from the normalized `contentRating` string and the documented
generator version. An absolute URL should use the client's configured public
NextJS Stream origin, never an internal backend or Docker hostname.

Successful responses use:

```text
Content-Type: image/svg+xml; charset=utf-8
Cache-Control: public, max-age=31536000, immutable
X-Content-Type-Options: nosniff
Access-Control-Allow-Origin: *
```

The response also applies a self-contained SVG content security policy and
permits cross-origin use of this public non-user-specific asset. Any visual or
byte change requires a new URL version; `v1` bytes are immutable.

Only exact canonical filenames are accepted. Aliases, lowercase values,
unexpected query parameters, traversal, encoded markup, null bytes, oversized
segments and unsupported ratings receive bounded `400` or `404` text responses
that do not echo input.

The generated SVG uses fixed geometry, generic local font rendering and basic
SVG primitives. It contains no script, event handler, `foreignObject`, external
resource, stylesheet, data URL, remote font, provider text or request text.
PNG output and themes are not part of version 1.

## Limitations

- TMDB does not provide a US rating for every title.
- Descriptor coverage depends on what TMDB supplies and may be incomplete.
- No current source proves an official rating reason, so reasons are unavailable.
- Series ratings are used for TV episodes when no episode-specific contract is
  present.
- External client repositories must adopt the additive field and badge path
  independently.
