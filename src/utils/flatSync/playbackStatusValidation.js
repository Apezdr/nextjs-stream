import { createLogger, logError } from '@src/lib/logger'
import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'

/**
 * Validates all PlaybackStatus records against the current state of the database
 * after sync and availability checks have completed.
 * This marks videos as valid if they exist in the cleaned database.
 * 
 * @returns {Promise<Object>} Validation results
 */
export async function validatePlaybackStatusAgainstDatabase() {
  const log = createLogger('FlatSync.PlaybackStatusValidation');
  log.info('Starting PlaybackStatus bulk validation against cleaned database...');
  
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
    const playbackStatusCollection = db.collection('PlaybackStatus');
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
    
    // Process PlaybackStatus records
    const playbackRecords = await playbackStatusCollection.find({}).toArray();
    results.processed = playbackRecords.length;
    
    log.info({ totalRecords: playbackRecords.length }, 'Processing PlaybackStatus records');
    
    for (const record of playbackRecords) {
      try {
        const videosWatched = record.videosWatched || [];
        let needsUpdate = false;
        
        // Check each video in the user's watch history
        for (let i = 0; i < videosWatched.length; i++) {
          const video = videosWatched[i];
          const { videoId, normalizedVideoId, isValid: currentIsValid } = video;
          
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
                videosWatched[i].normalizedVideoId = generatedNormalizedId;
                needsUpdate = true;
              }
            }
          }
          
          // Update isValid flag if it's different from current state
          if (isValidInDatabase && currentIsValid !== true) {
            videosWatched[i].isValid = true;
            videosWatched[i].lastScanned = new Date().toISOString();
            needsUpdate = true;
            results.markedValid++;
          } else if (!isValidInDatabase && currentIsValid !== false) {
            videosWatched[i].isValid = false;
            videosWatched[i].lastScanned = new Date().toISOString();
            needsUpdate = true;
            results.markedInvalid++;
          } else if (currentIsValid === isValidInDatabase) {
            results.alreadyValid++;
          }
        }
        
        // Update the record if changes were made
        if (needsUpdate) {
          await playbackStatusCollection.updateOne(
            { _id: record._id },
            { $set: { videosWatched } }
          );
        }
        
      } catch (error) {
        logError(log, error, {
          userId: record.userId instanceof ObjectId ? record.userId.toString() : record.userId,
          context: 'process_record'
        });
        results.errors.push({
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
    }, 'PlaybackStatus bulk validation complete');
    
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
 * Validates a specific user's PlaybackStatus against the current database state
 * @param {string|ObjectId} userId - The user ID to validate
 * @returns {Promise<Object>} Validation results for the user
 */
export async function validateUserPlaybackStatus(userId) {
  const log = createLogger('FlatSync.PlaybackStatusValidation.User');
  log.info({ userId }, 'Validating PlaybackStatus for user');
  
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
    const playbackStatusCollection = db.collection('PlaybackStatus');
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
    
    // Get user's PlaybackStatus record
    const userRecord = await playbackStatusCollection.findOne({ userId: userIdObj });
    
    if (!userRecord) {
      log.info({ userId, context: 'record_missing' }, 'No PlaybackStatus record found for user');
      return results;
    }
    
    const videosWatched = userRecord.videosWatched || [];
    results.videosChecked = videosWatched.length;
    let needsUpdate = false;
    
    // Check each video
    for (let i = 0; i < videosWatched.length; i++) {
      const video = videosWatched[i];
      const { videoId, normalizedVideoId, isValid: currentIsValid } = video;
      
      // Check if video exists in database
      let isValidInDatabase = false;
      
      if (allValidVideoUrls.has(videoId)) {
        isValidInDatabase = true;
      } else if (normalizedVideoId && allValidVideoUrls.has(normalizedVideoId)) {
        isValidInDatabase = true;
      } else {
        const generatedNormalizedId = generateNormalizedVideoId(videoId);
        if (allValidVideoUrls.has(generatedNormalizedId)) {
          isValidInDatabase = true;
          if (!normalizedVideoId) {
            videosWatched[i].normalizedVideoId = generatedNormalizedId;
            needsUpdate = true;
          }
        }
      }
      
      // Update isValid flag if needed
      if (isValidInDatabase && currentIsValid !== true) {
        videosWatched[i].isValid = true;
        videosWatched[i].lastScanned = new Date().toISOString();
        needsUpdate = true;
        results.markedValid++;
      } else if (!isValidInDatabase && currentIsValid !== false) {
        videosWatched[i].isValid = false;
        videosWatched[i].lastScanned = new Date().toISOString();
        needsUpdate = true;
        results.markedInvalid++;
      } else {
        results.alreadyValid++;
      }
    }
    
    // Update the record if changes were made
    if (needsUpdate) {
      await playbackStatusCollection.updateOne(
        { _id: userRecord._id },
        { $set: { videosWatched } }
      );
    }
    
    log.info({
      userId,
      markedValid: results.markedValid,
      markedInvalid: results.markedInvalid,
      alreadyValid: results.alreadyValid
    }, 'User PlaybackStatus validation complete');
    
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
