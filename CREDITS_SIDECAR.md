# Credits sidecar (v1)

A title's credits and licenses are stored in a file of their own, beside its
metadata. They are synced apart from the TMDB metadata, kept in their own
field, and shown in a **Credits & licenses** panel. The overview stays a
synopsis.

This document is the contract between the media processor (which finds the
file), the frontend sync (which reads, validates and stores it), the API, and
every client that shows it. The schema is
[`src/utils/credits/credits.schema.json`](src/utils/credits/credits.schema.json).
The processor's part is also described in its `docs/BACKEND_ARCHITECTURE.md`.

The fields record and present what was supplied. A license label is a recorded
grant claim, not proof of ownership or approval, and nothing here establishes
legal compliance by itself.

## 1. Files

| Title | File | Asset paths are relative to |
| --- | --- | --- |
| Movie | `movies/<folder>/credits.json` | the movie folder |
| Show | `tv/<folder>/credits.json` | the show folder |
| Episode (optional) | `tv/<folder>/<season folder>/<NN>_credits.json` | the season folder |

`<NN>` is the episode number exactly as the episode's `<NN>_metadata.json` is
named. The file is optional everywhere. It is found independently of
`metadata.json` and `tmdb.config`: a frozen title (`update_metadata: false`)
still publishes its credits.

The largest file read is **256 KiB** (262,144 bytes), on both sides.

## 2. What the processor publishes

Each movie entry and show entry of `/media/movies` and `/media/tv`, and each
episode object inside a show's `seasons`, carries a `credits` value:

| Value | Meaning |
| --- | --- |
| `{ "url": "<path>?hash=<h>", "hash": "<h>" }` | The file is there and was read. `h` is the SHA-256 (hex) of the file's bytes. |
| `{ "absent": true }` | The folder listing has no such file: confirmed absence. |
| `{ "error": "unreadable" \| "too-large" \| "empty" }` | The listing has the file, but it could not be read, is over 256 KiB, or has 0 bytes. Not an absence. |
| key missing | A processor that predates this contract. Says nothing either way. |

The processor never parses the file: it lists it, checks its size, and hashes
its bytes. It does not hash videos or any other file for this. A row the scan
could not read (its directory listing failed) keeps its previous value, as
every other field of that row does. A title whose stored value is
`unreadable` is read again on every scan (a permission fix moves no file
time); `too-large` and `empty` are read again when the file is edited, which
moves the folder's hash.

The value is part of the entry, so the manifest hash moves when it does, and
the frontend's tick selects the title (no separate hash). `MEDIA_PAYLOAD_VERSION`
11 publishes it on every title once.

## 3. Schema version 1

```json
{
  "schemaVersion": 1,
  "assets": [
    { "id": "film", "kind": "film", "path": "Example.mp4" },
    { "id": "poster", "kind": "poster", "path": "poster.jpg", "label": "Poster" },
    {
      "id": "series-art", "kind": "backdrop", "path": "backdrop.jpg",
      "derivedFrom": [{ "libraryPath": "tv/Example/Season 1/03 - Example.mp4", "note": "Frame from episode 3, cropped" }]
    }
  ],
  "entries": [
    {
      "id": "film-credit",
      "assetIds": ["film"],
      "kind": "film",
      "work": "Example film",
      "author": "Creator / designated attribution parties",
      "authorUrl": "https://example.com/creator",
      "attributionText": "Exact attribution text, as supplied",
      "copyrightNotice": "Copyright notice, as supplied",
      "license": "CC BY 4.0",
      "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
      "sourceUrl": "https://example.com/official-release",
      "notices": ["A license or warranty-disclaimer notice, as supplied"],
      "historicalNotices": ["A notice shown on the original work, kept verbatim"],
      "modification": "Video transcoded for streaming.",
      "previousModifications": ["A change an earlier distributor indicated"],
      "exclusions": ["What the grant does not cover, e.g. logos"],
      "evidenceId": "rights-example-film",
      "note": "Any further supplied attribution"
    }
  ]
}
```

