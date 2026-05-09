/**
 * Video availability utilities for flat database structure.
 *
 * @deprecated 2026-05-08 — All exports in this module have been replaced by
 *   `runPostSyncCleanup` in `postSyncCleanup.js`. The new orchestrator runs
 *   in-process using bulk MongoDB operations (~4 deleteMany calls vs the
 *   legacy 16k-element in-memory Map walk + per-orphan deleteOne pattern).
 *
 *   The functions here are kept as a reference for the predicate logic so
 *   auditors can diff the new bulk queries against the legacy per-entity
 *   loops. Each export now throws on call to surface forgotten callers
 *   loudly during testing.
 */

import { createLogger, logError } from '@src/lib/logger';
import { getRedisClient } from '@src/lib/redisClient';

const DEPRECATION_NOTICE =
  'Replaced by runPostSyncCleanup in postSyncCleanup.js. See JSDoc for migration details.';

/**
 * @deprecated Replaced by `runPostSyncCleanup` in postSyncCleanup.js (2026-05-08).
 *   Predicate translated to a single `deleteMany({ _id: { $in: [...] } })` after
 *   computing orphan ids in one in-memory pass. See `computeMovieDeletes` in
 *   postSyncCleanup.js for the new implementation.
 *
 *   DO NOT call this function. The export is preserved only so historical
 *   imports surface as a deprecation notice rather than an undefined error.
 *
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Current flat database structure (used to avoid additional DB queries)
 * @param {Object} fileServers - All file servers data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Results showing how many movies were removed
 */
async function cleanupMissingMovies(/* client, flatDB, fileServers, fieldAvailability */) {
  throw new Error(`cleanupMissingMovies is deprecated. ${DEPRECATION_NOTICE}`);

  /* LEGACY BODY (kept for predicate-equivalence review):
   *
   * const log = createLogger('FlatSync.VideoAvailability.Movies');
   * log.info('Checking for movies that do not exist in any file servers...');
   *
   * try {
   *   const allMovies = flatDB.movies || [];
   *   const removedMovies = [];
   *
   *   for (const movie of allMovies) {
   *     let foundInAnyServer = false;
   *     const serversWithMovie = [];
   *
   *     for (const [serverId, fileServer] of Object.entries(fileServers)) {
   *       if (fileServer.movies && (
   *           fileServer.movies[movie.title] ||
   *           (movie.originalTitle && fileServer.movies[movie.originalTitle])
   *         )) {
   *         foundInAnyServer = true;
   *         serversWithMovie.push(serverId);
   *       }
   *     }
   *
   *     let shouldRemove = !foundInAnyServer;
   *
   *     if (fieldAvailability?.movies?.[movie.title]) {
   *       const fieldPath = 'urls.mp4';
   *       const responsibleServers = fieldAvailability.movies[movie.title][fieldPath] || [];
   *
   *       if (responsibleServers.length > 0) {
   *         const isAvailableOnResponsibleServer = serversWithMovie.some(
   *           serverId => responsibleServers.includes(serverId)
   *         );
   *         if (!isAvailableOnResponsibleServer) shouldRemove = false;
   *       } else {
   *         shouldRemove = true;
   *       }
   *     }
   *
   *     if (shouldRemove) {
   *       await client.db('Media').collection('FlatMovies').deleteOne({ _id: movie._id });
   *       removedMovies.push({ title: movie.title });
   *     }
   *   }
   *
   *   return { moviesRemoved: removedMovies.length, details: removedMovies };
   * } catch (error) {
   *   logError(log, error, { context: 'cleanup_missing_movies' });
   *   return { moviesRemoved: 0, error: error.message };
   * }
   */
}

