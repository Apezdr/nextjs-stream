# Pull request validation

[`pr-validation.yml`](workflows/pr-validation.yml) validates pull requests to
`main`, merge-queue commits, pushes to `main`, and manual runs. The workflow
uses Node.js 26 to match the production Docker image and exposes one stable
branch-protection check: `Pull Request CI / Required checks`.

## Required checks

- **Policy and workflow syntax** verifies actionlint's checksum, lints workflow
  YAML and shell, requires immutable action commits, rejects privileged or
  secret-bearing pull-request jobs, and allowlists dependency install scripts.
- **Application validation** installs with lifecycle scripts disabled, checks
  the reviewed native packages, runs non-mutating ESLint, generates Next.js
  route types, runs TypeScript, executes all Jest tests with whole-source
  coverage, checks dependency declarations with Knip, builds the production
  application, and verifies that none of those commands rewrote tracked files.
- **Dependency review** rejects newly introduced dependencies with high or
  critical known vulnerabilities. It does not post pull-request comments or
  require write permission.
- **Required checks** fails unless every required job succeeded. Require this
  single stable check in branch protection after its first successful run.

GitHub's existing CodeQL setup already analyzes JavaScript/TypeScript on pull
requests, so this workflow does not add a duplicate custom CodeQL upload.
Actionlint and the repository policy checker validate workflow changes.

## Local commands

```text
npm ci --ignore-scripts --no-audit --no-fund
node .github/scripts/validate-ci-policy.mjs
npm run lint:ci
npm run typecheck
npm run test:ci
npm run knip:ci
npm run build
git diff --exit-code
```

The production build uses only inert localhost endpoints and an obviously
non-production authentication placeholder in CI. Pull-request jobs receive no
repository secrets and have read-only repository permission.

## Baselines

- `eslint-suppressions.json` records 30 pre-existing errors in 10 files.
  `lint:ci` also caps the existing warning count at 26, so new violations fail.
  When an existing error is fixed, prune its suppression rather than widening
  the baseline.
- Jest collects coverage from all files under `src/`. The initial global floor
  matches `main`: 2.5% lines/statements, 8% functions and 38% branches. Raise
  these values as route and component coverage improves.
- `knip:ci` blocks dependency, unlisted import, unresolved import, binary and
  catalog issues. Full Knip remains diagnostic because the current tree reports
  many dynamically reached files and exports. Promote the full report only
  after every dynamic consumer has been checked and the baseline is clean.
- Whole-tree `npm audit` is not a pull-request gate because existing advisories
  would keep every run red and registry results can change without a commit.
  Dependency review instead blocks vulnerable additions in the submitted diff.

## Updating tools

Dependabot updates SHA-pinned GitHub Actions weekly. For actionlint, update the
version, archive URL and hard-coded Linux archive SHA-256 together, then run the
new binary locally against `.github/workflows` before merging.