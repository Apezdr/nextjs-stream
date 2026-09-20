# Instant navigation

How this app makes a click feel immediate, the rules that keep it that way, and how to check that a change has not broken it. It assumes you know the App Router; it does not assume you know this app's history.

The Next.js side of this is documented in the docs bundled with the installed version: `node_modules/next/dist/docs/01-app/02-guides/` (`adopting-partial-prefetching.md`, `optimizing-prefetching.md`, `instant-navigation.md`). Read those for the framework's behaviour. This file is about what this app does with it.

## The idea in one paragraph

`partialPrefetching: true` (in `next.config.js`, with `cacheComponents: true`). Every route has one prerendered **shell**: whatever the route can render without knowing the URL's params, the search params, or who is signed in. A `<Link>` prefetches its route's shell once, shared by every link to that route, so a click can paint the shell with no request. In this app the shell of a page is its **skeleton**. A link that needs more than the skeleton asks for a **full prefetch**, which also resolves that link's own cached content at the cost of one server render per link.

## The four rules

Each of these was learned by measuring an empty shell and finding the cause.

**1. A layout or page body must not `await` anything request-specific.**
Whatever a layout or page awaits at its top level is absent from the shell, along with everything beneath it. One `await connection()` at the top of `src/app/(styled)/layout.js` once made every route's shell empty; the `list/tv/` and `list/movie/` layouts did the same by awaiting the session. Read the session, `params`, `searchParams`, `headers()`, `cookies()` and `connection()` in a child component **inside a `<Suspense>` boundary**. The Docker image is built without its environment, so anything read from `process.env` for rendering also belongs behind `connection()` in such a child (see `Backdrops` and `CastBootstrapFromEnv` in that layout).

**2. No URL-reading hook in a provider, or in any client component that is not inside its own `<Suspense>`.**
`usePathname()`, `useParams()` and `useSearchParams()` suspend during prerender on every route that has URL params. `NavigationProvider` and the Cast session bar both wrap or sit beside the whole app, and each read the pathname unwrapped: every route with a param had an empty shell until those reads moved into a small child with its own boundary (`PathnameWatcher` in `src/contexts/NavigationContext.tsx`). A fallback that suspends takes its parent boundary down with it, so give a fallback that reads the pathname its own boundary too (see `list/layout.js`).

**3. The page's fallback is its skeleton, and the skeleton mirrors the page.**
`<Suspense fallback={<XPageSkeleton />}>` directly in the page component, around the component that does the awaiting. The skeletons live beside the pages they mirror (`src/components/MediaPages/details/*PageSkeleton.js`, `MediaListPageSkeleton.js`, `MediaPlayer/PlayerPageSkeleton.js`); tests pin their frame and grid classes to the real component so the two cannot drift apart silently. Server-rendered markup must be visible without JavaScript: never wrap it in a framer-motion element with `initial="hidden"`, which is server-rendered at `opacity: 0` and stays invisible until hydration. Use the CSS animations in `tailwind.config.js` (`animate-page-enter`, `animate-rise-in`).

**4. Let the `<Link>` navigate.**
`router.push()` only ever has the route shell; it does not use what a `<Link prefetch>` fetched. The hover card once called `preventDefault()` and `router.push(href)`, and the same click that lands fully rendered through the link landed on a skeleton. Put side effects in `onClick` and let the link do the navigating. `router.prefetch()` has no full-prefetch option either, which is why the season `<select>` can show the next season's skeleton at once but not its content.

## Which link prefetches what

| Link | Prefetch | Why |
| --- | --- | --- |
| Previous / next episode cards, banner "View Details", hover card "View Details" | `prefetch={true}` (full, on sight) | One or two such links exist at a time |
| Grid posters, season tiles, episode rows, trail and back links, "All N episodes", a collection's film tiles | `IntentPrefetchLink` (full, on intent) | Many per page; a full prefetch is a server render per link |
| Everything else | default (the route shell) | The skeleton is enough, or the destination has nothing cacheable to add |

`IntentPrefetchLink` (`src/components/MediaPages/IntentPrefetchLink.js`) stays on the default until the pointer rests on it for 120 ms, or it is focused or touched, and then asks for the full prefetch. The dwell matters: a pointer crossing an episode list passes over every row.

A full prefetch can only carry content that has a cache lifetime of at least 30 seconds; it stops at the first uncached read. That is why `SessionGate` reads the session through `'use cache: private'` with a 30 second lifetime. Nothing is stored on the server: every request, prefetches included, checks the session against the database again. Only the browser may reuse, for 30 seconds, output it was already sent. Content needs 5 minutes to be part of the shared shell, which is why the navigation bar (it depends on the session) is never in one.

## Sign-out

`hardNavigate()` (`src/utils/hardNavigate.js`), never `router.push()`. A client navigation keeps everything the browser holds: the pages Next keeps mounted but hidden, the router's cached and prefetched output, SWR responses. After a `router.push('/')` on sign-out, Back re-showed the previous member page without a request. A full load drops all of it, and member pages are served `no-store`, so the browser's own back/forward cache cannot restore them either (verified: Back makes a signed-out request and gets the sign-in page). `__tests__/components/signOut.test.js` fails for any `authClient.signOut()` whose success handler uses the router.

## How to check a change

- **Is the shell real?** `npm run build`, then look at `.next/server/app/<route>.html`. An empty shell is about 3–5 KB with no text; a real one contains the skeleton (`grep -c animate-pulse`).
- **What does a click have ready?** `e2e/prefetch-preservation.spec.js`, run against a production build (Next does not prefetch in `next dev`). Inside `instant()` the page is held at its prefetched UI. `instant-nav.rig.md` has the commands, the sign-in step and the known obstacles. The suite signs in as a real account against the real database; `e2e/fixtures.js` refuses every write so it cannot change anything.
- **Does the router still behave?** `e2e/navigation-stability.spec.js`: sixteen unsettled back/forward steps followed by a click that must still navigate, and scroll retention when stepping episodes. This is the test to run before changing `staleTimes` or `experimental.cachedNavigations`.
- **Development-only insights.** With the flag on, `next dev` reports a route whose shell is tied to URL data. Drive real link clicks and read the dev log; `instant-nav.rig.md` explains the `no-cache` header trap that hides them.

## Known limits

- The season selector is a `<select>` driven by `router.push()`, so switching seasons shows the skeleton first. Making it fully instant means real links in its place, which is a design decision, not a fix.
- In-view reveals inside page content (`PageContentAnimatePresence`) are still framer-motion and still server-rendered hidden. They sit inside content that replaces a visible skeleton, so a slow device shows the skeleton, then a brief gap until hydration, then the cards. The root template and the landing page, which hid entire pages, are fixed.
- Admin pages have spinner-only shells and their sub-pages have not been swept for development insights.
