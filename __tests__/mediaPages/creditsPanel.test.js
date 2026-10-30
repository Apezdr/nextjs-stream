/**
 * The Credits & licenses panel (CREDITS_SIDECAR.md, section 8): its own
 * section, grouped by kind in authored order, every supplied field shown in
 * full, text rendered as text, links only for http(s) URLs, and the longer
 * conditions in a disclosure that stays in the page.
 */

import { render, screen, within } from '@testing-library/react'

const CreditsPanel = require('@components/MediaPages/details/CreditsPanel').default
const { resolveEpisodeCredits, resolveTitleCredits } = require('@src/utils/credits/resolve')
const fixtures = require('../helpers/creditsFixtures')

const entry = (fields) => ({ id: 'e', scope: 'title', assets: [{ id: 'film', kind: 'film' }], ...fields })
const panel = (entries) => render(<CreditsPanel credits={{ schemaVersion: 1, entries }} />)

it('renders nothing without credits', () => {
  const { container } = render(<CreditsPanel credits={null} />)
  expect(container).toBeEmptyDOMElement()
})

it('is a labelled section of its own, grouped by kind', () => {
  render(<CreditsPanel credits={resolveTitleCredits(fixtures.mixedGrants())} />)
  const section = screen.getByRole('region', { name: 'Credits & licenses' })
  expect(within(section).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Video', 'Artwork'])
  expect(within(section).getByRole('heading', { level: 4, name: 'Short Film C' })).toBeInTheDocument()
  expect(within(section).getByRole('heading', { level: 4, name: 'Short Film C poster' })).toBeInTheDocument()
})

it('shows two licenses for one title side by side, each with its link', () => {
  render(<CreditsPanel credits={resolveTitleCredits(fixtures.mixedGrants())} />)
  expect(screen.getByText('CC BY 3.0')).toBeInTheDocument()
  expect(screen.getByText('CC BY 4.0')).toBeInTheDocument()
  const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
  expect(links).toEqual([fixtures.CC_BY_3, fixtures.CC_BY_4])
  for (const link of screen.getAllByRole('link')) {
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAccessibleName(expect.stringMatching(/\(opens in a new tab\)$/))
  }
})

it('shows what the grant does not cover', () => {
  render(<CreditsPanel credits={resolveTitleCredits(fixtures.mixedGrants())} />)
  expect(screen.getByText('Not covered')).toBeInTheDocument()
  expect(screen.getByText('<the logos on the poster, as the grant excludes them>')).toBeInTheDocument()
})

it('renders supplied text as text, never as markup', () => {
  const { container } = panel([entry({ work: '<img src=x onerror=alert(1)>', attributionText: '<b>bold</b>\nsecond line' })])
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('b')).toBeNull()
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  expect(screen.getByText(/<b>bold<\/b>/)).toHaveClass('whitespace-pre-line')
})

it('never renders a link for a URL that is not http(s)', () => {
  const { container } = panel([entry({ work: 'W', licenseUrl: 'javascript:alert(1)', sourceUrl: 'data:text/html,x' })])
  expect(container.querySelector('a')).toBeNull()
  expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
})

it('shows a long creator list and long attribution in full', () => {
  const author = Array.from({ length: 60 }, (_, i) => `Contributor Number ${i + 1}`).join(', ')
  const attributionText = 'A'.repeat(4000)
  panel([entry({ work: 'W', author, attributionText })])
  expect(screen.getByText(author)).toBeInTheDocument()
  expect(screen.getByText(attributionText)).toBeInTheDocument()
})

it('keeps notices, historical notices and a note in a disclosure, all in the page', () => {
  const { container } = panel([
    entry({ work: 'W', notices: ['Disclaimer of warranties, verbatim.'], historicalNotices: ['Notice shown on the film.'], note: 'More.' }),
  ])
  const details = container.querySelector('details')
  expect(within(details).getByText('Notices and conditions (3)').tagName).toBe('SUMMARY')
  expect(within(details).getByText('Disclaimer of warranties, verbatim.')).toBeInTheDocument()
  expect(within(details).getByText('Notice shown on the film.')).toBeInTheDocument()
  expect(within(details).getByText('Notice on the original work')).toBeInTheDocument()
})

it('marks inherited show entries as series credits on an episode, and keeps derived-from art', () => {
  render(<CreditsPanel credits={resolveEpisodeCredits(fixtures.seriesShow(), fixtures.episodeOwn(1, 'Ep'))} />)
  const art = screen.getByRole('article', { name: 'Episode Three (frame used as series artwork)' })
  expect(within(art).getByText(/^Series credit/)).toBeInTheDocument()
  expect(within(art).getByText('Frame from Episode Three, cropped')).toBeInTheDocument()
  expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Video', 'Artwork', 'Music & audio', 'Subtitles'])
})

it('keeps authored order inside a group', () => {
  render(<CreditsPanel credits={resolveTitleCredits(fixtures.seriesShow())} />)
  const artwork = screen.getByRole('heading', { level: 3, name: 'Artwork' }).parentElement
  expect(within(artwork).getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual([
    'Episode Three (frame used as series artwork)',
    'Short Film A poster',
    'Short Film B poster',
    'Short Film C poster',
  ])
})
