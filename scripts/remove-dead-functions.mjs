/**
 * Script to remove dead function bodies that knip:fix de-exported.
 * These functions are confirmed dead: not exported AND not used internally.
 * Removes the function body + any preceding JSDoc block comment.
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(import.meta.dirname, '..')

// Map of file -> array of symbol names to fully delete (round 2 - newly exposed after round 1)
const DEAD_SYMBOLS = {
  'src/utils/accountDeletion.js': ['getReadyForDeletion'],
  'src/utils/cache/invalidation.js': ['invalidateUserPlaylistsCache', 'invalidateStaticContentCache'],
  'src/utils/deletionEmailService.js': ['sendDeletionReminder'],
  'src/utils/sync_utils.js': ['processEpisodeVideoInfo'],
  'src/utils/sync/captions.js': [
    'gatherMovieCaptionsForAllServers',
    'finalizeMovieCaptions',
    'gatherSeasonCaptionsForAllServers',
    'finalizeSeasonCaptions',
  ],
  'src/utils/sync/featureFlags.js': ['getFeatureFlagStatus'],
  'src/utils/tmdb/client.js': ['getAccurateDuration', 'formatDuration'],
  'src/utils/watchlist/index.js': ['getRecentWatchlistAdditions'],
}

// DEAD_SYMBOLS_ROUND1 kept for reference
const _DEAD_SYMBOLS_ROUND1 = {
  'src/app/(styled)/list/collection/[collectionId]/cachedFetchers.js': [
    'getCachedOwnedMovies',
    'getCachedEnhancedCollectionDetails',
  ],
  'src/components/MediaPages/DynamicPage/guards/LimitedAccessHandler.js': ['hasLimitedAccess'],
  'src/contexts/NotificationContext.jsx': ['useNotifications'],
  'src/hooks/useNotifications.js': ['useUnreadCount'],
  'src/lib/cache.js': ['clearCache', 'getCacheBatch', 'setCacheBatch', 'clearCacheBatch'],
  'src/lib/httpHelper.js': ['fetchImageAsBuffer', 'createImageStream'],
  'src/utils/admin_frontend_database.js': ['deleteMediaUpdates'],
  'src/utils/auth_database.js': ['getPosters', 'getRecentlyAddedMedia', 'fetchRecentlyAdded'],
  'src/utils/cache/invalidation.js': [
    'invalidatePlaylistDataCache',
    'invalidateAllLandingPageCache',
    'invalidateAllMediaDetailsCache',
  ],
  'src/utils/config.js': [
    'isCurrentServerHigherPriority',
    'getServerCount',
    'getDefaultServer',
    'fileServerURL',
    'fileServerURLWithoutPrefixPath',
  ],
  'src/utils/deletionEmailService.js': ['scheduleReminderNotifications', 'processAutomaticDeletions'],
  'src/utils/deviceDetection.js': [
    'updatePlaybackDeviceInfo',
    'getDeviceTypeLabel',
    'getDeviceIcon',
    'isMobileDevice',
    'isValidDeviceInfo',
    'testDeviceDetection',
    'getDefaultTestCases',
    'getBrowserTestCases',
    'getTVManufacturerTestCases',
  ],
  'src/utils/flatDatabaseUtils.js': [
    'getFlatMoviesLastUpdatedTimestamp',
    'getFlatTVShowsLastUpdatedTimestamp',
  ],
  'src/utils/flatSync/blurhashSync.js': ['detectBlurhashEndpointCapabilities'],
  'src/utils/flatSync/episodes/database.js': [
    'getEpisodeByIdFromFlatDB',
    'getAllEpisodesForSeasonFromFlatDB',
  ],
  'src/utils/flatSync/hashStorage.js': ['getAllStoredHashes'],
  'src/utils/flatSync/index.js': ['checkAvailabilityAcrossAllServers'],
  'src/utils/flatSync/movies/database.js': ['getMovieFromFlatDB', 'createMovieInFlatDB'],
  'src/utils/flatSync/newArchitectureAdapter.js': ['compareArchitecturePerformance'],
  'src/utils/flatSync/seasons/database.js': [
    'getSeasonByIdFromFlatDB',
    'getAllSeasonsForShowFromFlatDB',
  ],
  'src/utils/flatSync/tvShows/database.js': ['getTVShowByIdFromFlatDB'],
  'src/utils/flatSync/videoAvailability.js': [
    'cleanupMissingMovies',
    'cleanupMissingTVShows',
    'cleanupMissingSeasons',
    'cleanupMissingEpisodes',
    'clearCacheEntries',
  ],
  'src/utils/flatSync/watchHistoryValidation.js': ['validateUserWatchHistory'],
  'src/utils/index.js': ['convertToPlainObjects', 'convertToDate', 'formatTime'],
  'src/utils/media/mediaFetcher.js': ['fetchMediaWithRedirect'],
  'src/utils/media/metadataBuilder.js': ['buildMetadataBreadcrumbs'],
  'src/utils/media/urlParser.js': ['extractSeasonNumber', 'extractEpisodeNumber'],
  'src/utils/mediaListUtils/shared.js': [
    'parseCommaSeparated',
    'extractUniqueGenres',
    'extractUniqueHdrTypes',
  ],
  'src/utils/notifications/notificationDatabase.js': [
    'cleanupOldNotifications',
    'getNotificationById',
  ],
  'src/utils/rateLimiter.js': ['default'],
  'src/utils/recommendations/filters.js': ['filterByMinimumScore', 'filterExcludeBlacklist'],
  'src/utils/recommendations/scoring.js': ['calculateCompletionScore'],
  'src/utils/routeAuth.js': ['isAuthenticatedBySessionId', 'getUserById'],
  'src/utils/sync.js': ['syncMissingMedia'],
  'src/utils/sync/captions.js': ['syncCaptions'],
  'src/utils/sync/featureFlags.js': ['validateFeatureFlagConfig', 'withFeatureFlagOverride'],
  'src/utils/sync/fileServer.js': ['identifyMissingMedia'],
  'src/utils/sync/SyncManager.ts': [
    'syncMoviesWithNewArchitecture',
    'getSyncSystemStats',
    'cleanupMovies',
    'syncTVShowsWithNewArchitecture',
  ],
  'src/utils/sync/core/fieldPaths.ts': ['isValidMovieFieldPath'],
  'src/utils/sync/core/logSanitizer.ts': ['createEntitySummary'],
  'src/utils/sync/core/logger.ts': ['logError', 'logWarn', 'logInfo', 'logDebug', 'logProgress', 'logBatch'],
  'src/utils/sync/core/validation.ts': [
    'validateVideoInfo',
    'validateCaptionTracks',
    'validateChapterMarkers',
  ],
  'src/utils/sync/domain/seasons/SeasonSyncService.ts': ['SeasonSyncService'],
  'src/utils/sync/domain/seasons/strategies/SeasonMetadataStrategy.ts': ['SeasonMetadataStrategy'],
  'src/utils/sync/domain/seasons/strategies/SeasonPosterStrategy.ts': ['SeasonPosterStrategy'],
  'src/utils/sync/domain/tvShows/TVShowSyncService.ts': ['TVShowSyncService'],
  'src/utils/sync/domain/tvShows/strategies/TVShowAssetStrategy.ts': ['TVShowAssetStrategy'],
  'src/utils/sync/domain/tvShows/strategies/TVShowMetadataStrategy.ts': ['TVShowMetadataStrategy'],
  'src/utils/sync_db.js': ['setFileServerImportSettings'],
  'src/utils/sync_utils.js': [
    'processSeasonMetadata',
    'processMovieCaptions',
    'gatherSeasonCaptionsForAllServers',
    'finalizeSeasonCaptions',
    'processSeasonCaptions',
    'processSeasonVideoInfo',
  ],
  'src/utils/tmdb/client.js': [
    'getMediaDetails',
    'getEnhancedMediaDetails',
    'searchCollections',
    'getCollectionImages',
    'getCast',
    'getVideos',
    'getImages',
    'getRating',
    'getEpisodeDetails',
    'getEpisodeImages',
    'getTMDBImageURL',
    'isTMDBAvailable',
    'getFormattedDuration',
    'getDurationWithSource',
    'TMDB_CONSTANTS',
  ],
  'src/utils/watchHistory/database.js': [
    'getPlaybackForUser',
    'getPlaybackForVideo',
    'getRecentlyWatchedForUser',
    'getUsersWhoWatched',
    'getViewCount',
    'deletePlaybackForUser',
    'bulkUpdateValidationStatus',
    'clearValidationForUser',
    'getBulkPlaybackForUsers',
  ],
  'src/utils/watchHistory/metadata.js': [
    'buildPlaybackMetadata',
    'isMetadataValid',
    'formatMetadataForLogging',
  ],
  'src/utils/watchHistory/validation.js': [
    'validateAllPlaybackEntries',
    'validateUserPlaybackEntries',
    'validateAndUpdatePlaybackUrl',
    'needsValidation',
    'markPlaybackAsNeedingValidation',
  ],
  'src/utils/watchHistoryServerUtils.ts': ['getWatchDataForVideo', 'hasWatchedVideo'],
  'src/utils/watchlist/database.js': ['getFullMediaDocumentsForPlaylist'],
  'src/utils/watchlist/index.js': [
    'getCurrentUserId',
    'getWatchlistCount',
    'isInWatchlist',
    'searchWatchlist',
    'prepareWatchlistItem',
    'getWatchlistSummary',
    'createNewPlaylist',
    'getFormattedPlaylists',
    'getPlaylistWithItems',
  ],
  'src/utils/watchlist/mediaResolver.js': ['clearMediaCache', 'scheduleBackgroundUpdate'],
}

/**
 * Given file source and a symbol name, remove:
 *  - any JSDoc block comment immediately preceding the declaration
 *  - the declaration itself (function/const/class/variable) with its full body
 * Returns the modified source.
 */
