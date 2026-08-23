# GitHub Copilot — repository instructions

**Read [AGENTS.md](../AGENTS.md) at the repository root and follow it.** It is
the canonical set of engineering rules for this repository and it applies to
every Copilot request here.

This file exists only because VS Code applies `.github/copilot-instructions.md`
unconditionally, whereas `AGENTS.md` is gated behind the `chat.useAgentsMdFile`
setting. If that setting is disabled, this file is what tells you to go read the
rules. Nothing else belongs here.

Do not copy rules from `AGENTS.md` into this file. A rule that exists in two
places drifts.

## Copilot-specific notes

- VS Code combines `AGENTS.md`, `CLAUDE.md` and this file into every request
  with no guaranteed ordering, so all three are deliberately kept small and
  non-overlapping. `CLAUDE.md` is a loader for Claude Code, not a second
  rulebook.
- Path-specific rules would go in `.github/instructions/*.instructions.md` with
  an `applyTo` glob. None exist today, and one should only be added for a rule
  that genuinely applies to a subset of files — note that Codex and Claude Code
  do not read that directory, so a rule placed there reaches Copilot only.
- Nested `AGENTS.md` files are not used in this repository. On github.com the
  nearest file in the tree wins, so a nested file would *replace* the root rules
  for everything beneath it rather than add to them.
