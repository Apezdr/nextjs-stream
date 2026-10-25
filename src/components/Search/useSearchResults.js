'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** The modal asks for the most a page may hold. */
export const SEARCH_PAGE_SIZE = 50
/** How long typing has to pause before the query is sent. */
export const SEARCH_TYPING_DELAY_MS = 600
/** The kinds a search can be limited to; both are on by default. */
export const SEARCH_KINDS = Object.freeze(['movie', 'tv'])

/** A slot whose page hasn't arrived yet: shown as a placeholder row, never selectable. */
export const isPlaceholder = (option) => option?.placeholder === true

// Stable empty reference so effects depending on the options don't loop while
// the first page is still loading (a fresh `[]` would change identity every render).
const NO_OPTIONS = []

async function fetchSearchPage(query, types, page) {
  const response = await fetch('/api/authenticated/search', {
    method: 'POST',
    body: JSON.stringify({ query, types, page, limit: SEARCH_PAGE_SIZE }),
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

/**
 * The search modal's results as one list of `total` slots, so the list's
 * scrollbar stands for every match. The first page tells how many there are;
 * every other slot is a placeholder until its page arrives, and the list asks
 * for a page (requestPage) when its placeholders come into view, wherever
 * that is: scrolling, dragging the scrollbar to the middle, or the arrow keys.
 *
 * Typing is debounced; the empty query (Recently Added) is asked for at once.
 * `types` limits the results to movies or shows (both by default). Pages are
 * kept per query and choice of kinds while the search box is mounted, so
 * reopening the modal or going back to a search shows what was loaded, and an
 * answer for an earlier search only ever fills that search's slots.
 */
export function useSearchResults(query, types = SEARCH_KINDS) {
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

  // The kinds and the query together: the key every page is kept under
  const kinds = SEARCH_KINDS.filter((kind) => types.includes(kind)).join(',')
  const search = `${kinds}\u0000${settled}`

  // search -> { total, pages: { [page]: results } }, or { failed: true } when its first page failed
  const [loaded, setLoaded] = useState({})
  // Pages asked for (in flight or arrived), so each is asked for once
  const asked = useRef(new Set())

  const requestPage = useCallback(
    (page) => {
      const key = `${search}\u0000${page}`
      if (asked.current.has(key)) return
      asked.current.add(key)
      fetchSearchPage(settled, kinds.split(','), page)
        .then(({ results = [], total = 0 }) => {
          setLoaded((current) => ({
            ...current,
            [search]: { total, pages: { ...current[search]?.pages, [page]: results } },
          }))
        })
        .catch((error) => {
          // Asked for again the next time its placeholders show
          asked.current.delete(key)
          console.error(`Search page ${page} failed:`, error)
          if (page === 0) setLoaded((current) => ({ ...current, [search]: { failed: true } }))
        })
    },
    [search, settled, kinds]
  )

  // The first page of a search, which tells how many results there are
  useEffect(() => {
    requestPage(0)
  }, [requestPage])

  const retry = useCallback(() => {
    setLoaded(({ [search]: _failed, ...rest }) => rest)
    requestPage(0)
  }, [requestPage, search])

  const entry = loaded[search]
  const options = useMemo(() => {
    if (!entry || entry.failed) return NO_OPTIONS
    const slots = []
    const pageCount = Math.ceil(entry.total / SEARCH_PAGE_SIZE)
    for (let page = 0; page < pageCount; page++) {
      const results = entry.pages[page]
      if (results) {
        slots.push(...results)
      } else {
        const count = Math.min(SEARCH_PAGE_SIZE, entry.total - page * SEARCH_PAGE_SIZE)
        for (let i = 0; i < count; i++) slots.push({ placeholder: true, page, slot: page * SEARCH_PAGE_SIZE + i })
      }
    }
    return slots
  }, [entry])

  return {
    options,
    total: entry?.total ?? 0,
    isLoading: !entry,
    failed: entry?.failed === true,
    requestPage,
    retry,
  }
}
