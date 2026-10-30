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
| Library (optional) | `credits.json` at the library root, beside `movies/` and `tv/` | the library root |

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
| `{ "error": "unreadable" \| "too-large" \| "empty" \| "not-a-file" }` | The listing has the name, but the file could not be read, is over 256 KiB, has 0 bytes, or is not a regular file (a folder). Not an absence. |
| key missing | A processor that predates this contract. Says nothing either way. |

The processor never parses the file: it lists it, checks its size, and hashes
its bytes. It does not hash videos or any other file for this. A row the scan
could not read (its directory listing failed) keeps its previous value, as
every other field of that row does. A title whose stored value is
`unreadable` is read again on every scan (a permission fix moves no file
time); `too-large`, `empty` and `not-a-file` are read again when the file is
edited or replaced, which moves the folder's hash.

The value is part of the entry, so the manifest hash moves when it does, and
the frontend's tick selects the title (no separate hash). `MEDIA_PAYLOAD_VERSION`
11 publishes it on every title once.

**The library's file** is published in both manifests (`GET /media/movies/manifest`
and `GET /media/tv/manifest`), beside the titles, in the same four states:

```json
{ "format": 2, "kind": "movies", "version": 1.0001,
  "library": { "credits": { "url": "<prefix>/credits.json?hash=<h>", "hash": "<h>" } },
  "titles": { } }
```

It is read on every scheduled scan tick (one listing of the root, at most one
small read), stored by the processor, and changes both manifests' ETags only
when it changes. A manual `POST /media/scan` does not read it: after adding
or editing the file, wait for the next scheduled scan to publish it before
expecting the frontend's sync to see it. A root the scan cannot list is `unreadable`, never `absent`. A
processor that predates it sends no `library` key, and the manifest format
stays 2 (deployed frontends ignore the key).

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