/**
 * @deprecated Replaced by `runPostSyncCleanup` in postSyncCleanup.js (2026-05-08).
 *   Predicate + cascade translated to `deleteMany` calls on FlatTVShows,
 *   FlatSeasons, and FlatEpisodes (split by index). See `computeShowDeletes`
 *   in postSyncCleanup.js for the new implementation.
 *
 *   DO NOT call this function.
 *
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Current flat database structure (used to avoid additional DB queries)
 * @param {Object} fileServers - All file servers data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Results showing how many shows were removed
 */
async function cleanupMissingTVShows(/* client, flatDB, fileServers, fieldAvailability */) {
  throw new Error(`cleanupMissingTVShows is deprecated. ${DEPRECATION_NOTICE}`);

  /* LEGACY BODY (kept for predicate-equivalence review):
   *
   * const log = createLogger('FlatSync.VideoAvailability.TVShows');
   * log.info('Checking for TV shows missing from file servers or lacking valid video URLs...');
   *
   * try {
   *   const allShows = flatDB.tv || [];
   *   const removedShows = [];
   *
   *   for (const show of allShows) {
   *     let foundInAnyServer = false;
   *     const serversWithShow = [];
   *     let hasValidVideoURLsInAnyServer = false;
   *
   *     for (const [serverId, fileServer] of Object.entries(fileServers)) {
   *       if (fileServer.tv) {
   *         const fileServerShowData = fileServer.tv[show.title] ||
   *             (show.originalTitle && fileServer.tv[show.originalTitle]);
   *         if (fileServerShowData) {
   *           foundInAnyServer = true;
   *           serversWithShow.push(serverId);
   *           if (hasTVShowValidVideoURLs(fileServerShowData)) {
   *             hasValidVideoURLsInAnyServer = true;
   *           }
   *         }
   *       }
   *     }
   *
   *     let shouldRemove = !foundInAnyServer || (foundInAnyServer && !hasValidVideoURLsInAnyServer);
   *
   *     if (foundInAnyServer && fieldAvailability?.tv?.[show.title]) {
   *       const showFieldPaths = Object.keys(fieldAvailability.tv[show.title]);
   *       const showLevelFields = showFieldPaths.filter(path =>
   *         !path.includes('seasons.') && !path.includes('episodes.')
   *       );
   *
   *       if (showLevelFields.length > 0) {
   *         let isResponsibleForAnyField = false;
   *         for (const fieldPath of showLevelFields) {
   *           const responsibleServers = fieldAvailability.tv[show.title][fieldPath] || [];
   *           if (responsibleServers.length === 0) { isResponsibleForAnyField = true; break; }
   *           const isResponsible = serversWithShow.some(
   *             serverId => responsibleServers.includes(serverId)
   *           );
   *           if (isResponsible) { isResponsibleForAnyField = true; break; }
   *         }
   *         if (!isResponsibleForAnyField && serversWithShow.length > 0) shouldRemove = false;
   *       }
   *     }
   *
   *     if (shouldRemove) {
   *       const showId = show._id;
   *       const showResult = await client.db('Media').collection('FlatTVShows').deleteOne({ _id: showId });
   *       const seasonsResult = await client.db('Media').collection('FlatSeasons').deleteMany({ showId });
   *       const episodesResult = await client.db('Media').collection('FlatEpisodes').deleteMany({ showId });
   *       removedShows.push({
   *         title: show.title,
   *         deletedSeasons: seasonsResult.deletedCount,
   *         deletedEpisodes: episodesResult.deletedCount,
   *       });
   *     }
   *   }
   *
   *   return { tvShowsRemoved: removedShows.length, details: removedShows };
   * } catch (error) {
   *   logError(log, error, { context: 'cleanup_missing_tv_shows' });
   *   return { tvShowsRemoved: 0, error: error.message };
   * }
   */
}

/**
 * @deprecated Replaced by `runPostSyncCleanup` in postSyncCleanup.js (2026-05-08).
 *   Predicate + cascade translated to `deleteMany` calls on FlatSeasons and
 *   FlatEpisodes. See `computeSeasonDeletes` in postSyncCleanup.js for the
 *   new implementation.
 *
 *   DO NOT call this function.
 *
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Current flat database structure (used to avoid additional DB queries)
 * @param {Object} fileServers - All file servers data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Results showing how many seasons were removed
 */
