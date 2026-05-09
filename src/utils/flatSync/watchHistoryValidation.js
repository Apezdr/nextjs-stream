import { createLogger, logError } from '@src/lib/logger'
import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { findPlaybackForUser, updateValidationStatus } from '@src/utils/watchHistory/database'

/**
 * Validates all WatchHistory records against the current state of the database
 * after sync and availability checks have completed. Marks records' `isValid`
 * flag based on whether their normalizedVideoId still exists in FlatMovies or
 * FlatEpisodes.
 *
 * Rewritten 2026-05-08: replaced ~3.5k per-record `updateOne` calls with two
 * `updateMany` operations + a small remediation pass for records missing
 * `normalizedVideoId`. Legacy per-record body preserved in a block comment
 * below for predicate-equivalence review.
 *
 * Scaling note: at >~100k WatchHistory records, the `$nin` arm of the second
 * updateMany degrades (no index help for non-membership). At that point switch
 * to a marker-field design — set `lastValidatedAt: <syncRunId>` on records
 * found valid, then `updateMany({ lastValidatedAt: { $ne: syncRunId } })` to
 * flip the rest. Don't pay that schema-migration cost preemptively.
 *
 * @returns {Promise<Object>} Validation results
 */
export async function validateWatchHistoryAgainstDatabase() {
  const log = createLogger('FlatSync.WatchHistoryValidation');
  log.info('Starting WatchHistory validation against cleaned database...');

  const client = await clientPromise;
  const db = client.db('Media');

  const results = {
    processed: 0,
    markedValid: 0,
    markedInvalid: 0,
    alreadyValid: 0,
    errors: []
  };

  try {
    const watchHistoryCollection = db.collection('WatchHistory');
    const flatMoviesCollection = db.collection('FlatMovies');
    const flatEpisodesCollection = db.collection('FlatEpisodes');

    // Build the union of valid identifiers — videoURLs and normalizedVideoIds
    // from FlatMovies and FlatEpisodes. Uses the existing covered index
    // `videoURL_normalizedId_covered_index` (initializeDatabase.js:99,172),
    // so this is index-only.
    const validIds = new Set();
    const proj = { projection: { _id: 0, videoURL: 1, normalizedVideoId: 1 } };
    const movieCursor = flatMoviesCollection.find({}, proj);
    for await (const d of movieCursor) {
      if (d.videoURL)          validIds.add(d.videoURL);
      if (d.normalizedVideoId) validIds.add(d.normalizedVideoId);
    }
    const episodeCursor = flatEpisodesCollection.find({}, proj);
    for await (const d of episodeCursor) {
      if (d.videoURL)          validIds.add(d.videoURL);
      if (d.normalizedVideoId) validIds.add(d.normalizedVideoId);
    }
    const validArr = [...validIds];
    const now = new Date().toISOString();
    log.info({ validIdCount: validArr.length }, 'Built validation lookup set');

    // Two bulk updates — one for now-valid, one for now-invalid. The $ne
    // predicate ensures we only touch records whose state is changing,
    // matching the legacy behavior.
    //
    // Both arms match solely on `normalizedVideoId`, which is served by
    // `normalizedVideoId_index`. This relies on FlatMovies/FlatEpisodes
    // writers producing the same 16-char SHA-256 prefix as
    // `flatDatabaseUtils.generateNormalizedVideoId` — see the 2026-05-09 fix
    // in MovieContentStrategy.generateNormalizedVideoId, which removed an
    // `_id` short-circuit that broke this invariant.
    const validResult = await watchHistoryCollection.updateMany(
      { normalizedVideoId: { $in:  validArr }, isValid: { $ne: true  } },
      { $set: { isValid: true,  lastScanned: now } }
    );
    const invalidResult = await watchHistoryCollection.updateMany(
      { normalizedVideoId: { $nin: validArr }, isValid: { $ne: false } },
      { $set: { isValid: false, lastScanned: now } }
    );

    results.markedValid   = validResult.modifiedCount;
    results.markedInvalid = invalidResult.modifiedCount;

    // Remediation pass for records missing `normalizedVideoId` — preserves
    // legacy per-record fixup at watchHistoryValidation.js:93-104. Expected
    // count: single digits, so a per-record loop is acceptable here.
    const remediationCursor = watchHistoryCollection.find(
      { normalizedVideoId: { $exists: false } },
      { projection: { _id: 1, videoId: 1 } }
    );
    let remediated = 0;
    for await (const r of remediationCursor) {
      try {
        const nid = generateNormalizedVideoId(r.videoId);
        await watchHistoryCollection.updateOne(
          { _id: r._id },
          { $set: {
            normalizedVideoId: nid,
            isValid: validIds.has(nid),
            lastScanned: now,
          } }
        );
        remediated++;
      } catch (error) {
        logError(log, error, {
          recordId: r._id instanceof ObjectId ? r._id.toString() : r._id,
          context: 'remediate_missing_normalized_id'
        });
        results.errors.push({
          recordId: r._id instanceof ObjectId ? r._id.toString() : r._id,
          error: error.message,
        });
      }
    }

    results.processed = results.markedValid + results.markedInvalid + remediated;

    log.info({
      markedValid: results.markedValid,
      markedInvalid: results.markedInvalid,
      remediated,
      errorCount: results.errors.length
    }, 'WatchHistory validation complete');

    return results;

  } catch (error) {
    logError(log, error, { context: 'bulk_validation' });
    results.errors.push({
      general: true,
      error: error.message,
      stack: error.stack
    });
    return results;
  }
}

