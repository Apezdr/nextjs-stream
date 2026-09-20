/**
 * Anything under /list that no route claims. It answers with the 404 in
 * not-found.js, and that is all it does.
 *
 * Every real address has its own route:
 *   /list                                       list/page.js
 *   /list/movie, /list/tv                       list/movie/page.js, list/tv/page.js
 *   /list/movie/[title] (+ /play)               list/movie/[title]/…
 *   /list/tv/[title]/[season]/[episode] (+ /play), and each level above it
 *   /list/collection/[collectionId]
 * Next matches a static or single-segment dynamic route before a catch-all, so
 * this page only ever sees addresses that fit none of them: /list/foo,
 * /list/movie/x/y, /list/tv/a/b/c/d/e.
 *
 * It used to BE all of those routes: one page that parsed the path, fetched the
 * media and rendered the matching view or player. When the dedicated routes took
 * over, that code became unreachable (its own path check accepted exactly the
 * shapes the dedicated routes now win), but it stayed, looked live, and was
 * still being revalidated. Do not grow this back into a router; add a route.
 */

import { notFound } from 'next/navigation'

export default function UnknownListPath() {
  notFound()
}
