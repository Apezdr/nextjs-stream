# AGENTS.md — nextjs-stream

Canonical repository-wide engineering instructions. Every coding agent working
in this repository follows this file.

| Agent | How it receives this file |
| --- | --- |
| OpenAI Codex | Natively — `AGENTS.md` is its project instruction file |
| GitHub Copilot | Natively in VS Code and on github.com |
| Claude Code | Through the `@AGENTS.md` import at the top of `CLAUDE.md` |

**Global rules are edited here and nowhere else.** `CLAUDE.md` and
`.github/copilot-instructions.md` carry vendor-specific notes only and must
never restate a rule from this file.

## Where deeper truth lives

Read the linked document when the work touches its subject. These are required
reading, not background.

| Document | Read it before |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | **Any change under `src/utils/sync/` or `src/utils/flatSync/`**, and any work on the stack, layout, dual-title or field-priority rules |
| [README.md](README.md) | Self-hosting setup, and any environment-variable change |
| [plans/media-activity-api.md](plans/media-activity-api.md) | Media Activity endpoints, session XML shape, skin request budget |
| [plans/media-activity-presence.md](plans/media-activity-presence.md) | `PlaybackPresence`, heartbeat cadence, read windows |
| [plans/media-activity-presence-rn-integration.md](plans/media-activity-presence-rn-integration.md) | The contract the React Native app implements |
| [USER_APPROVAL_SYSTEM.md](USER_APPROVAL_SYSTEM.md), [ACCOUNT_DELETION_SYSTEM.md](ACCOUNT_DELETION_SYSTEM.md), [NOTIFICATION_FRAMEWORK_DESIGN.md](NOTIFICATION_FRAMEWORK_DESIGN.md) | The subsystems they name |
| `docs/api/*.md` | The endpoints they document |

## Never destroy existing work

Treat every pre-existing change in the working tree — staged, unstaged or
untracked — as user work.

Before editing, inspect:

```
git status --short
git branch --show-current
git diff --stat
```

- Never run a destructive git command on your own initiative: no
  `reset --hard`, `clean -fd`, `restore .`, `checkout -- .`, `rebase`,
  `commit --amend`, `push`, or `push --force`.
- Do not fetch, pull, merge or rebase merely to "get current".
- Do not modify, revert, stash or reformat files unrelated to your task.
- If untracked work is in the way, commit it verbatim to a `snapshot/*` branch
  first so nothing can be lost. Never delete it.

## Work on a feature branch, never a single long-lived one

Every change belongs on a branch scoped to one feature or one fix. Do not
accumulate unrelated work on one branch, and do not commit straight to `main`
or to a long-running `integration/*` branch.

This is not style preference. When a regression appears, the first question is
*which change introduced it*. A branch per concern makes that answerable by
reading a handful of commits; a single branch carrying dozens of unrelated
changes makes it a bisect through hundreds of files.

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

## Keep diffs surgical

Make the smallest complete change. No drive-by refactoring, formatting, import
reordering, renaming, cleanup or dependency upgrades. Every file in the final
diff must belong to the requested concern.

## Verification commands can mutate this repository

Read a script's definition before running it. Do not assume a command named
lint, fix, analyse or check is read-only.

| Command | Safe? |
| --- | --- |
| `npm run knip` | Read-only analysis |
| `npx jest __tests__/<dir>` | Read-only |
| `npm run lint` | **Writes.** It is `eslint --fix .` across the whole repository |
| `npm run knip:fix` | **Writes.** `knip --fix` deletes code |
| `npx lint-staged` | **Writes.** Runs `prettier --write`, including on Markdown |
| `scripts/remove-dead-functions.mjs` | **Never run it automatically** — see below |

Prefer a targeted read-only check. Never use a repository-wide fixer as
"harmless verification" while unrelated changes are present. After any command
that may write, re-inspect the working tree and account for every changed path.

## Evidence outranks documentation

Documentation goes stale. When a document and the repository disagree, verify
the behaviour and follow the evidence:

- Source code is authoritative for implemented behaviour.
- `package.json` and the lockfile are authoritative for dependency declarations.
- Tests and observed runtime behaviour are authoritative for what actually
  happens.

