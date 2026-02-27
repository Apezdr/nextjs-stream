import { createLogger, logError } from '@src/lib/logger'
import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'

/**
 * Validates all WatchHistory records against the current state of the database
 * after sync and availability checks have completed.
 * This marks videos as valid if they exist in the cleaned database.
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
    // Get collections using flat structure
    const watchHistoryCollection = db.collection('WatchHistory');
    const flatMoviesCollection = db.collection('FlatMovies');
    const flatEpisodesCollection = db.collection('FlatEpisodes');
    
    // Build lookup maps for faster validation
    log.info('Building validation lookup maps...');
    
    // Get all valid movie videoURLs
    const movieVideoUrls = new Set();
    const movieCursor = flatMoviesCollection.find({}, { projection: { videoURL: 1, normalizedVideoId: 1 } });
    for await (const movie of movieCursor) {
      if (movie.videoURL) {
        movieVideoUrls.add(movie.videoURL);
        if (movie.normalizedVideoId) {
          movieVideoUrls.add(movie.normalizedVideoId);
        }
      }
    }
    
    // Get all valid TV episode videoURLs
    const tvVideoUrls = new Set();
    const episodeCursor = flatEpisodesCollection.find({}, { projection: { videoURL: 1, normalizedVideoId: 1 } });
    for await (const episode of episodeCursor) {
      if (episode.videoURL) {
        tvVideoUrls.add(episode.videoURL);
        if (episode.normalizedVideoId) {
          tvVideoUrls.add(episode.normalizedVideoId);
        }
      }
    }
    
    log.info({
      movieCount: movieVideoUrls.size,
      tvCount: tvVideoUrls.size
    }, 'Built video URL lookup sets');
    
    // Combine all valid videoURLs
    const allValidVideoUrls = new Set([...movieVideoUrls, ...tvVideoUrls]);
    
    // Process WatchHistory records (one document per video)
    const watchHistoryRecords = await watchHistoryCollection.find({}).toArray();
    results.processed = watchHistoryRecords.length;
    
    log.info({ totalRecords: watchHistoryRecords.length }, 'Processing WatchHistory records');
    
    for (const record of watchHistoryRecords) {
      try {
        const { videoId, normalizedVideoId, isValid: currentIsValid } = record;
        
        // Check if video exists in our valid URLs set
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
        
        // Update isValid flag if it's different from current state
        if (isValidInDatabase && currentIsValid !== true) {
          await watchHistoryCollection.updateOne(
            { _id: record._id },
            { $set: { isValid: true, lastScanned: new Date().toISOString() } }
          );
          results.markedValid++;
        } else if (!isValidInDatabase && currentIsValid !== false) {
          await watchHistoryCollection.updateOne(
            { _id: record._id },
            { $set: { isValid: false, lastScanned: new Date().toISOString() } }
          );
          results.markedInvalid++;
        } else if (currentIsValid === isValidInDatabase) {
          results.alreadyValid++;
        }
        
      } catch (error) {
        logError(log, error, {
          videoId: record.videoId,
          userId: record.userId instanceof ObjectId ? record.userId.toString() : record.userId,
          context: 'process_record'
        });
        results.errors.push({
          videoId: record.videoId,
          userId: record.userId instanceof ObjectId ? record.userId.toString() : record.userId,
          error: error.message
        });
      }
    }
    
    log.info({
      markedValid: results.markedValid,
      markedInvalid: results.markedInvalid,
      alreadyValid: results.alreadyValid,
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
    const movieCursor = flatMoviesCollection.find({}, { projection: { videoURL: 1, normalizedVideoId: 1 } });
    for await (const movie of movieCursor) {
      if (movie.videoURL) {
        movieVideoUrls.add(movie.videoURL);
        if (movie.normalizedVideoId) {
          movieVideoUrls.add(movie.normalizedVideoId);
        }
      }
    }
    
    const tvVideoUrls = new Set();
    const episodeCursor = flatEpisodesCollection.find({}, { projection: { videoURL: 1, normalizedVideoId: 1 } });
    for await (const episode of episodeCursor) {
      if (episode.videoURL) {
        tvVideoUrls.add(episode.videoURL);
        if (episode.normalizedVideoId) {
          tvVideoUrls.add(episode.normalizedVideoId);
        }
      }
    }
    
    const allValidVideoUrls = new Set([...movieVideoUrls, ...tvVideoUrls]);
    
    // Query all WatchHistory documents for this user
    const userWatchHistoryRecords = await watchHistoryCollection.find({ userId: userIdObj }).toArray();
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
        
        // Update isValid flag if it's different from current state
        if (isValidInDatabase && currentIsValid !== true) {
          await watchHistoryCollection.updateOne(
            { _id: record._id },
            { $set: { isValid: true, lastScanned: new Date().toISOString() } }
          );
          results.markedValid++;
        } else if (!isValidInDatabase && currentIsValid !== false) {
          await watchHistoryCollection.updateOne(
            { _id: record._id },
            { $set: { isValid: false, lastScanned: new Date().toISOString() } }
          );
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