async function cleanupMissingSeasons(/* client, flatDB, fileServers, fieldAvailability */) {
  throw new Error(`cleanupMissingSeasons is deprecated. ${DEPRECATION_NOTICE}`);

  /* LEGACY BODY (kept for predicate-equivalence review):
   *
   * const log = createLogger('FlatSync.VideoAvailability.Seasons');
   * log.info('Checking for seasons missing from file servers...');
   *
   * try {
   *   const allSeasons = [];
   *   if (flatDB.tv) {
   *     for (const show of flatDB.tv) {
   *       if (show.seasons) {
   *         for (const season of show.seasons) {
   *           allSeasons.push({ ...season, showOriginalTitle: show.originalTitle });
   *         }
   *       }
   *     }
   *   }
   *   const removedSeasons = [];
   *
   *   for (const season of allSeasons) {
   *     let foundInAnyServer = false;
   *     const serversWithSeason = [];
   *
   *     for (const [serverId, fileServer] of Object.entries(fileServers)) {
   *       if (fileServer.tv) {
   *         const fileServerShowData = fileServer.tv[season.showOriginalTitle];
   *         if (fileServerShowData && fileServerShowData.seasons) {
   *           const seasonKey = `Season ${season.seasonNumber}`;
   *           if (fileServerShowData.seasons[seasonKey]) {
   *             foundInAnyServer = true;
   *             serversWithSeason.push(serverId);
   *           }
   *         }
   *       }
   *     }
   *
   *     let shouldRemove = !foundInAnyServer;
   *
   *     if (foundInAnyServer && fieldAvailability?.tv?.[season.showTitle]) {
   *       const seasonFieldPath = `seasons.Season ${season.seasonNumber}`;
   *       const showFieldPaths = Object.keys(fieldAvailability.tv[season.showTitle]);
   *       const seasonFields = showFieldPaths.filter(path => path.startsWith(seasonFieldPath));
   *
   *       if (seasonFields.length > 0) {
   *         let isResponsibleForAnyField = false;
   *         for (const fieldPath of seasonFields) {
   *           const responsibleServers = fieldAvailability.tv[season.showTitle][fieldPath] || [];
   *           if (responsibleServers.length === 0) { isResponsibleForAnyField = true; break; }
   *           const isResponsible = serversWithSeason.some(
   *             serverId => responsibleServers.includes(serverId)
   *           );
   *           if (isResponsible) { isResponsibleForAnyField = true; break; }
   *         }
   *         if (!isResponsibleForAnyField && serversWithSeason.length > 0) shouldRemove = false;
   *       }
   *     }
   *
   *     if (shouldRemove) {
   *       const seasonId = season._id;
   *       await client.db('Media').collection('FlatSeasons').deleteOne({ _id: seasonId });
   *       const episodesResult = await client.db('Media').collection('FlatEpisodes').deleteMany({ seasonId });
   *       removedSeasons.push({
   *         showTitle: season.showTitle,
   *         seasonNumber: season.seasonNumber,
   *         deletedEpisodes: episodesResult.deletedCount,
   *       });
   *     }
   *   }
   *
   *   return { seasonsRemoved: removedSeasons.length, details: removedSeasons };
   * } catch (error) {
   *   logError(log, error, { context: 'cleanup_missing_seasons' });
   *   return { seasonsRemoved: 0, error: error.message };
   * }
   */
}

/**
 * @deprecated Replaced by `runPostSyncCleanup` in postSyncCleanup.js (2026-05-08).
 *   Predicate translated to a single `deleteMany({ _id: { $in: [...] } })`.
 *   See `computeEpisodeDeletes` in postSyncCleanup.js for the new
 *   implementation.
 *
 *   DO NOT call this function.
 *
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Current flat database structure (used to avoid additional DB queries)
 * @param {Object} fileServers - All file servers data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Results showing how many episodes were removed
 */
