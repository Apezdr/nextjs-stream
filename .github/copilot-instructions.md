# Copilot instructions — nextjs-stream

Architecture, conventions, and the sync-system rules live in [CLAUDE.md](../CLAUDE.md).
Read it before changing anything under `src/utils/sync/` or `src/utils/flatSync/`.
Do not restate its contents here.

## Work on a feature branch, never a single long-lived one

Every change belongs on a branch scoped to one feature or one fix. Do not
accumulate unrelated work on one branch, and do not commit straight to `main`
or to a long-running `integration/*` branch.

This is not style preference. When a regression appears, the first question is
*which change introduced it*. A branch per concern makes that answerable by
reading a handful of commits; a single branch carrying dozens of unrelated
changes makes it a bisect through hundreds of files. Small, scoped branches are
also what let an agent review a coherent diff instead of a mixed one.

| Prefix | Use |
| --- | --- |
| `feat/<slug>` | New capability |
| `fix/<slug>` | Bug fix |
| `chore/<slug>` | Tooling, deps, config, docs-only |
| `integration/<slug>-<date>` | Temporary branch for merging several branches |
| `snapshot/`, `safety/`, `backup/`, `checkpoint/` | Recovery points, never pushed |

Rules:

- Start from the current base branch and branch before writing code, not after.
- One concern per branch. If a change needs an unrelated fix to proceed, that
  fix is its own branch.
- **Commit locally. Do not push, and do not open a pull request, unless asked.**
  `origin` is public; local branches are the working record.
- Keep a branch's commits coherent — a reviewer should be able to read the
  branch and see one story.
- Do not delete `snapshot/*`, `safety/*`, `backup/*` or `checkpoint/*` branches.
  They exist so work can be recovered and are cheap to keep.

If work has already accumulated on one branch, split it before continuing:
commit everything to a `snapshot/*` branch first so nothing can be lost, then
create each feature branch from the base and restore only that feature's paths
out of the snapshot.

## Documentation must stay current

Treat docs as part of the change, not follow-up work. When a change alters
behaviour a document describes, update that document in the same change.

Authoritative docs — these describe how the system works **today** and must be
correct at all times:

| Document | Covers |
| --- | --- |
| `CLAUDE.md` | Stack, commands, directory layout, sync architecture, knip safety rules |
| `README.md` | Self-hosting setup and the full environment variable list |
| `plans/media-activity-api.md` | Media Activity endpoints, session XML shape, skin request budget |
| `plans/media-activity-presence.md` | `PlaybackPresence` collection, heartbeat cadences, read windows |
| `plans/media-activity-presence-rn-integration.md` | The contract the React Native app implements |
| `docs/api/*.md` | Individual endpoint contracts |
| `USER_APPROVAL_SYSTEM.md`, `ACCOUNT_DELETION_SYSTEM.md`, `NOTIFICATION_FRAMEWORK_DESIGN.md` | The subsystems they name |

Point-in-time records — **do not** rewrite these to match current code. They
record what was decided and when, and their value is that they are not edited
after the fact:

- `docs/superpowers/plans/*` and `docs/superpowers/specs/*`
- `docs/plans/*`
- `SYNC_ARCHITECTURE_MIGRATION.md`, `plans/migration-review-findings.md`,
  `plans/bearer-token-migration.md`, `scripts/PRODUCTION_MIGRATION_GUIDE.md`

If a point-in-time doc is actively misleading, add a short dated note at the top
rather than editing the body.

Specific things that go stale and are worth re-checking when you touch them:
version numbers and library names in `CLAUDE.md`, the env var list in
`README.md`, and any example URL or port.

## Verify before deleting

This codebase has real dead code, and it has also lost working code to
over-eager cleanup (see the knip incident in `CLAUDE.md`). Both failure modes
are expensive, so the bar is evidence, not intuition.

Before removing anything, confirm it is unreferenced by **all** of these:

- static imports, and dynamic ones — `next/dynamic()`, `React.lazy()`,
  `import()` with a computed path
- route handlers, which nothing in this repo imports directly
- the Rainmeter skin, which reads the XML API with regexes and is not in this
  repository — grep the skin before changing any attribute in
  `buildSessionXml()`, including its **order**
- the React Native app, which consumes `GET /api/media-activity`

State the evidence in the change description. "knip says it's unused" is not
sufficient on its own.

Prefer deleting the *caller* of dead code over deleting a cheap, documented
endpoint. A route handler that returns a constant and performs no I/O costs
nothing at rest; a client polling it every second does.

## Media Activity: add attributes, not endpoints

The desktop skin polls `/api/media-activity/xml/status/sessions` once a second
and parses every field it renders out of that one cached response.

When a client needs a new value, add an attribute to that existing response.
Do not add an endpoint, and do not have a client make a second request for
something the session XML already carries. `plans/media-activity-api.md`
documents the current request budget — keep it accurate.

Each `/status/sessions` request runs several MongoDB queries, so anything that
increases its rate or its per-request work is a real cost on a server that is
already busy.

## Repository facts

- Path aliases are `@src/*` and `@components/*`.
- Tests are Jest, under `__tests__/`. Run a subset with
  `npx jest __tests__/<dir>`.
- `src/utils/mediaActivity.js` reads `FlatEpisodes.size`, which is stored in KiB
  for nearly every episode but in bytes for movies. It normalizes at read time;
  the stored documents are untouched, so no other read path can assume it.
- The deployment topology (containers, ports, compose file) lives in the
  separate `Adams-Media-Server` folder.