/* LEGACY BODY (preserved for review — see JSDoc above):
 *
 * Replaced 2026-05-08 with the two-`updateMany` form. The function below
 * loaded all WatchHistory records, all valid videoURL/normalizedVideoId
 * values, and walked records issuing one `updateOne` per state change —
 * ~3.5k per-record roundtrips per sync cycle. The new code is two
 * `updateMany` calls + a remediation pass.
 *
 * async function validateWatchHistoryAgainstDatabase_LEGACY() {
 *   const log = createLogger('FlatSync.WatchHistoryValidation');
 *   log.info('Starting WatchHistory validation against cleaned database...');
 *   const client = await clientPromise;
 *   const db = client.db('Media');
 *   const results = { processed: 0, markedValid: 0, markedInvalid: 0, alreadyValid: 0, errors: [] };
 *   try {
 *     const watchHistoryCollection = db.collection('WatchHistory');
 *     const flatMoviesCollection = db.collection('FlatMovies');
 *     const flatEpisodesCollection = db.collection('FlatEpisodes');
 *     const movieVideoUrls = new Set();
 *     const movieCursor = flatMoviesCollection.find({}, { projection: { _id: 0, videoURL: 1, normalizedVideoId: 1 } });
 *     for await (const movie of movieCursor) {
 *       if (movie.videoURL) {
 *         movieVideoUrls.add(movie.videoURL);
 *         if (movie.normalizedVideoId) movieVideoUrls.add(movie.normalizedVideoId);
 *       }
 *     }
 *     const tvVideoUrls = new Set();
 *     const episodeCursor = flatEpisodesCollection.find({}, { projection: { _id: 0, videoURL: 1, normalizedVideoId: 1 } });
 *     for await (const episode of episodeCursor) {
 *       if (episode.videoURL) {
 *         tvVideoUrls.add(episode.videoURL);
 *         if (episode.normalizedVideoId) tvVideoUrls.add(episode.normalizedVideoId);
 *       }
 *     }
 *     const allValidVideoUrls = new Set([...movieVideoUrls, ...tvVideoUrls]);
 *     const watchHistoryRecords = await getAllPlaybackEntries();
 *     results.processed = watchHistoryRecords.length;
 *     for (const record of watchHistoryRecords) {
 *       try {
 *         const { videoId, normalizedVideoId, isValid: currentIsValid } = record;
 *         let isValidInDatabase = false;
 *         if (allValidVideoUrls.has(videoId)) {
 *           isValidInDatabase = true;
 *         } else if (normalizedVideoId && allValidVideoUrls.has(normalizedVideoId)) {
 *           isValidInDatabase = true;
 *         } else {
 *           const generatedNormalizedId = generateNormalizedVideoId(videoId);
 *           if (allValidVideoUrls.has(generatedNormalizedId)) {
 *             isValidInDatabase = true;
 *             if (!normalizedVideoId) {
 *               await watchHistoryCollection.updateOne(
 *                 { _id: record._id },
 *                 { $set: { normalizedVideoId: generatedNormalizedId } }
 *               );
 *             }
 *           }
 *         }
 *         if (isValidInDatabase && currentIsValid !== true) {
 *           await updateValidationStatus({ userId: record.userId, normalizedVideoId: record.normalizedVideoId, isValid: { $ne: false } });
 *           results.markedValid++;
 *         } else if (!isValidInDatabase && currentIsValid !== false) {
 *           await updateValidationStatus({ userId: record.userId, normalizedVideoId: record.normalizedVideoId, isValid: false });
 *           results.markedInvalid++;
 *         } else if (currentIsValid === isValidInDatabase) {
 *           results.alreadyValid++;
 *         }
 *       } catch (error) {
 *         results.errors.push({ videoId: record.videoId, error: error.message });
 *       }
 *     }
 *     return results;
 *   } catch (error) {
 *     results.errors.push({ general: true, error: error.message, stack: error.stack });
 *     return results;
 *   }
 * }
 */