async function cleanupMissingEpisodes(/* client, flatDB, fileServers, fieldAvailability */) {
  throw new Error(`cleanupMissingEpisodes is deprecated. ${DEPRECATION_NOTICE}`);

  /* LEGACY BODY (kept for predicate-equivalence review):
   *
   * const log = createLogger('FlatSync.VideoAvailability.Episodes');
   * log.info('Checking for episodes missing from file servers...');
   *
   * try {
   *   const allEpisodes = [];
   *   if (flatDB.tv) {
   *     for (const show of flatDB.tv) {
   *       if (show.seasons) {
   *         for (const season of show.seasons) {
   *           if (season.episodes) {
   *             for (const episode of season.episodes) {
   *               allEpisodes.push({ ...episode, showOriginalTitle: show.originalTitle });
   *             }
   *           }
   *         }
   *       }
   *     }
   *   }
   *   const removedEpisodes = [];
   *
   *   for (const episode of allEpisodes) {
   *     let foundInAnyServer = false;
   *     const serversWithEpisode = [];
   *
   *     for (const [serverId, fileServer] of Object.entries(fileServers)) {
   *       if (fileServer.tv) {
   *         const fileServerShowData = fileServer.tv[episode.showOriginalTitle];
   *         if (fileServerShowData && fileServerShowData.seasons) {
   *           const seasonKey = `Season ${episode.seasonNumber}`;
   *           const seasonData = fileServerShowData.seasons[seasonKey];
   *           if (seasonData && seasonData.episodes) {
   *             const paddedSeason = String(episode.seasonNumber).padStart(2, '0');
   *             const paddedEpisode = String(episode.episodeNumber).padStart(2, '0');
   *             const episodeKey = `S${paddedSeason}E${paddedEpisode}`;
   *             if (seasonData.episodes[episodeKey]) {
   *               foundInAnyServer = true;
   *               serversWithEpisode.push(serverId);
   *             }
   *           }
   *         }
   *       }
   *     }
   *
   *     let shouldRemove = !foundInAnyServer;
   *
   *     if (foundInAnyServer && fieldAvailability?.tv?.[episode.showTitle]) {
   *       const episodeFieldPath = `seasons.Season ${episode.seasonNumber}.episodes.S${
   *         String(episode.seasonNumber).padStart(2, '0')
   *       }E${String(episode.episodeNumber).padStart(2, '0')}`;
   *       const showFieldPaths = Object.keys(fieldAvailability.tv[episode.showTitle]);
   *       const episodeFields = showFieldPaths.filter(path => path.startsWith(episodeFieldPath));
   *
   *       if (episodeFields.length > 0) {
   *         let isResponsibleForAnyField = false;
   *         for (const fieldPath of episodeFields) {
   *           const responsibleServers = fieldAvailability.tv[episode.showTitle][fieldPath] || [];
   *           if (responsibleServers.length === 0) { isResponsibleForAnyField = true; break; }
   *           const isResponsible = serversWithEpisode.some(
   *             serverId => responsibleServers.includes(serverId)
   *           );
   *           if (isResponsible) { isResponsibleForAnyField = true; break; }
   *         }
   *         if (!isResponsibleForAnyField && serversWithEpisode.length > 0) shouldRemove = false;
   *       }
   *     }
   *
   *     if (shouldRemove) {
   *       await client.db('Media').collection('FlatEpisodes').deleteOne({ _id: episode._id });
   *       removedEpisodes.push({
   *         showTitle: episode.showTitle,
   *         seasonNumber: episode.seasonNumber,
   *         episodeNumber: episode.episodeNumber,
   *         title: episode.title,
   *       });
   *     }
   *   }
   *
   *   return { episodesRemoved: removedEpisodes.length, details: removedEpisodes };
   * } catch (error) {
   *   logError(log, error, { context: 'cleanup_missing_episodes' });
   *   return { episodesRemoved: 0, error: error.message };
   * }
   */
}