1. Its raw bytes' SHA-256 equals the `hash` the processor published (checked
   first; bytes with another hash are not judged at all), then: at most
   256 KiB, strict UTF-8 (a leading byte-order mark is ignored), valid JSON.
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
- Otherwise it fetches the file's raw bytes through the sync's file fetcher
  (the server's own host only; cached as the same bytes), checks their
  SHA-256 against the published hash, then their size, then decodes them as
  strict UTF-8 and validates them. On success it writes `credits`,
  `creditsSource`, `creditsHash` and removes `creditsStatus`.
- Any failure keeps the stored `credits` and `creditsHash` as they are and
  records why in `creditsStatus` (its `since` is kept while the reason and
  hash stay the same, so a repeat does not rewrite the document). The kept
  credits are the last valid ones, not a newly verified grant: `creditsHash`
  still names the file they came from.
  - **Retried** on the next pass (the gate stays open): a fetch that failed,
    bytes whose SHA-256 is not the published hash (whatever they hold: they
    are not the published file), and a processor `error` of `unreadable` (or
    one this build does not know).
  - **Rejected** until the file changes (the gate may close; an edit moves
    the payload and reopens it): bytes that match the published hash but are
    not JSON, not the schema, of a schema version this build does not read, or
    over 256 KiB, or not UTF-8 (judged only once their hash matches); a url
    without a hash; a processor `error` of `too-large`, `empty` or
    `not-a-file`. A rejection is not a pass error, so one bad file never stops the
    sync from skipping unchanged ticks. A build that makes valid any file it
    rejected before (a schema version added, a limit raised, a rule relaxed)
    raises `SYNC_GATE_VERSION`, so those files are read again.

**Confirmed removal.** The credits fields are removed only when all of these
hold: every enabled server answered this run; no server publishes a `url` or an
`error` for the title (or episode); every server that has the title (or
episode) publishes `absent`; and the server syncing is one of them. A processor
that predates this contract publishes no `credits` key and so can never confirm
an absence. With a server missing from the run, the removal is held back and
the gate stays open.

An admin lock on `credits` keeps it as stored.

## 6. Library scope

The library file credits shared assets no title folder holds: the site's
poster collage (`poster_collage.jpg` at the library root) and anything like
it. It is a version 1 file like any other: its `path`s are relative to the
library root, `derivedFrom` names the inputs (each poster in the collage),
and each contributing work keeps its own entry, license, source, changes
and exclusions; never one blanket entry for the whole asset. It may not use
`suppress` or `replaces`.

Each media server has its own library root, so each server's file is its
own: it is stored per server (`Media.LibraryCredits`, `_id` = the server's
id), owned by that server alone, and never ranked against another server's.
The rules of section 5 apply with that server as the only claimant:

- a new, valid file is stored with `creditsSource` and `creditsHash`;
- a failure keeps the last valid credits and records `creditsStatus`; one
  that may clear by itself is an error of the run, so the pass is not
  recorded and the next tick runs again, and a rejected file waits for an
  edit (which moves the manifests);
- the credits are removed only on that server's own `absent`; a processor
  without a `library` key changes nothing (not even a recorded failure). An
  empty library root (an unmounted share) is `unreadable`, never `absent`.

Shown, the enabled servers' library credits are listed in server priority
order, a file two servers share once (`scope: "library"`).

**The collage follows its credits.** When the library file has an asset with
`"path": "poster_collage.jpg"`, the processor builds the collage from exactly
the inputs its `derivedFrom` names, so a title added to the library never
slips into a collage its credits do not cover. If the file cannot be read,
names no inputs, or names one that is missing, the collage is not rebuilt and
the existing one is kept. `POSTER_COLLAGE_ENABLED=false` on the processor
stops rebuilding it altogether, freezing a verified collage.

## 7. API

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

`GET /api/authenticated/credits/availability` says whether to show the
**Credits & licenses** menu item, and nothing more, so a client never reads
the catalog to decide:

```json
{ "available": true, "library": true, "titles": 4 }
```

`GET /api/authenticated/credits` is what the menu item opens:

```json
{
  "library": { "schemaVersion": 1, "entries": [ { "id": "...", "scope": "library", "assets": [], "work": "..." } ] },
  "titles": [
    { "type": "movie", "id": "<_id>", "title": "Example film", "originalTitle": "Example Film (2020)" },
    { "type": "tv", "id": "<_id>", "title": "Example show", "originalTitle": "Example Show",
      "hasCredits": false,
      "episodes": [ { "seasonNumber": 1, "episodeNumber": 3, "title": "Example episode" } ] }
  ]
}
```

- `library` is the library's credits resolved for display (section 6), or
  null. `titles` names, by display title, every movie and show the user may
  see that has credits to show: its own, or (for a show) any of its
  episodes' own. `hasCredits` says whether a show has its own; `episodes`
  lists those with their own, so episode-only credits can be reached. The
  credits themselves stay on each title's page.
- Only what credits can be shown counts: a stored, valid file with at least
  one entry. The last valid credits kept through a failed sync count; a
  record that holds only a failure does not. Inherited credits are their
  show's, so the show is listed.
- Titles the lists hide (not web-visible) are left out. A user with limited
  access sees no titles, so gets `titles: []` and a `titles` count of 0: the
  library only.
- Both answer 500 when the read fails. A client keeps what it last had and
  never reads an error as "no credits".

## 8. Showing credits

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

**The menu item and its page.** Every client shows **Credits & licenses** in
its existing account or settings menu when `availability.available` is true,
and hides it otherwise (and while it has never had an answer). It opens a
page with the library's credits in full, when there are any, then the list
of titles, each linking to that title's credits panel; a show without
credits of its own links to its credited episodes. Title credits are not
repeated there. On the web: the account menu, `/list/credits`, and each
title's panel at `#credits`. Admins see a failing library sync on that page;
a title's sync state is in its admin editor.

## 9. Rollout

1. Deploy the processor (credits published) and the frontend (credits stored,
   API, web panel, page and menu item) in either order: the frontend's
   `SYNC_GATE_VERSION` 4 makes its first pass after deploy a full one.
2. Ship the native clients' panel, menu item and page (the TV app hand-off
   doc).
3. Write the sidecars from the verified credits: the title and episode files,
   checked against the private rights ledger's media hashes first, and the
   library file only once the processor publishing it is deployed (then
   confirm a scheduled scan published it: both manifests carry
   `library.credits` with its hash). The ledger never goes inside the served
   library.
4. Once the credits show in every client, remove the attribution blocks that
   were appended to overviews, and their manual overrides. Keep the synopsis,
   the full credits, the source records and the original video notices.
   Confirm through a scheduled scan and sync.