function removeSymbol(source, name) {
  const lines = source.split('\n')
  const result = []
  let i = 0
  let removed = 0

  while (i < lines.length) {
    const line = lines[i]

    // Detect the start of the target declaration.
    // Patterns: (async )?function name, const name =, class name, export variations too
    const declPattern = new RegExp(
      `^(?:export\\s+)?(?:(?:async\\s+)?function\\*?\\s+${name}\\b|(?:const|let|var|class)\\s+${name}\\b|(?:async\\s+)?${name}\\s*=)`,
    )

    if (declPattern.test(line.trim())) {
      // Walk back through result[] to strip a preceding JSDoc comment
      while (
        result.length > 0 &&
        (result[result.length - 1].trim() === '' ||
          result[result.length - 1].trim().startsWith('*') ||
          result[result.length - 1].trim().startsWith('/**') ||
          result[result.length - 1].trim().startsWith('*/') ||
          result[result.length - 1].trim().startsWith('// '))
      ) {
        const top = result[result.length - 1].trim()
        result.pop()
        // Stop popping once we've consumed the opening /**
        if (top.startsWith('/**') || (!top.startsWith('*') && !top.startsWith('//') && top !== '')) break
      }

      // Now consume lines until braces balance back to 0 (or until a top-level semi/next decl for simple one-liners)
      let depth = 0
      let started = false
      let j = i

      while (j < lines.length) {
        const l = lines[j]
        for (const ch of l) {
          if (ch === '{') { depth++; started = true }
          else if (ch === '}') { depth-- }
        }
        j++
        // For arrow functions / const = value; that have no braces, stop at semicolon-terminated line
        if (!started && l.trimEnd().endsWith(';')) { break }
        if (started && depth === 0) { break }
        // Safety: if line ends with }) or }); treat as closed
        if (started && depth <= 0) { break }
      }

      removed++
      i = j
      // Skip a single blank line after the removed block
      if (i < lines.length && lines[i].trim() === '') i++
      continue
    }

    result.push(line)
    i++
  }

  if (removed === 0) {
    console.warn(`  ⚠  Could not find "${name}" in file`)
  } else {
    console.log(`  ✓  Removed "${name}"`)
  }

  return result.join('\n')
}

let totalFiles = 0
let totalRemoved = 0

for (const [relPath, names] of Object.entries(DEAD_SYMBOLS)) {
  const absPath = resolve(ROOT, relPath)
  let source
  try {
    source = readFileSync(absPath, 'utf8')
  } catch {
    console.warn(`⚠  File not found, skipping: ${relPath}`)
    continue
  }

  console.log(`\n📄 ${relPath}`)
  const before = source
  for (const name of names) {
    source = removeSymbol(source, name)
  }

  if (source !== before) {
    writeFileSync(absPath, source, 'utf8')
    totalFiles++
    totalRemoved += names.length
  }
}

console.log(`\n✅ Done. Cleaned ${totalFiles} files, removed up to ${totalRemoved} dead declarations.`)
console.log('Run `npm run knip` to verify.')