- **Assets** are the files or roles that credits bind to. `id` is stable: an
  entry names assets by id, so renaming a file only changes its `path`.
  `kind` is one of `film`, `episode`, `trailer`, `poster`, `backdrop`, `logo`,
  `thumbnail`, `artwork`, `music`, `audio`, `subtitles`, `other`. `derivedFrom`
  names the inputs an asset was made from, by library path (`movies/…` or
  `tv/…`), in this title or another: the frame of an episode used as series
  art, the posters in a collage.
- **Entries** are credits. Each binds to one or more assets of the same file
  (`assetIds`). A grant for the film covers only the assets it names: a poster,
  a separate audio or subtitle track, a logo or a trademark needs an entry of
  its own. Different assets of one title may carry different licenses.
- Every entry field but `id` and `assetIds` is optional. An entry needs at least
  one of `work`, `author`, `attributionText`, `copyrightNotice`, `license` or
  `notices`. Never fill a field that was not supplied, and never infer a
  license or a permission from a title.
- `notices` are the supplied license and disclaimer notices. `historicalNotices`
  are notices that appear on or with the original work (an on-film notice) when
  the current license basis is a separate, later offer: they are kept verbatim,
  never rewritten, and never imply endorsement. `modification` is this
  distributor's change; `previousModifications` keeps the ones earlier
  distributors indicated. `exclusions` lists what the grant does not cover.
- **`evidenceId`** is an opaque id into the private rights ledger (source
  download URLs, file SHA-256, grant-page capture with its date and hash, full
  license text, chosen grant basis, review notes). The ledger is never published.
  Signed letters, private correspondence, credentials, and absolute local or
  server paths never go in a sidecar. The evidence package stays the source of
  store-submission documents; a sidecar does not replace it.
- Arrays keep their authored order, and every client shows them in that order.

### Validation

The frontend validates every file before storing it. A file that fails any rule
is a **failed input**, never an absence (section 5).

1. At most 256 KiB, UTF-8 (a leading byte-order mark is ignored), valid JSON,
   and its SHA-256 equals the `hash` the processor published.
2. `schemaVersion` is 1. Any other version is *unsupported*.
3. The schema: no unknown keys anywhere (a misspelt `licenceUrl` would
   otherwise drop a notice without a word), types, enums, the id pattern, and
   the length and count limits. Text is never truncated to fit: a value over
   its limit fails the file.
4. Asset ids are unique, entry ids are unique, an entry's `assetIds` are unique
   and each names an asset of the same file.
