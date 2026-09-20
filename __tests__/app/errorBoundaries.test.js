/**
 * The route error pages' "Try again" must call the boundary's `retry` prop.
 *
 * Next renamed it from `unstable_retry` in 16.3 and stopped passing the old
 * name, so a page still destructuring `unstable_retry` throws on click. The
 * second test reads the installed Next's error boundary, so a future rename
 * fails here instead of in front of a viewer.
 */

import fs from 'fs'
import path from 'path'
import { render, screen, fireEvent } from '@testing-library/react'

const pages = [
  ['list', require('@src/app/(styled)/list/error').default],
  ['notifications', require('@src/app/(styled)/notifications/error').default],
]

describe('route error pages', () => {
  let consoleError
  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => consoleError.mockRestore())

  it.each(pages)('%s: "Try again" re-fetches through retry', (_name, ErrorPage) => {
    const retry = jest.fn()
    render(<ErrorPage error={new Error('boom')} retry={retry} />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('matches the prop name the installed Next passes to error components', () => {
    const boundary = fs.readFileSync(
      path.join(process.cwd(), 'node_modules/next/dist/client/components/error-boundary.js'),
      'utf8'
    )
    expect(boundary).toMatch(/\bretry: this\.retry\b/)
    expect(boundary).not.toContain('unstable_retry')
  })
})
