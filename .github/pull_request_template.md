# Pull request

## Summary

<!-- What changed and why. Keep it specific enough that a reviewer can jump to the right files. -->

## Validation

<!-- Only tick a box for a command you actually ran. Never claim a check that did not run. -->

- [ ] `npm test -- --runInBand`
- [ ] `npm run build`
- [ ] ESLint on the changed files

## Performance

**Required on every pull request.** Measure this branch against its merge base and record the numbers.

| Metric | Base (`main` @ ______) | This branch (______) | Delta |
| --- | --- | --- | --- |
| Client JS shipped (`.next/static`) | | | |
| Server bundle (`.next/server`) | | | |
| Static assets (`public/`) | | | |
| Cold build | | | |
| Jest suite | | | |

How to produce these numbers, run once on the base commit and once on the branch:

```powershell
# In a worktree pinned to the commit being measured
Remove-Item -Recurse -Force .next -ErrorAction SilentlyContinue
npm run build
(Get-ChildItem .next/static -Recurse -File | Measure-Object Length -Sum).Sum
(Get-ChildItem .next/server -Recurse -File | Measure-Object Length -Sum).Sum
(Get-ChildItem public -Recurse -File | Measure-Object Length -Sum).Sum
```

Two things worth knowing before you interpret the result:

- Bundle sizes are **deterministic** for a given commit. Building the same commit twice produces a byte-identical total, so any non-zero delta is real signal.
- Build and test wall-times swing by roughly 10% on a loaded machine. Report them, but do not read a small difference as a speed-up or a regression.
- Assets in `public/` never appear in `.next/static`. A change that adds images or icons shows up only in the `public/` row, so do not skip it.

If the change adds background work (timers, polling, child processes) or touches a hot request path, also record runtime cost:

1. Build the base and the branch into two images from the **same** Dockerfile.
2. Run both with the **same** environment variables on the same host.
3. **Restart both immediately before sampling** so neither has a warm-heap advantage — skipping this is the single easiest way to produce a wildly wrong memory number.
4. Sample `docker stats` while both are idle, and measure response times for the affected routes.

Write "no performance impact expected" only together with the reason it is expected. Absence of a measurement is not evidence of absence of a cost.

## Documentation

<!-- Which authoritative documents changed, or a verified reason none were affected. -->
