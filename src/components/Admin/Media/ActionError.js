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
 * While it is empty the region takes no space: it is positioned out of the
 * flow (`absolute`, with no size), so a flex or grid gap does not count it.
 * It stays in the DOM and in the accessibility tree all the same. It takes
 * its place in the layout, with `className`, only while it has text.
 *
 * @param {{ status: string, message?: string }} state - The action's state
 * @param {string} [className] - Its classes while it shows a message
 */
export default function ActionError({ state, className = 'text-sm text-red-600' }) {
  // Number the error results: every completed action returns a new state
  // object, and a re-render returns the same one. (Adjusted during render,
  // React's pattern for state that follows a prop.)
  const [seen, setSeen] = useState(() => ({ state, errors: state?.status === 'error' ? 1 : 0 }))
  if (seen.state !== state) {
    setSeen({ state, errors: seen.errors + (state?.status === 'error' ? 1 : 0) })
  }

  const message = state?.status === 'error' ? state.message : null
  return (
    <span role="alert" className={message ? className : 'absolute'}>
      {message ? <span key={seen.errors}>{message}</span> : null}
    </span>
  )
}
