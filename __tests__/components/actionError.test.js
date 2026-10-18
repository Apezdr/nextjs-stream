/**
 * ActionError: a form action's error in a live region that is in the DOM from
 * the first render, takes no space while it is empty, and announces each
 * error once.
 */

import { render, screen } from '@testing-library/react'

const ActionError = require('@components/Admin/Media/ActionError').default

const IDLE = { status: 'idle' }

describe('ActionError', () => {
  it('is in the DOM, empty and out of the layout flow before any error', () => {
    render(<ActionError state={IDLE} />)

    const region = screen.getByRole('alert')
    expect(region).toBeEmptyDOMElement()
    // Positioned out of the flow with no size: a flex or grid gap does not count it
    expect(region).toHaveClass('absolute')
    expect(region).not.toHaveClass('text-sm')
  })

  it('takes its place in the layout, with its classes, only while it shows a message', () => {
    const { rerender } = render(<ActionError state={IDLE} />)
    const region = screen.getByRole('alert')

    rerender(<ActionError state={{ status: 'error', message: 'Title is required.' }} />)
    expect(screen.getByRole('alert')).toBe(region)
    expect(region).toHaveTextContent('Title is required.')
    expect(region).not.toHaveClass('absolute')
    expect(region).toHaveClass('text-sm', 'text-red-600')

    rerender(<ActionError state={{ status: 'success', message: 'Saved.' }} />)
    expect(region).toBeEmptyDOMElement()
    expect(region).toHaveClass('absolute')
  })

  it('uses the classes it is given while it shows a message', () => {
    render(<ActionError state={{ status: 'error', message: 'Delete failed.' }} className="text-xs text-red-600" />)

    expect(screen.getByRole('alert')).toHaveClass('text-xs', 'text-red-600')
    expect(screen.getByRole('alert')).not.toHaveClass('absolute')
  })

  it('leaves the text alone on a re-render with the same state, and replaces it for a new error with the same words', () => {
    const first = { status: 'error', message: 'Title is required.' }
    const { rerender } = render(<ActionError state={first} />)
    const region = screen.getByRole('alert')
    const announced = region.firstChild

    rerender(<ActionError state={first} />)
    expect(region.firstChild).toBe(announced)

    rerender(<ActionError state={{ status: 'error', message: 'Title is required.' }} />)
    expect(region).toHaveTextContent('Title is required.')
    expect(region.firstChild).not.toBe(announced)
  })
})
