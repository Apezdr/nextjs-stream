/**
 * /api/authenticated/media sends the first 24 cast members and `castCount`. The
 * hover popup's cast grid would otherwise look complete, so it links "See all
 * N" to the title page's cast, which has an anchor for it.
 */

import { render, screen } from '@testing-library/react'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
// The grid sizes itself from its container, which jsdom gives no size
jest.mock('@src/components/MediaScroll/VirtualizedCastGrid', () => ({
  __esModule: true,
  default: ({ cast }) => <ul data-testid="cast-grid">{cast.map((p) => <li key={p.id}>{p.name}</li>)}</ul>,
}))

const CastSection = require('@src/components/MediaScroll/PopupCard/CastSection').default
const CastRail = require('@src/components/MediaPages/details/CastRail').default

const people = (n) => Array.from({ length: n }, (_, i) => ({ id: i, name: `Person ${i}`, character: `Role ${i}` }))

it('links "See all N" to the title page when the response was capped', () => {
  render(<CastSection cast={people(24)} castCount={907} href="/list/tv/A%20Show#cast" />)

  const link = screen.getByRole('link', { name: 'See all 907' })
  expect(link.getAttribute('href')).toBe('/list/tv/A%20Show#cast')
})

it('shows no link when everyone is already there', () => {
  render(<CastSection cast={people(12)} castCount={12} href="/list/movie/A%20Film#cast" />)

  expect(screen.queryByRole('link')).toBeNull()
  expect(screen.getAllByRole('listitem')).toHaveLength(12)
})

it('shows no link for a title without a page here (TMDB-only, no count)', () => {
  render(<CastSection cast={people(24)} href={null} />)

  expect(screen.queryByRole('link')).toBeNull()
})

it("gives the title page's cast rail the anchor", () => {
  const { container } = render(<CastRail cast={people(3)} id="cast" />)

  expect(container.querySelector('section#cast')).not.toBeNull()
})