5. `path` and `libraryPath` are relative: no leading `/`, no `\`, no drive
   letter, no scheme, no empty, `.` or `..` segment. `libraryPath` begins with
   `movies/` or `tv/`.
6. `authorUrl`, `licenseUrl` and `sourceUrl` are absolute `http:` or `https:`
   URLs with no user name or password. Clients never fetch them: they are links.
7. No control characters other than tab, line feed and carriage return.
8. `suppress` and `replaces` are allowed in episode files only.

## 4. Inheritance (episodes)

An episode shows its show's credits plus its own. Resolution is by entry and
asset identity, never by a series-wide license:

- Show entries are inherited. Silence never removes one: an episode file that
  says nothing about an inherited entry leaves it in place.
- `suppress: [id, …]` (episode file) hides those inherited entries on this
  episode.
- An episode entry with `replaces: [id, …]` takes the place of those inherited
  entries, at the position of the first.
- Any other episode entry is added after the inherited ones. If its id is also
  an inherited entry's id, both are kept: a credit is never dropped without an
  explicit `suppress` or `replaces`.
- An entry's `assetIds` always resolve in the file it came from, so an
  inherited entry keeps its show-level assets: series art derived from one
  episode stays credited as that episode's art on every episode page.

## 5. Frontend sync

`credits` is its own field, owned and tracked like the others, and apart from
`metadata` and its lock.

**Stored fields** (FlatMovies, FlatTVShows, FlatEpisodes):

| Field | |
| --- | --- |
| `credits` | The last valid file, as validated (the episode's own file on an episode). |
| `creditsSource` | The server it came from. |
| `creditsHash` | The `hash` it was published under. |
| `creditsStatus` | Only while the last attempt failed: `{ state: "error", reason, detail?, serverId, hash?, since }`. Removed by the next success, or on a run every server answered in which none claims the credits. |

**Ownership.** The servers that claim a title's credits are those that publish
a `url` or an `error` for it. The owner is the highest-priority claimant (ties
on server id), checked fail-closed with the availability map's exact leaf paths
(`credits.url`, `credits.error`; for an episode
`seasons.<season key>.episodes.<episode key>.credits.url`, across every
server's season key). A server's error is a claim, so a failure on the owner
never hands the credits to a lower-priority server.

**The owner's pass:**

- Its `hash` equals `creditsHash`, `creditsSource` is this server and there is
  no `creditsStatus`: nothing to do, nothing fetched.
- Otherwise it fetches the URL through the sync's file fetcher (the server's own
  host only), validates the bytes, and on success writes `credits`,
  `creditsSource`, `creditsHash` and removes `creditsStatus`.
- A fetch that fails, a file that fails validation, or an `error` the server
  published: the stored `credits` and `creditsHash` stay as they are,
  `creditsStatus` records why (its `since` is kept while the reason and hash
  stay the same, so a retry does not rewrite the document), and the plan is
  incomplete: the gate stays open and the next pass tries again. The kept
  credits are the last valid ones, not a newly verified grant: `creditsHash`
  still names the file they came from.

**Confirmed removal.** The credits fields are removed only when all of these
hold: every enabled server answered this run; no server publishes a `url` or an
`error` for the title (or episode); every server that has the title (or
episode) publishes `absent`; and the server syncing is one of them. A processor
that predates this contract publishes no `credits` key and so can never confirm
an absence. With a server missing from the run, the removal is held back and
the gate stays open.

An admin lock on `credits` keeps it as stored.

## 6. API

`GET /api/authenticated/media` returns `credits` resolved for display on
movies, shows and episodes (the TV branch and the default branch alike):

```json
{
  "credits": {
    "schemaVersion": 1,
    "entries": [
      {
        "id": "film-credit",
        "scope": "title",
        "assets": [{ "id": "film", "kind": "film", "path": "Example.mp4" }],
        "work": "Example film",
        "license": "CC BY 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by/4.0/"
      }
    ]
  }
}
```

Each entry is the file's entry with its `assetIds` replaced by the `assets`
they name (from the entry's own file) and a `scope`: `title` on a movie or a
show, `show` or `episode` on an episode (section 4). `credits` is absent when
there is nothing to show. `creditsSource`, `creditsHash` and `creditsStatus`
are admin information and are left out.

## 7. Showing credits

- A panel of its own, **Credits & licenses**, below the synopsis and outside
  the hero. High-contrast text with room between entries.
- Grouped by kind (the entry's `kind`, else its first asset's): Video (`film`,
  `episode`, `trailer`), Artwork (`poster`, `backdrop`, `logo`, `thumbnail`,
  `artwork`), Music & audio, Subtitles, Other. Authored order inside a group.
- Every supplied field is shown in full: nothing is truncated or summarised.
  Long conditions (`notices`, `historicalNotices`, `note`) may sit in a
  disclosure (`<details>`), which keeps them in the page and reachable from the
  keyboard.
- Text is text: never rendered as HTML or Markdown. A link is rendered only for
  an `http:` or `https:` URL, with a visible label, and opens in a new tab with
  `rel="noopener noreferrer"`.
- An unknown or missing value is left out, never replaced with a guess.

## 8. Rollout

1. Deploy the processor (credits published) and the frontend (credits stored,
   API and web panel) in either order: the frontend's `SYNC_GATE_VERSION` 4
   makes its first pass after deploy a full one.
2. Ship the native clients' panel (the TV app hand-off doc).
3. Write the sidecars from the verified credits.
4. Once the credits show in every client, remove the attribution blocks that
   were appended to overviews, and their manual overrides. Keep the synopsis,
   the full credits, the source records and the original video notices.
   Confirm through a scheduled scan and sync.