/**
 * Clears Redis cache entries related to removed content.
 *
 * Note: an inlined copy of this lives in postSyncCleanup.js (the new
 * orchestrator's cache-invalidation phase). Kept here so legacy callers can
 * still resolve the symbol; behavior is unchanged.
 *
 * @param {Object} removedContent - Content that was removed
 * @returns {Promise<Object>} Cache clearing results
 */
async function clearCacheEntries(removedContent) {
  const log = createLogger('FlatSync.VideoAvailability.Cache');
  const redisClient = await getRedisClient();
  if (!redisClient) {
    log.info('Redis not configured. Skipping cache clearing.');
    return { cleared: 0, errors: 0 };
  }

  const results = { cleared: 0, errors: 0, details: [] };

  try {
    log.info('Clearing Redis cache entries for removed content...');

    for (const movieTitle of removedContent.movies) {
      try {
        const movieCacheKeys = [
          `movie:${movieTitle}*`,
          `metadata:movie:${movieTitle}*`,
          `blurhash:movie:${movieTitle}*`,
          `poster:movie:${movieTitle}*`,
          `backdrop:movie:${movieTitle}*`,
        ];
        for (const pattern of movieCacheKeys) {
          const keys = await redisClient.keys(pattern);
          if (keys.length > 0) {
            await redisClient.del(keys);
            results.cleared += keys.length;
            results.details.push(`Cleared ${keys.length} cache entries for movie "${movieTitle}" with pattern ${pattern}`);
          }
        }
      } catch (error) {
        logError(log, error, { movieTitle, context: 'clear_cache_movie' });
        results.errors++;
      }
    }

    for (const showTitle of removedContent.tvShows) {
      try {
        const showCacheKeys = [
          `tv:${showTitle}*`,
          `metadata:tv:${showTitle}*`,
          `blurhash:tv:${showTitle}*`,
          `poster:tv:${showTitle}*`,
          `backdrop:tv:${showTitle}*`,
          `season:${showTitle}*`,
          `episode:${showTitle}*`,
        ];
        for (const pattern of showCacheKeys) {
          const keys = await redisClient.keys(pattern);
          if (keys.length > 0) {
            await redisClient.del(keys);
            results.cleared += keys.length;
            results.details.push(`Cleared ${keys.length} cache entries for TV show "${showTitle}" with pattern ${pattern}`);
          }
        }
      } catch (error) {
        logError(log, error, { showTitle, context: 'clear_cache_tv_show' });
        results.errors++;
      }
    }

    for (const seasonTitle of removedContent.tvSeasons || []) {
      try {
        const seasonMatch = seasonTitle.match(/^(.+) Season (\d+)$/);
        if (seasonMatch) {
          const [, showTitle, seasonNumber] = seasonMatch;
          const seasonCacheKeys = [
            `season:${showTitle}:${seasonNumber}*`,
            `metadata:season:${showTitle}:${seasonNumber}*`,
            `blurhash:season:${showTitle}:${seasonNumber}*`,
            `poster:season:${showTitle}:${seasonNumber}*`,
          ];
          for (const pattern of seasonCacheKeys) {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
              await redisClient.del(keys);
              results.cleared += keys.length;
              results.details.push(`Cleared ${keys.length} cache entries for season "${seasonTitle}" with pattern ${pattern}`);
            }
          }
        }
      } catch (error) {
        logError(log, error, { seasonTitle, context: 'clear_cache_season' });
        results.errors++;
      }
    }

    for (const episodeTitle of removedContent.tvEpisodes || []) {
      try {
        const episodeMatch = episodeTitle.match(/^(.+) S(\d+)E(\d+)$/);
        if (episodeMatch) {
          const [, showTitle, seasonNumber, episodeNumber] = episodeMatch;
          const episodeCacheKeys = [
            `episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
            `metadata:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
            `blurhash:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
            `thumbnail:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
          ];
          for (const pattern of episodeCacheKeys) {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
              await redisClient.del(keys);
              results.cleared += keys.length;
              results.details.push(`Cleared ${keys.length} cache entries for episode "${episodeTitle}" with pattern ${pattern}`);
            }
          }
        }
      } catch (error) {
        logError(log, error, { episodeTitle, context: 'clear_cache_episode' });
        results.errors++;
      }
    }

    log.info({ cleared: results.cleared, errors: results.errors }, 'Cache clearing complete');
    return results;
  } catch (error) {
    logError(log, error, { context: 'cache_clearing' });
    return { cleared: 0, errors: 1, details: [error.message] };
  }
}

