/**
 * A rail card says when one of the viewer's own devices is on it: a movie or
 * an episode card by its identity, a show card by its catalog id (the item's
 * id). Never on a title outside the library or a trailer stand-in.
 */
import { render, screen } from '@testing-library/react'
import Card from '@components/MediaScroll/Card'

let mockOwn = { sessions: [], offsetMs: 0 }
jest.mock('@components/WatchingNow/ownSessions', () => ({
  __esModule: true,
  useOwnLiveSessions: () => mockOwn,
}))
jest.mock('@components/RetryImage', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }) => <img alt={alt} />,
}))
jest.mock('@components/MediaScroll/PopupCard', () => ({ __esModule: true, default: () => null }))
jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }))

const TV = { type: 'tv', label: 'TV', platform: 'Android' }
const live = (fields) => ({ id: 'row-1', sessionId: 's1', state: 'playing', position: 600, positionAt: null, device: TV, ...fields })

function renderCard(props) {
  return render(<Card title="A title" itemId="item-0" posterURL="https://img.example/p.jpg" link="a-title" listType="movie" {...props} />)
}

afterEach(() => {
  mockOwn = { sessions: [], offsetMs: 0 }
})

it('a movie card on a title playing elsewhere carries the badge', () => {
  mockOwn = { sessions: [live({ mediaId: 'mid:film' })], offsetMs: 0 }
  renderCard({ type: 'movie', mediaId: '6730f1aa', durableMediaId: 'mid:film', normalizedVideoId: 'nid-film' })
  expect(screen.getByTestId('live-badge')).toHaveAttribute('title', 'Playing on TV')
})

it('an episode card matches by the hash when the session has no mediaId yet', () => {
  mockOwn = { sessions: [live({ mediaId: null, normalizedVideoId: 'nid-ep', state: 'paused' })], offsetMs: 0 }
  renderCard({ type: 'tv', mediaId: 'ep-id', seasonNumber: 1, episodeNumber: 2, normalizedVideoId: 'nid-ep' })
  expect(screen.getByTestId('live-badge')).toHaveAttribute('title', 'Paused on TV')
})

it('a show card carries it for any of its episodes, named', () => {
  mockOwn = { sessions: [live({ showId: '64b000000000000000000001', seasonNumber: 2, episodeNumber: 7 })], offsetMs: 0 }
  renderCard({ type: 'tv', mediaId: '64b000000000000000000001' })
  expect(screen.getByTestId('live-badge')).toHaveAttribute('title', 'Playing S2 · E7 on TV')
})

it('never on a title outside the library or a trailer stand-in', () => {
  mockOwn = { sessions: [live({ mediaId: 'mid:film', showId: '64b000000000000000000001' })], offsetMs: 0 }
  renderCard({ type: 'movie', mediaId: 'tmdb-1', durableMediaId: 'mid:film', isAvailable: false })
  renderCard({ type: 'movie', mediaId: 'x', durableMediaId: 'mid:film', isTrailer: true })
  renderCard({ type: 'tv', mediaId: '64b000000000000000000001', isAvailable: false })
  expect(screen.queryByTestId('live-badge')).toBeNull()
})

it('nothing on a card nobody is watching', () => {
  mockOwn = { sessions: [live({ mediaId: 'mid:other' })], offsetMs: 0 }
  renderCard({ type: 'movie', mediaId: 'm', durableMediaId: 'mid:film' })
  expect(screen.queryByTestId('live-badge')).toBeNull()
})
