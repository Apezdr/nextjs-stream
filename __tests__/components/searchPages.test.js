/**
 * The web search modal's results come a page at a time (useSearchPages): 50 a
 * page, the next one asked for as the list nears its end, one in flight at a
 * time, and a late answer for an earlier query never shown under a newer one.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { SEARCH_PAGE_SIZE, SEARCH_TYPING_DELAY_MS, useSearchPages } from '@src/components/Search/useSearchPages'

const TOTAL = 120
const item = (query, i) => ({ _id: `${query || 'recent'}-${i}`, title: `${query} ${i}` })

let requests
let delays
beforeEach(() => {
  requests = []
  delays = {}
  global.fetch = jest.fn(async (url, { body }) => {
    const { query, page, limit } = JSON.parse(body)
    requests.push({ query, page, limit })
    if (delays[query]) await new Promise((resolve) => setTimeout(resolve, delays[query]))
    const start = page * limit
    const count = Math.max(0, Math.min(limit, TOTAL - start))
    return {
      ok: true,
      json: async () => ({
        results: Array.from({ length: count }, (_, i) => item(query, start + i)),
        total: TOTAL,
        hasNextPage: start + limit < TOTAL,
      }),
    }
  })
})

const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
)
const render = (query) => renderHook(({ q }) => useSearchPages(q), { wrapper, initialProps: { q: query } })

it('asks for the first page of Recently Added at once, 50 a page', async () => {
  const { result } = render('')

  await waitFor(() => expect(result.current.results).toHaveLength(50))
  expect(SEARCH_PAGE_SIZE).toBe(50)
  expect(requests).toEqual([{ query: '', page: 0, limit: 50 }])
  expect(result.current.total).toBe(TOTAL)
  expect(result.current.hasNextPage).toBe(true)
})

it('appends the next page, one at a time, until the last', async () => {
  const { result } = render('')
  await waitFor(() => expect(result.current.results).toHaveLength(50))

  // Several options near the end can ask in the same tick
  act(() => {
    result.current.loadMore()
    result.current.loadMore()
    result.current.loadMore()
  })
  expect(result.current.loadingMore).toBe(true)
  await waitFor(() => expect(result.current.results).toHaveLength(100))
  expect(requests.filter((r) => r.page === 1)).toHaveLength(1)
  // The first page isn't asked for again
  expect(requests.filter((r) => r.page === 0)).toHaveLength(1)

  act(() => result.current.loadMore())
  await waitFor(() => expect(result.current.results).toHaveLength(TOTAL))
  expect(result.current.hasNextPage).toBe(false)
  expect(result.current.results.map((r) => r._id)).toEqual(Array.from({ length: TOTAL }, (_, i) => `recent-${i}`))

  act(() => result.current.loadMore())
  expect(requests).toHaveLength(3)
})

it('sends a typed query once typing pauses, and starts again from its first page', async () => {
  const { result, rerender } = render('')
  await waitFor(() => expect(result.current.results).toHaveLength(50))

  rerender({ q: 'th' })
  rerender({ q: 'the' })
  await waitFor(() => expect(result.current.results[0]?._id).toBe('the-0'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })

  expect(requests.map((r) => r.query)).toEqual(['', 'the'])
  expect(result.current.results).toHaveLength(50)

  // Loading more works for the new query too
  act(() => result.current.loadMore())
  await waitFor(() => expect(result.current.results).toHaveLength(100))
  expect(requests.at(-1)).toEqual({ query: 'the', page: 1, limit: 50 })
})

it("shows Recently Added at once when the box is cleared, not the last query's results", async () => {
  const { result, rerender } = render('the')
  await waitFor(() => expect(result.current.results[0]?._id).toBe('the-0'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })

  rerender({ q: '' })
  await waitFor(() => expect(result.current.results[0]?._id).toBe('recent-0'))
  // Typing again: Recently Added stays until the new query is sent
  rerender({ q: 'x' })
  expect(result.current.results[0]._id).toBe('recent-0')
  await waitFor(() => expect(result.current.results[0]?._id).toBe('x-0'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })
})

it('never shows a late answer for an earlier query under a newer one', async () => {
  delays.slow = 400
  const { result, rerender } = render('slow')
  await waitFor(() => expect(requests.map((r) => r.query)).toContain('slow'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })

  rerender({ q: 'fast' })
  await waitFor(() => expect(result.current.results[0]?._id).toBe('fast-0'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })
  await new Promise((resolve) => setTimeout(resolve, 500))

  expect(result.current.results[0]._id).toBe('fast-0')
})