Do not implement an outdated documented dependency or architecture when the
repository proves otherwise. Correct the current-state document in the same
change.

### Documentation must stay current

Treat docs as part of the change, not follow-up work. When a change alters
behaviour a document describes, update that document in the same change.

Authoritative docs — these describe how the system works **today** and must be
correct at all times:

| Document | Covers |
| --- | --- |
| `AGENTS.md` | Global engineering rules for every agent |
| `ARCHITECTURE.md` | Stack, commands, layout, sync architecture, knip config decisions |
| `README.md` | Self-hosting setup and the full environment variable list |
| `plans/media-activity-api.md` | Media Activity endpoints, session XML shape, skin request budget |
| `plans/media-activity-presence.md` | `PlaybackPresence` collection, heartbeat cadences, read windows |
| `plans/media-activity-presence-rn-integration.md` | The contract the React Native app implements |
| `docs/api/*.md` | Individual endpoint contracts |
| `USER_APPROVAL_SYSTEM.md`, `ACCOUNT_DELETION_SYSTEM.md`, `NOTIFICATION_FRAMEWORK_DESIGN.md` | The subsystems they name |

Point-in-time records — **do not** rewrite these to match current code. They
record what was decided and when, and their value is that they are not edited
after the fact:

- `SYNC_ARCHITECTURE_MIGRATION.md`
- `FIELD_ABSENCE_CLEANUP_DESIGN.md`
- `plans/migration-review-findings.md`
- `plans/bearer-token-migration.md`
- `scripts/PRODUCTION_MIGRATION_GUIDE.md`
- Any `plans/*` or `docs/**/plans|specs/*` document not listed as authoritative
  above — treat it as point-in-time unless its own text says it tracks current
  behaviour

If a point-in-time doc is actively misleading, add a short dated note at the top
rather than editing the body.

Specific things that go stale and are worth re-checking when you touch them:
version numbers and library names in `ARCHITECTURE.md`, the env var list in
`README.md`, and any example URL or port.

## Verify before deleting

This codebase has real dead code, and it has also lost working code to
over-eager cleanup. Both failure modes are expensive, so the bar is evidence,
not intuition.

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

### knip — the danger zone

`npm run knip` is read-only analysis and is safe. **`scripts/remove-dead-functions.mjs`
must never be run automatically or as part of a pipeline.** It physically
deletes source files and strips `export` keywords based on knip's output, and it
caused an incident that took hours to recover from:

- 50+ source files deleted (Admin/SubtitleEditor, Admin/Integrations,
  MediaPages/CastSection, watchHistory/server.ts and more)
- `export` stripped from `useUnreadCount()` in `src/hooks/useNotifications.js`,
  breaking the build
- dynamically-imported components removed because knip cannot trace them

Static analysis gets this wrong here because `next/dynamic()` and `React.lazy()`
take dynamic `import()` strings, cross-package peer dependencies look
"unlisted", and re-exports used only in certain runtime contexts look dead.

If knip reports something as unused: manually verify it is not reached via
`import()`, `React.lazy()`, `next/dynamic()` or runtime injection; check git
history; and delete only after confirming it is unreferenced in **all** code
paths.

Recovery, if files were deleted (PowerShell) — for deliberate incident recovery
only, after confirming each deletion was accidental:

```powershell
git diff --name-only --diff-filter=D HEAD src/ | ForEach-Object { git restore $_ }
git --no-pager diff --name-only --diff-filter=D HEAD src/
```

## Interfaces are contracts

Treat these as compatibility-sensitive: API routes, HTTP methods, status codes,
JSON fields, XML elements and attributes, XML **ordering** where external
consumers rely on it, authentication behaviour, environment variables, webhook
shapes, database fields, content types, cache behaviour and metadata structures.

Identify the internal and external consumers before changing one. Prefer
additive, backward-compatible changes. Do not remove, rename, retype or reorder
a contract field without a compatibility and rollback plan. Update the
authoritative contract document in the same change.

### Media Activity: add attributes, not endpoints

The desktop skin polls `/api/media-activity/xml/status/sessions` once a second
and parses every field it renders out of that one cached response.

