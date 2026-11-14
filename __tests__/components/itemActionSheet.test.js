/**
 * The watchlist card's mobile "…" sheet offers the same actions as its desktop
 * menu. Radarr/Sonarr follows the user's roles, which the card has already
 * turned into arrActionLabel (null when they don't allow it); Coming Soon is
 * admin-only. The sheet once gated both on isAdmin, so a role holder saw the
 * Radarr/Sonarr action on a desktop and never on a phone.
 */

import { render, screen } from '@testing-library/react'

// The sheet as a plain container: its dialog and transitions are not under test
jest.mock('@components/Watchlist/BottomSheet', () => ({
  __esModule: true,
  default: ({ open, title, children }) => (open ? <div role="dialog" aria-label={title}>{children}</div> : null),
  SheetAction: ({ onClick, children }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}))

const ItemActionSheet = require('@components/Watchlist/ItemActionSheet').default

const unavailableMovie = { id: 'i1', tmdbId: 603, title: 'A title', mediaType: 'movie', isAvailable: false, comingSoon: false }

function renderSheet(props) {
  const noop = () => {}
  return render(
    <ItemActionSheet
      open
      onClose={noop}
      item={unavailableMovie}
      selected={false}
      canEditPlaylist
      reorder={null}
      onView={noop}
      onToggleSelect={noop}
      onCopy={noop}
      onMove={noop}
      onRemove={noop}
      onMarkComingSoon={noop}
      onRemoveComingSoon={noop}
      onOpenArr={noop}
      {...props}
    />
  )
}

describe('ItemActionSheet', () => {
  it('offers Radarr/Sonarr to a role holder who is not an admin, without Coming Soon', () => {
    renderSheet({ isAdmin: false, arrActionLabel: 'Send to Radarr…' })
    expect(screen.getByRole('button', { name: 'Send to Radarr…' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Coming Soon/ })).toBeNull()
  })

  it('offers neither to a user whose roles do not allow it', () => {
    renderSheet({ isAdmin: false, arrActionLabel: null })
    expect(screen.queryByRole('button', { name: /Radarr|Sonarr/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Coming Soon/ })).toBeNull()
  })

  it('offers an admin both, Coming Soon only for a title not available yet', () => {
    const { unmount } = renderSheet({ isAdmin: true, arrActionLabel: 'Manage in Radarr…' })
    expect(screen.getByRole('button', { name: 'Manage in Radarr…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Mark as "Coming Soon"' })).toBeTruthy()
    unmount()

    renderSheet({ isAdmin: true, arrActionLabel: null, item: { ...unavailableMovie, isAvailable: true, url: '/list/movie/x' } })
    expect(screen.queryByRole('button', { name: /Coming Soon/ })).toBeNull()
  })

  it('offers no Coming Soon for a title with no TMDB id: that is what Coming Soon is kept by', () => {
    const removedLibraryTitle = {
      id: 'i2',
      tmdbId: null,
      libraryMediaId: 'mid:00000000000000aa',
      libraryMissing: true,
      title: 'A removed title',
      mediaType: 'movie',
      isAvailable: false,
    }
    renderSheet({ isAdmin: true, arrActionLabel: null, item: removedLibraryTitle })
    expect(screen.queryByRole('button', { name: /Coming Soon/ })).toBeNull()
    // It can still be taken off the list
    expect(screen.getByRole('button', { name: 'Remove from watchlist' })).toBeTruthy()
  })
})
