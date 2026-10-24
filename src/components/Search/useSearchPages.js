'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWRInfinite from 'swr/infinite'

/** The modal asks for the most a page may hold, so paging only starts on broad queries. */
export const SEARCH_PAGE_SIZE = 50
/** How long typing has to pause before the query is sent. */
export const SEARCH_TYPING_DELAY_MS = 600

// Stable empty reference so effects depending on the results don't loop while
// the first page is still loading (a fresh `[]` would change identity every render).
const EMPTY_RESULTS = []

async function fetchSearchPage([, query, page]) {
  const response = await fetch('/api/authenticated/search', {
    method: 'POST',
    body: JSON.stringify({ query, page, limit: SEARCH_PAGE_SIZE }),
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

/**
 * The search modal's results, a page at a time. The search endpoint pages its
 * results (`total`, `hasNextPage`), so the modal asks for the next page as its
 * list nears the end, and every result stays reachable.
 *
 * Typing is debounced; the empty query (Recently Added) is asked for at once.
 * SWR caches each page under ['search', query, page]: reopening the modal or
 * going back to a query shows its pages straight away, and a late answer for
 * an earlier query never shows under a newer one.
 */
export function useSearchPages(query) {
  const typed = query.trim()
  const [debounced, setDebounced] = useState(typed)
  // A cleared box drops the last typed query at once, so typing again doesn't
  // show that query's results while the delay runs (state adjusted during
  // render, as React's docs advise for state derived from a changing value).
  if (!typed && debounced) setDebounced('')
  const settled = typed ? debounced : ''

  useEffect(() => {
    if (!typed) return undefined
    const timer = setTimeout(() => setDebounced(typed), SEARCH_TYPING_DELAY_MS)
    return () => clearTimeout(timer)
  }, [typed])

  const { data, size, setSize, isLoading, error } = useSWRInfinite(
    (page, previous) => (previous && !previous.hasNextPage ? null : ['search', settled, page]),
    fetchSearchPage,
    // The first page doesn't change because a later one was asked for
    { revalidateOnFocus: false, revalidateFirstPage: false, errorRetryCount: 3 }
  )

  const results = useMemo(() => (data ? data.flatMap((page) => page.results ?? []) : EMPTY_RESULTS), [data])
  const loadedPages = data?.length ?? 0
  const hasNextPage = Boolean(data?.[loadedPages - 1]?.hasNextPage) && !error
  const loadingMore = loadedPages > 0 && size > loadedPages

  // One page in flight at a time: a call while the next page is on its way does
  // nothing. Kept in a ref because several options can ask in the same tick, and
  // setSize fetches again even when the size doesn't change.
  const requested = useRef({ query: settled, pages: 0 })
  const loadMore = useCallback(() => {
    if (!hasNextPage) return
    if (requested.current.query === settled && requested.current.pages > loadedPages) return
    requested.current = { query: settled, pages: loadedPages + 1 }
    setSize(loadedPages + 1)
  }, [hasNextPage, loadedPages, setSize, settled])

  return {
    results,
    total: data?.[0]?.total ?? 0,
    hasNextPage,
    loadingMore,
    loadMore,
    isLoading,
  }
}
