/**
 * The "Credits & licenses" page: the library's credits in full, then links
 * to each credited title's credits panel. A show without credits of its own
 * links straight to its credited episodes.
 */

import { render, screen, within } from '@testing-library/react'

jest.mock('@src/utils/credits/catalog', () => ({ getCreditsCatalog: jest.fn(), getLibraryCreditsRecords: jest.fn(async () => []) }))
const { getCreditsCatalog, getLibraryCreditsRecords } = require('@src/utils/credits/catalog')
const CreditsCatalogPage = require('@components/Credits/CreditsCatalogPage').default
const { resolveLibraryCredits } = require('@src/utils/credits/resolve')

const library = resolveLibraryCredits([
  {
    creditsHash: 'h',
    credits: {
      schemaVersion: 1,
      assets: [{ id: 'collage', kind: 'artwork', path: 'poster_collage.jpg', label: 'Poster collage' }],
      entries: [
        { id: 'c1', assetIds: ['collage'], work: 'First poster', license: 'CC BY 3.0', licenseUrl: 'https://creativecommons.org/licenses/by/3.0/' },
        { id: 'c2', assetIds: ['collage'], work: 'Second poster', license: 'CC BY 4.0' },
      ],
    },
  },
])

beforeEach(() => jest.clearAllMocks())

const renderPage = async (catalog, user = { limitedAccess: false }) => {
  getCreditsCatalog.mockResolvedValue(catalog)
  render(await CreditsCatalogPage({ user }))
}

it('shows the library credits and links to each credited title panel', async () => {
  await renderPage({
    library,
    titles: [
      { type: 'movie', id: 'm1', title: 'A Film', originalTitle: 'A Film (2020)' },
      { type: 'tv', id: 's1', title: 'A Show', originalTitle: 'A Show', hasCredits: true, episodes: [] },
      { type: 'tv', id: 's2', title: 'Other Show', originalTitle: 'Other Show', hasCredits: false, episodes: [{ seasonNumber: 1, episodeNumber: 3, title: 'Third' }] },
    ],
  })
  expect(screen.getByRole('heading', { level: 1, name: 'Credits & licenses' })).toBeInTheDocument()
  const shared = screen.getByRole('region', { name: 'Shared artwork' })
  expect(within(shared).getByText('First poster')).toBeInTheDocument()
  expect(within(shared).getByText('CC BY 4.0')).toBeInTheDocument()

  expect(screen.getByRole('link', { name: 'A Film' })).toHaveAttribute('href', '/list/movie/A%20Film%20(2020)#credits')
  expect(screen.getByRole('link', { name: 'A Show' })).toHaveAttribute('href', '/list/tv/A%20Show#credits')
  // No credits of its own: the show is named, its episode is the link
  expect(screen.queryByRole('link', { name: 'Other Show' })).toBeNull()
  expect(screen.getByRole('link', { name: 'S1 E3 · Third' })).toHaveAttribute('href', '/list/tv/Other%20Show/1/3#credits')
})

it('has no library section without library credits', async () => {
  await renderPage({ library: null, titles: [{ type: 'movie', id: 'm1', title: 'A Film', originalTitle: 'A Film' }] })
  expect(screen.queryByRole('region', { name: 'Shared artwork' })).toBeNull()
  expect(screen.getByRole('region', { name: 'Titles with credits' })).toBeInTheDocument()
})

it('asks for no titles for a user with limited access', async () => {
  await renderPage({ library, titles: [] }, { limitedAccess: true })
  expect(getCreditsCatalog).toHaveBeenCalledWith({ includeTitles: false })
  expect(screen.queryByRole('region', { name: 'Titles with credits' })).toBeNull()
})

it('shows an admin a failing library sync, and that the credits shown are the last valid ones', async () => {
  getLibraryCreditsRecords.mockResolvedValueOnce([
    { _id: 'default', credits: {}, creditsSource: 'default', creditsHash: 'a'.repeat(64), creditsStatus: { state: 'error', reason: 'fetch-failed', serverId: 'default' } },
    { _id: 'other', credits: {}, creditsSource: 'other', creditsHash: 'b'.repeat(64) },
  ])
  await renderPage({ library, titles: [] }, { role: 'admin' })
  const status = screen.getByRole('status')
  expect(status).toHaveTextContent('could not be fetched from the file server')
  expect(status).toHaveTextContent('The credits shown are the last valid ones')
  expect(screen.getAllByRole('status')).toHaveLength(1)
})

it('shows no sync state to anyone else', async () => {
  await renderPage({ library, titles: [] })
  expect(getLibraryCreditsRecords).not.toHaveBeenCalled()
  expect(screen.queryByRole('status')).toBeNull()
})

it('says so when there is nothing', async () => {
  await renderPage({ library: null, titles: [] })
  expect(screen.getByText('No credits are available.')).toBeInTheDocument()
})
