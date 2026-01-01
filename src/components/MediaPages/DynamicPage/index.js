/**
 * Dynamic Page Components
 * 
 * Barrel export for all dynamic page-related components
 */

// Guards
export { AuthGuard, handleLimitedAccess, hasLimitedAccess } from './guards'

// Errors
export { MediaNotFound, NotFoundHeader, NotFoundContent } from './errors'

// Views
export {
  MoviePlayerView,
  MovieDetailsView,
  TVEpisodePlayerView,
  TVEpisodeDetailsView,
  TVSeasonView,
  TVShowView,
  MovieListView,
  TVListView,
} from './views'