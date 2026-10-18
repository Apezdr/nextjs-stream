'use client'

import { startTransition, useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { TrashIcon } from '@heroicons/react/24/outline'
import { deleteMovieAction, deleteTVShowAction } from '@src/utils/admin/flatMediaActions'
import ActionError from './ActionError'

const NO_ERROR = { status: 'idle' }

/**
 * Delete control for a movie or TV show. Two-click confirm to avoid accidents.
 * TV deletes cascade (episodes → seasons → show) in the server action.
 *
 * The delete is dispatched in a transition, so "Deleting…" shows while it
 * runs. Its error is announced by an ActionError region that is rendered from
 * the first render on (it takes no space while empty) and shows the error
 * while the confirm step is open. Opening the confirm step clears the last
 * delete's result: the region stays empty until a new one arrives.
 *
 * @param {'movie'|'tv'} type
 * @param {string} id - flat document id
 * @param {string} [label] - shown in the confirm prompt
 * @param {string} [redirectTo] - navigate here on success (editor pages); list
 *   pages omit it and rely on revalidatePath to drop the row.
 * @param {'icon'|'button'} [variant]
 */
export default function DeleteMediaButton({ type, id, label = 'this entry', redirectTo, variant = 'icon' }) {
  const action = type === 'tv' ? deleteTVShowAction : deleteMovieAction
  const [state, dispatch, isPending] = useActionState(action, { status: 'idle' })
  const [confirming, setConfirming] = useState(false)
  // The action's state when the confirm step last opened: a result from
  // before it (useActionState cannot be reset) is not shown again.
  const [openedOn, setOpenedOn] = useState(null)
  const router = useRouter()

  useEffect(() => {
    if (state.status === 'success' && redirectTo) router.push(redirectTo)
  }, [state, redirectTo, router])

  const openConfirm = () => {
    setOpenedOn(state)
    setConfirming(true)
  }
  const shownState = confirming && state !== openedOn ? state : NO_ERROR

  let control
  if (confirming) {
    control = (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          disabled={isPending}
          // In a transition, as useActionState needs: isPending follows the delete
          onClick={() => startTransition(() => dispatch({ id }))}
          className="rounded bg-red-600 px-2 py-1 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"
        >
          {isPending ? 'Deleting…' : 'Confirm'}
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={() => setConfirming(false)}
          className="rounded bg-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-300"
        >
          Cancel
        </button>
      </span>
    )
  } else if (variant === 'button') {
    control = (
      <button
        type="button"
        onClick={openConfirm}
        className="inline-flex items-center gap-1 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
      >
        <TrashIcon className="h-4 w-4" /> Delete
      </button>
    )
  } else {
    control = (
      <button
        type="button"
        onClick={openConfirm}
        title={`Delete ${label}`}
        className="text-gray-400 hover:text-red-600"
      >
        <TrashIcon className="h-5 w-5" />
        <span className="sr-only">Delete {label}</span>
      </button>
    )
  }

  return (
    <>
      {control}
      {/* Second child of every branch, so the same region stays mounted */}
      <ActionError state={shownState} className="ml-1 text-xs text-red-600" />
    </>
  )
}
