@AGENTS.md

# CLAUDE.md

The canonical repository-wide engineering rules are imported above from
[AGENTS.md](AGENTS.md) — the same file Codex and GitHub Copilot read. Do not add
a global rule here. Add it to `AGENTS.md`, and it reaches all three agents.

This file holds only what is specific to Claude Code.

## Where the project truth moved

Architecture, the sync system, dual-title semantics, field-level priority,
dependency hold notes and the knip configuration decisions now live in
[ARCHITECTURE.md](ARCHITECTURE.md). Read it before changing anything under
`src/utils/sync/` or `src/utils/flatSync/`.

Several source comments cite "per CLAUDE.md" for the rule that `originalTitle`
is the filesystem key and the database key —
`src/utils/flatSync/initializeDatabase.js`,
`src/utils/sync/infrastructure/database/MovieRepository.ts`,
`src/utils/sync/infrastructure/database/TVShowRepository.ts` and
`src/utils/admin/flatMediaActions.js`. That rule is intact; it is now stated in
`ARCHITECTURE.md`, which this file points at. `FIELD_ABSENCE_CLEANUP_DESIGN.md`
cites "per project rule (CLAUDE.md)" for the no-defaulting-through-errors rule,
which is now in `AGENTS.md`, imported above.

## Claude Code specifics

- Prefer plan mode for changes under `src/utils/sync/` and
  `src/utils/flatSync/`. The domain-driven sync path has a single write
  chokepoint per entity and a field-level priority system that is easy to bypass
  by accident. The legacy flat-sync fallback has no such chokepoint, so check it
  separately.
- `.claude*/` is gitignored, so `.claude/rules/` cannot be committed and shared.
  Rules that the team needs belong in `AGENTS.md`.
- Imports are expanded at launch and count against context, so keep this file
  short and let `AGENTS.md` carry the rules.