When a client needs a new value, add an attribute to that existing response.
Do not add an endpoint, and do not have a client make a second request for
something the session XML already carries. `plans/media-activity-api.md`
documents the current request budget — keep it accurate.

Each `/status/sessions` request runs several MongoDB queries, so anything that
increases its rate or its per-request work is a real cost on a server that is
already busy.

## Durable data changes need upgrade and rollback thinking

For persisted MongoDB data:

- Readers must tolerate old documents. Prefer additive fields.
- Distinguish a missing field from a valid empty value.
- Avoid destructive migrations. Do not drop a field until deployed readers no
  longer need it and the rollback window has closed.
- Make migrations and backfills idempotent and resumable, and consider what an
  interrupted run leaves behind.
- Never run a production migration automatically. Require explicit operator
  action and state preconditions, scope and rollback steps.

## Do not invent data

Missing, unknown, empty and unavailable are different states. Do not collapse
them.

Do not fabricate metadata, classifications, filesystem paths, IDs, URLs or
ownership so that execution can continue. Validate required inputs, then either
preserve an explicit absence state or fail with an actionable error. This
applies with particular force in the sync path: **do not default a value to get
past an error.** The sync system must rely on data properly passed through the
functions, not on substitutes invented at the point of failure.

## Authentication and secrets are trust boundaries

- Before adding or changing a route, classify it as `public`, `authenticated`,
  `admin-only` or `service-to-service`; enforce that classification server-side
  at the route boundary, and test both an allowed and a denied request. A
  pathname is not an authorization control — `/api/authenticated/` is a naming
  convention, and the admin route accepts a webhook credential in place of a
  session.
- Never expose or log passwords, tokens, session cookies, `Authorization`
  headers, webhook secrets, database connection strings or provider
  credentials.
- Never move a secret into `NEXT_PUBLIC_*`, a client bundle, committed
  documentation or a test fixture. Use an obviously non-functional placeholder.

## Avoid N+1 work

Before putting a database, Redis, filesystem or external API call inside a loop,
a render path, a per-item map or a high-frequency polling path, calculate the
realistic call count. Prefer batching, caching, bulk operations, precomputed
data and comprehensive responses. Respect documented request budgets.

## Dependencies require justification

Do not run `npm update`, `npm audit fix`, `npm audit fix --force` or
`npm install <package>@latest` on your own initiative, and do not upgrade
unrelated packages. Prefer existing dependencies and platform capabilities.
Pins are deliberate — see the knip section of `ARCHITECTURE.md` before changing
one.

## Tests are evidence

Never delete, skip, loosen or rewrite a test to make an implementation pass. For
a bug fix, add regression coverage when practical. Distinguish new regressions
from pre-existing failures and from checks you did not run. **Never say a check
passed unless it actually ran and succeeded.**

## Finish with an auditable report

Inspect the final diff before claiming completion, then report: current branch,
commits created, files changed and why, tests run, lint or static analysis run,
build result, pre-existing failures, checks not performed, and remaining risk.
Do not claim verification you did not perform.

## Repository facts

- Path aliases are `@src/*` and `@components/*`.
- Tests are Jest, under `__tests__/`. Run a subset with
  `npx jest __tests__/<dir>`.
- `src/utils/mediaActivity.js` reads `FlatEpisodes.size` and `Movies.size`
  directly as bytes and performs **no** unit conversion. The stored unit is not
  consistent — historically most episode documents hold KiB while movies hold
  bytes — so size and bitrate derived from legacy episode documents can be off
  by a factor of 1024. Verify the unit before relying on it, and do not assume
  any read path normalizes it.
- `docs/` is gitignored. `docs/api/genres-endpoint.md` is tracked because it
  predates the rule; a new file under `docs/` needs `git add -f` or it will
  silently never be committed.
- The deployment topology (containers, ports, compose file) lives in the
  separate `Adams-Media-Server` folder, which is not part of this repository.
- Do not point `npx @next/codemod agents-md` at `AGENTS.md` or `CLAUDE.md`. It
  overwrites the file with a generated Next.js documentation index. A previous
  run left both files carrying a 7.9 KB index of a `.next-docs` directory that
  does not exist in this repository.
