/**
 * The cards behind a drag of the Watch History date strip.
 *
 * A drag passes over hundreds of pages. Asking the server for each would be
 * hundreds of requests a second, and asking for none until the drag ends
 * would hide the titles someone is looking for. So cards are fetched in
 * blocks (48 titles) and kept by list position, and the server is asked:
 *
 *   - for one block at a time,
 *   - during a drag, only for a block the handle has stayed on for `dwellMs`
 *     (a sweep across two years asks for nothing in between),
 *   - never twice for a block it has answered, until clear().
 *
 * No React here: the row owns one loader and re-renders on `onChange`.
 */

export const BLOCK_SIZE = 48
const DWELL_MS = 90
const RETRY_MS = 5000

export class BlockLoader {
  /**
   * @param {object} options
   * @param {(block: number) => Promise<object[]>} options.fetchBlock - The
   *   cards of one block, each with its `listPosition`
   * @param {() => void} [options.onChange] - A request ended (cards arrived or it failed)
   */
  constructor({ fetchBlock, onChange = () => {}, blockSize = BLOCK_SIZE, dwellMs = DWELL_MS, retryMs = RETRY_MS }) {
    this.fetchBlock = fetchBlock
    this.onChange = onChange
    this.blockSize = blockSize
    this.dwellMs = dwellMs
    this.retryMs = retryMs
    /** @type {Map<number, object>} list position → card */
    this.cards = new Map()
    this.loaded = new Set()
    this.failedAt = new Map()
    this.inFlight = null
    this.requests = 0
    this.generation = 0
    this.wanted = []
    this.ahead = null
    this.paced = false
    this.lead = null
    this.dwelt = true
    this.timer = null
  }

  blockOf(position) {
    return Math.floor(position / this.blockSize)
  }

  /** The blocks holding positions `from`..`to`, the one holding `from` first. */
  blocksFor(from, to) {
    const blocks = []
    for (let block = this.blockOf(from); block <= this.blockOf(to); block++) blocks.push(block)
    return blocks
  }

  /** Whether every block holding positions `from`..`to` has arrived. */
  covers(from, to) {
    return this.blocksFor(from, to).every((block) => this.loaded.has(block))
  }

  /**
   * Say what the row is showing. Called on every move of the handle.
   * @param {object} view
   * @param {number} view.lead - The block under the handle
   * @param {number[]} view.wanted - The blocks the page needs, most needed first
   * @param {number|null} [view.ahead] - A block worth having next (the direction of travel)
   * @param {boolean} view.paced - true during a drag: wait for the handle to stay on a block
   */
  aim({ lead, wanted, ahead = null, paced }) {
    this.wanted = wanted
    this.ahead = ahead
    this.paced = paced
    if (!paced) {
      this.#stopTimer()
      this.dwelt = true
      this.#pump()
      return
    }
    if (lead === this.lead) {
      this.#pump()
      return
    }
    this.lead = lead
    this.dwelt = false
    this.#stopTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      this.dwelt = true
      this.#pump()
    }, this.dwellMs)
  }

  /** The drag is over: nothing more is wanted. A request already sent still lands. */
  release() {
    this.#stopTimer()
    this.wanted = []
    this.ahead = null
    this.paced = false
    this.lead = null
    this.dwelt = true
  }

  /** Forget every card: the list changed, so positions no longer hold. */
  clear() {
    this.release()
    this.generation += 1
    this.cards.clear()
    this.loaded.clear()
    this.failedAt.clear()
    this.inFlight = null
  }

  #stopTimer() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  #fetchable(block) {
    if (block === null || block < 0 || this.loaded.has(block)) return false
    const failed = this.failedAt.get(block)
    return failed === undefined || Date.now() - failed >= this.retryMs
  }

  #pump() {
    if (this.inFlight !== null) return
    if (this.paced && !this.dwelt) return
    const block = [...this.wanted, this.ahead].find((candidate) => this.#fetchable(candidate))
    if (block === undefined) return

    const generation = this.generation
    this.inFlight = block
    this.requests += 1
    Promise.resolve()
      .then(() => this.fetchBlock(block))
      .then(
        (cards) => {
          if (generation !== this.generation) return
          for (const card of cards) {
            if (card && Number.isInteger(card.listPosition)) this.cards.set(card.listPosition, card)
          }
          this.loaded.add(block)
          this.failedAt.delete(block)
        },
        (error) => {
          if (generation !== this.generation) return
          console.error(`[WatchHistory] block ${block} of the list did not load`, error)
          this.failedAt.set(block, Date.now())
        }
      )
      .then(() => {
        if (generation !== this.generation) return
        this.inFlight = null
        this.onChange()
        this.#pump()
      })
  }
}

/**
 * One page of the row put together from the loader's cards, in the shape
 * horizontal-list answers with, or null while a block it needs is missing.
 * A position with no card is a title the library no longer holds: the page
 * goes without it, as the server's own page does.
 */
export function pageFromBlocks(loader, first, perPage, total) {
  if (total <= 0 || first >= total) return null
  const from = Math.max(0, first - 1)
  const to = Math.min(total - 1, first + perPage)
  if (!loader.covers(from, to)) return null

  const currentItems = []
  for (let position = first; position < first + perPage; position++) {
    const card = loader.cards.get(position)
    if (card) currentItems.push(card)
  }
  return {
    currentItems,
    previousItem: first > 0 ? loader.cards.get(first - 1) ?? null : null,
    nextItem: loader.cards.get(first + perPage) ?? null,
    playlist: null,
  }
}
