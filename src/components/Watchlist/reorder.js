/**
 * Move one playlist item into the place another item holds, returning the new
 * order, or null when either id is missing or both are the same item.
 *
 * The positions are item ids, not indices, on purpose. The grid shows the
 * filtered list (All / Movies / TV), but the saved order covers every item, so
 * an index taken from one points at a different item in the other. Moving an
 * item to its target's place in the full list gives the same visible result as
 * moving it within the filtered one, and every other item keeps its order.
 *
 * @template {{ id: string }} T
 * @param {T[]} items - The full playlist, in its current order
 * @param {string} movedId - The item being moved
 * @param {string} targetId - The item whose place it takes
 * @returns {T[] | null}
 */
export function moveItemToPosition(items, movedId, targetId) {
  if (movedId === targetId) return null
  const from = items.findIndex((item) => item.id === movedId)
  const to = items.findIndex((item) => item.id === targetId)
  if (from === -1 || to === -1) return null

  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}