/**
 * Validates a specific user's WatchHistory against the current database state
 * Each WatchHistory document is one user + one video, so this queries individual documents
 * @param {string|ObjectId} userId - The user ID to validate
 * @returns {Promise<Object>} Validation results for the user
 */
export async function validateUserWatchHistory(userId) {
  const log = createLogger('FlatSync.WatchHistoryValidation.User');
  log.info({ userId }, 'Validating WatchHistory for user');
  
  const client = await clientPromise;
  const db = client.db('Media');
  
  const results = {
    userId,
    videosChecked: 0,
    markedValid: 0,
    markedInvalid: 0,
    alreadyValid: 0,
    errors: []
  };
  
  try {
    const userIdObj = userId instanceof ObjectId ? userId : new ObjectId(userId);
    
    // Get collections using flat structure
    const watchHistoryCollection = db.collection('WatchHistory');
    const flatMoviesCollection = db.collection('FlatMovies');
    const flatEpisodesCollection = db.collection('FlatEpisodes');
    
    // Build lookup maps for faster validation (smaller scope for single user)
    const movieVideoUrls = new Set();
    const movieCursor = flatMoviesCollection.find({}, { projection: { _id: 0, videoURL: 1, normalizedVideoId: 1 } });
    for await (const movie of movieCursor) {
      if (movie.videoURL) {
        movieVideoUrls.add(movie.videoURL);
        if (movie.normalizedVideoId) {
          movieVideoUrls.add(movie.normalizedVideoId);
        }
      }
    }
    
    const tvVideoUrls = new Set();
    const episodeCursor = flatEpisodesCollection.find({}, { projection: { _id: 0, videoURL: 1, normalizedVideoId: 1 } });
    for await (const episode of episodeCursor) {
      if (episode.videoURL) {
        tvVideoUrls.add(episode.videoURL);
        if (episode.normalizedVideoId) {
          tvVideoUrls.add(episode.normalizedVideoId);
        }
      }
    }
    
    const allValidVideoUrls = new Set([...movieVideoUrls, ...tvVideoUrls]);
    
    // Query all WatchHistory documents for this user using centralized function
    const userWatchHistoryRecords = await findPlaybackForUser(userId);
    results.videosChecked = userWatchHistoryRecords.length;
    
    if (userWatchHistoryRecords.length === 0) {
      log.info({ userId, context: 'no_watch_history' }, 'No WatchHistory records found for user');
      return results;
    }
    
    // Check each video separately (each document is one user + one video pair)
    for (const record of userWatchHistoryRecords) {
      try {
        const { videoId, normalizedVideoId, isValid: currentIsValid } = record;
        
        // Check if video exists in database
        let isValidInDatabase = false;
        
        // Check direct videoId
        if (allValidVideoUrls.has(videoId)) {
          isValidInDatabase = true;
        }
        // Check normalized videoId if available
        else if (normalizedVideoId && allValidVideoUrls.has(normalizedVideoId)) {
          isValidInDatabase = true;
        }
        // Check if we can generate and find a normalized version
        else {
          const generatedNormalizedId = generateNormalizedVideoId(videoId);
          if (allValidVideoUrls.has(generatedNormalizedId)) {
            isValidInDatabase = true;
            // Update the normalized ID if it wasn't stored
            if (!normalizedVideoId) {
              await watchHistoryCollection.updateOne(
                { _id: record._id },
                { $set: { normalizedVideoId: generatedNormalizedId } }
              );
            }
          }
        }
        
        // Update isValid flag using centralized function if different from current state
        if (isValidInDatabase && currentIsValid !== true) {
          await updateValidationStatus({
            userId: record.userId,
            normalizedVideoId: record.normalizedVideoId,
            isValid: { $ne: false }
          });
          results.markedValid++;
        } else if (!isValidInDatabase && currentIsValid !== false) {
          await updateValidationStatus({
            userId: record.userId,
            normalizedVideoId: record.normalizedVideoId,
            isValid: false
          });
          results.markedInvalid++;
        } else if (currentIsValid === isValidInDatabase) {
          results.alreadyValid++;
        }
        
      } catch (error) {
        logError(log, error, {
          videoId: record.videoId,
          userId: userIdObj.toString(),
          context: 'process_record'
        });
        results.errors.push({
          videoId: record.videoId,
          error: error.message
        });
      }
    }
    
    log.info({
      userId,
      markedValid: results.markedValid,
      markedInvalid: results.markedInvalid,
      alreadyValid: results.alreadyValid
    }, 'User WatchHistory validation complete');
    
    return results;
    
  } catch (error) {
    logError(log, error, { userId, context: 'user_validation' });
    results.errors.push({
      error: error.message,
      stack: error.stack
    });
    return results;
  }
}
