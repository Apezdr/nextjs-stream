# instant-nav rig: nextjs-stream

How to run the instant-navigation specs in `e2e/`. They check what a link has
ready before the click, which only a production build can show: Next does not
prefetch in `next dev`.

- BUILD: `npm run e2e:build` (= `next build` with `EXPOSE_TESTING_API=1`), then
  `npm run e2e:start` (= `next start -p 3232`). It takes the DEV server's port
  on purpose: sign-in only works on https://cinema-local.adamdrumm.com, which
  proxies to 3232, so stop the dev server first. Stop whatever is listening on
  3232 before a new build; `next start` forks a child, so stop by port, not by launcher PID.
- EXPOSE: `EXPOSE_TESTING_API=1` at BUILD time turns on
  `experimental.exposeTestingApiInProductionBuild` in `next.config.js`. Setting
  it only for `next start` does nothing. Real builds (Dockerfile) never set it.
- RUN: `npm run e2e` (= `playwright test`, config in `playwright.config.js`).
  `BASE_URL` overrides the default `https://cinema-local.adamdrumm.com`. First run on a
  machine: `npx playwright install chromium`.
- TEST USER: a real, approved, full-access account, signed in through the device
  flow: `npm run e2e:login` prints a `/device?user_code=…` address; approve it in
  a browser where you are signed in. The session token lands in `e2e/.auth/token`
  (gitignored) and `e2e/fixtures.js` sends it as a bearer token to the app's own
  origin only, and refuses every write (see the comment there), so the suite
  cannot change the account it runs as. Delete the token and sign that session
  out when you are done: it is a full 30-day session for a real account.
  State that changes the UI: the account must be approved and must
  not be limited-access (limited-access accounts get trailers, not info pages).
- DRIFT: the library is live data. Specs read titles from the page instead of
  naming them, but they need at least one TV show, one movie, and a banner item
  on `/list`. An empty or syncing library fails for that reason, not because a
  prefetch changed.
- CONTRACTS (each has its own test in `e2e/prefetch-preservation.spec.js`; the rules
  behind them are in `INSTANT_NAVIGATION.md`):
  - Full prefetch on intent (`IntentPrefetchLink`; the test rests the pointer on
    the link and waits for its full prefetch): TV grid card -> show page, movie
    grid card -> movie page, season tile -> season page. Page heading ready; for
    the season, an episode row too.
  - Full prefetch on sight (`prefetch={true}`): banner "View Details" -> movie
    page, hover card "View Details" -> details page, next-episode card -> the
    next episode (its title parts and its link back to the previous episode).
  - Default link, route shell only: "View media catalog" -> `/list` has the
    catalog skeleton; Play -> the player frame (`role=status`, "Loading player").
    The navigation bar is never part of a shell: it needs the session, cached
    30 s, under the 5 min the shared shell requires.
  - The HTML the server sends for `/` and `/list` has no `<main>` at opacity 0.
  - `e2e/navigation-stability.spec.js`: sixteen unsettled back/forward steps then
    a click that must still navigate; scroll retained when stepping episodes.
  - History: 2026-09-19 baseline with Partial Prefetching off, Next 16.3.5:
    3 passed (TV card, movie card, banner). After adoption and the global flag:
    8 passed. 2026-09-20, with page shells for the player, watchlist,
    notifications and collections, intent prefetch on in-page links, the CSS
    page fade, and `cachedNavigations` on: 12 passed, and the two stability
    specs 16/16 over eight repeats.
- LOOP: local. build -> start -> login (once per token lifetime) -> `npm run e2e`
  -> stop the server -> edit -> repeat. Agent limits: the agent cannot approve
  the device code; a person has to open the printed address once.
- LIVENESS: n/a; local build and start.
- DEV SWEEP (the insights only appear in `next dev`): drive real link clicks
  and read the dev log for "Next.js encountered" lines. If Playwright intercepts
  requests, DELETE the `cache-control` and `pragma` headers before continuing
  them: interception makes Chromium send `no-cache`, and the dev server turns
  its caches off for such requests ("rendering with server caches disabled"),
  which hides what is and is not prefetchable. Last sweep 2026-09-19, flag on:
  browse, show, season, episode, player, movie, /list, /, watchlist,
  notifications, privacy, device, admin home: no insights. Admin sub-pages
  were not walked.
- WALLS:
  - In dev the mock system-status banner is fixed over the navigation bar and
    swallows clicks on it. Click in-page links (trail, cards), or use goto.
  - Click only after the network settles (`settle()` in the spec). A held
    navigation with no finished prefetch never commits and the test times out,
    which looks like a lost prefetch but is only a fast click.
  - The app needs its MongoDB (from `.env.local`) for every page, including
    public ones. With the database down, pages hang and the device flow
    returns 500. Start the database first.
  - `next start` warns that it "does not work with output: standalone". It
    does serve the build; the warning is about the Docker artifact.
  - Install with plain `npm install`. `--legacy-peer-deps` prunes peer packages
    the lockfile carries and breaks the jest suites.
