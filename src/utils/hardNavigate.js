/**
 * Leave the current page with a full document load, not a client navigation.
 *
 * Use this when what the browser is holding must not survive the move, and
 * above all after sign-out. A client navigation (router.push, <Link>) keeps
 * everything in memory: Next keeps the pages you navigated away from mounted
 * but hidden, the router keeps prefetched and cached page output, and SWR keeps
 * its responses. After a router.push('/') on sign-out, pressing Back re-showed
 * the previous member page, content and all, without a single request
 * (measured: every request from then on was signed out and the episode page
 * still came back). That state has no expiry; only a document load drops it.
 *
 * Everywhere else, prefer <Link> or router.push: a full load throws away the
 * prefetching and preserved state that make navigation fast. That is also why
 * eslint's @next/next/no-location-assign-relative-destination exists; this
 * helper is the deliberate exception to it.
 *
 * @param {string} href - where to go; an internal path such as '/'
 */
export function hardNavigate(href) {
  window.location.assign(href)
}
