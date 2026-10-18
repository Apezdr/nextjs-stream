'use client'

import { useState } from 'react'

/**
 * A form action's error (useActionState's `{ status: 'error', message }`), in
 * a live region that announces each error once.
 *
 * The region (role="alert") is rendered from the first render on, empty, so
 * the message is announced when it appears in it: a region inserted together
 * with its text is not reliably read. Each error is announced once: a render
 * that leaves the action's state alone (typing in the form) does not touch the
 * text, and a new error result replaces the text node even when its words are
 * the same ("Title is required." twice), so it is read again.
 *
 * Place it after any success message in a flex row: while it is empty it
 * takes no width, and a gap only follows what is shown before it.
 *
 * @param {{ status: string, message?: string }} state - The action's state
 */
export default function ActionError({ state }) {
  // Number the error results: every completed action returns a new state
  // object, and a re-render returns the same one. (Adjusted during render,
  // React's pattern for state that follows a prop.)
  const [seen, setSeen] = useState(() => ({ state, errors: state?.status === 'error' ? 1 : 0 }))
  if (seen.state !== state) {
    setSeen({ state, errors: seen.errors + (state?.status === 'error' ? 1 : 0) })
  }

  const message = state?.status === 'error' ? state.message : null
  return (
    <span role="alert" className="text-sm text-red-600">
      {message ? <span key={seen.errors}>{message}</span> : null}
    </span>
  )
}
