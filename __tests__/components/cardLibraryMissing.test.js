/**
 * A playlist row on the home page keeps a title with no TMDB id after it has
 * left the library. Its card says so, and doesn't open: the popup reads a
 * title's details from the library or from TMDB, and this one is in neither
 * (it used to ask TMDB for "tmdb_id=null").
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import Card from '@components/MediaScroll/Card'

jest.mock('@components/WatchingNow/ownSessions', () => ({
  __esModule: true,
  useOwnLiveSessions: () => ({ sessions: [], offsetMs: 0 }),
}))
jest.mock('@components/RetryImage', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }) => <img alt={alt} />,
}))
jest.mock('@components/MediaScroll/PopupCard', () => ({ __esModule: true, default: () => null }))
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }))

function renderCard(props) {
  const onExpand = jest.fn()
  render(
    <Card
      title="Sintel"
      itemId="item-0"
      mediaId="68eda138767b1e172b9d7c6d"
      type="movie"
      posterURL="/sorry-image-not-available.jpg"
      link={null}
      listType="playlist"
      isAvailable={false}
      isExpanded={false}
      onExpand={onExpand}
      onCollapse={jest.fn()}
      {...props}
    />
  )
  return { onExpand, card: screen.getByRole('button', { expanded: false }) }
}

it('says the title is no longer in the library, and opens nothing', async () => {
  const { onExpand, card } = renderCard({ libraryMissing: true, metadata: { id: null, release_date: '2010-09-30' } })

  expect(screen.getByText('No Longer in Library')).toBeInTheDocument()
  expect(screen.queryByText('Not Available')).toBeNull()

  await act(() => fireEvent.click(card))
  await act(() => fireEvent.focus(card))
  await act(() => fireEvent.keyDown(card, { key: 'Enter' }))
  expect(onExpand).not.toHaveBeenCalled()
})

it('a TMDB title the library doesn’t have still opens its TMDB details', async () => {
  const { onExpand, card } = renderCard({ metadata: { id: 920, release_date: '2006-06-09' } })

  expect(screen.getByText('Not Available')).toBeInTheDocument()
  expect(screen.queryByText('No Longer in Library')).toBeNull()

  await act(() => fireEvent.click(card))
  expect(onExpand).toHaveBeenCalledWith('item-0')
})
