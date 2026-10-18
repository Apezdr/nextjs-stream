/**
 * LockableField, the input-with-lock every admin media editor uses: its hint
 * describes the input, a field that locks itself on edit announces it
 * politely, and the lock state never rests on colour alone.
 */

import { render, screen } from '@testing-library/react'

jest.mock('@src/utils', () => ({ classNames: (...args) => args.flat().filter(Boolean).join(' ') }))

const LockableField = require('@components/Admin/Media/LockableField').default

const field = (props) => render(<LockableField id="poster" label="Poster URL" value="" onChange={() => {}} {...props} />)

describe('the hint', () => {
  it('describes the input', () => {
    field({ helpText: 'Where the poster is served from.' })
    expect(screen.getByLabelText('Poster URL')).toHaveAccessibleDescription('Where the poster is served from.')
  })

  it('describes a textarea', () => {
    field({ textarea: true, helpText: 'A short summary.' })
    expect(screen.getByLabelText('Poster URL')).toHaveAccessibleDescription('A short summary.')
  })

  it('is not referenced when there is none', () => {
    field({})
    expect(screen.getByLabelText('Poster URL')).not.toHaveAttribute('aria-describedby')
  })
})

describe('the auto-lock announcement', () => {
  it('has no live region on a field that does not lock itself', () => {
    field({ onToggleLock: () => {} })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('keeps an empty polite region until the field locks itself, then says so', () => {
    const { rerender } = field({ onToggleLock: () => {}, autoLocked: false })
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toBeEmptyDOMElement()

    rerender(<LockableField id="poster" label="Poster URL" value="x" onChange={() => {}} onToggleLock={() => {}} locked autoLocked />)
    expect(screen.getByRole('status')).toHaveTextContent('Poster URL locked, so the sync keeps your change.')
  })
})

describe('the lock state', () => {
  it('is carried by the toggle\'s pressed state and name, not by colour alone', () => {
    const { rerender } = field({ onToggleLock: () => {} })
    const toggle = screen.getByRole('button', { name: 'Lock Poster URL' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    rerender(<LockableField id="poster" label="Poster URL" value="" onChange={() => {}} onToggleLock={() => {}} locked />)
    expect(screen.getByRole('button', { name: 'Unlock Poster URL' })).toHaveAttribute('aria-pressed', 'true')
  })
})
