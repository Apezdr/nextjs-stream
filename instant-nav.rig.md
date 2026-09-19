# instant-nav rig: nextjs-stream

How to run the instant-navigation specs in `e2e/`. They check what a link has
ready before the click, which only a production build can show: Next does not
prefetch in `next dev`.

- BUILD: `npm run e2e:build` (= `next build` with `EXPOSE_TESTING_API=1`), then
  `npm run e2e:start` (= `next start -p 3233`). Port 3233 so it never collides
  with the dev server on 3232. Stop whatever is listening on 3233 before a new
  build; `next start` forks a child, so stop by port, not by launcher PID.
- EXPOSE: `EXPOSE_TESTING_API=1` at BUILD time turns on
  `experimental.exposeTestingApiInProductionBuild` in `next.config.js`. Setting
  it only for `next start` does nothing. Real builds (Dockerfile) never set it.
- RUN: `npm run e2e` (= `playwright test`, config in `playwright.config.js`).
  `BASE_URL` overrides the default `http://localhost:3233`. First run on a
  machine: `npx playwright install chromium`.
- TEST USER: a real, approved, full-access account, signed in through the device
  flow: `npm run e2e:login` prints a `/device?user_code=…` address; approve it in
  a browser where you are signed in. The session token lands in `e2e/.auth/token`
  (gitignored) and `e2e/fixtures.js` sends it as a bearer token to the app's own
  origin only. State that changes the UI: the account must be approved and must
  not be limited-access (limited-access accounts get trailers, not info pages).
- DRIFT: the library is live data. Specs read titles from the page instead of
  naming them, but they need at least one TV show, one movie, and a banner item
  on `/list`. An empty or syncing library fails for that reason, not because a
  prefetch changed.
- CONTRACTS (each has its own test in `e2e/prefetch-preservation.spec.js`):
  - TV grid card (`TVListClient`) -> `/list/tv/[title]`: page heading ready.
  - Movie grid card (`MovieListClient`) -> `/list/movie/[title]`: page heading ready.
  - Banner "View Details" (`BannerContent`) -> `/list/movie/[title]`: page heading ready.
  - Hover card "View Details" (`PopupCard/InfoSection`) -> `/list/{type}/[title]`:
    page heading ready. NOT WRITTEN YET (`test.fixme`): needs the rig running to
    find a stable way to open the card.
  - "View media catalog" (`ViewCatalogButton`, on `/`) -> `/list`: site navigation ready.
  - `MediaPages/Item/SeasonItem.js` also forces a prefetch but nothing renders
    it any more, so it has no contract.
- LOOP: local. build -> start -> login (once per token lifetime) -> `npm run e2e`
  -> stop the server -> edit -> repeat. Agent limits: the agent cannot approve
  the device code; a person has to open the printed address once.
- LIVENESS: n/a; local build and start.
- WALLS:
  - The app needs its MongoDB (from `.env.local`) for every page, including
    public ones. With the database down, pages hang and the device flow
    returns 500. Start the database first.
  - `next start` warns that it "does not work with output: standalone". It
    does serve the build; the warning is about the Docker artifact.
  - Install with plain `npm install`. `--legacy-peer-deps` prunes peer packages
    the lockfile carries and breaks the jest suites.