/**
 * @deprecated Replaced by `runPostSyncCleanup` in postSyncCleanup.js (2026-05-08).
 *   The orchestration of the four `cleanupMissing*` functions has moved to
 *   `runPostSyncCleanup`, which uses bulk MongoDB operations. The whole
 *   `buildEnhancedFlatDBStructure` pre-step is gone — the new orchestrator
 *   does its own projection-only finds and computes orphan ids in memory.
 *
 *   DO NOT call this function.
 *
 * @param {Object} flatDB - Current database state from buildFlatDBStructure
 * @param {Object} fileServers - All file servers data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Results of the operation
 */
export async function checkAndRemoveUnavailableVideosFlat(/* flatDB, fileServers, fieldAvailability */) {
  throw new Error(`checkAndRemoveUnavailableVideosFlat is deprecated. ${DEPRECATION_NOTICE}`);

  /* LEGACY BODY (kept for orchestration-shape review):
   *
   * const client = await clientPromise;
   * const log = createLogger('FlatSync.VideoAvailability');
   * try {
   *   const missingTVShowsResults = await cleanupMissingTVShows(client, flatDB, fileServers, fieldAvailability);
   *   const missingSeasonsResults = await cleanupMissingSeasons(client, flatDB, fileServers, fieldAvailability);
   *   const missingEpisodesResults = await cleanupMissingEpisodes(client, flatDB, fileServers, fieldAvailability);
   *   const missingMoviesResults = await cleanupMissingMovies(client, flatDB, fileServers, fieldAvailability);
   *
   *   const results = {
   *     removed: {
   *       movies: missingMoviesResults.details.map(item => item.title),
   *       tvShows: missingTVShowsResults.details.map(item => item.title),
   *       tvSeasons: missingSeasonsResults.details.map(item => `${item.showTitle} Season ${item.seasonNumber}`),
   *       tvEpisodes: missingEpisodesResults.details.map(item => `${item.showTitle} S${item.seasonNumber}E${item.episodeNumber}`),
   *     },
   *     errors: { movies: [], tvShows: [], tvSeasons: [], tvEpisodes: [] },
   *     cache: null,
   *   };
   *
   *   if (results.removed.movies.length || results.removed.tvShows.length ||
   *       results.removed.tvSeasons.length || results.removed.tvEpisodes.length) {
   *     results.cache = await clearCacheEntries(results.removed);
   *   }
   *
   *   return results;
   * } catch (error) {
   *   logError(log, error, { context: 'check_and_remove' });
   *   return {
   *     removed: { movies: [], tvShows: [], tvSeasons: [], tvEpisodes: [] },
   *     errors: { general: { message: error.message, stack: error.stack } },
   *   };
   * }
   */
}

// Exports preserved so historical imports continue to resolve. Each export
// throws on call — see individual @deprecated JSDoc.
export {
  cleanupMissingMovies,
  cleanupMissingTVShows,
  cleanupMissingSeasons,
  cleanupMissingEpisodes,
  clearCacheEntries,
};
