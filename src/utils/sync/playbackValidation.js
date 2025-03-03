import clientPromise from '@src/lib/mongodb'
import chalk from 'chalk'
import { isMovieAvailableOnAnyServer, isEpisodeAvailableOnAnyServer } from './videoAvailability'
import { ObjectId } from 'mongodb'

/**
 * Searches for a movie URL in all file servers.
 * @param {string} videoId - The video URL/ID
 * @param {Object} fileServers - All file servers data
 * @returns {boolean} True if the movie URL is found
 */
function isMovieUrlInFileServers(videoId, fileServers) {
  try {
    const url = new URL(videoId);
    const pathParts = url.pathname.split('/').filter(part => part);
    
    // Check if it's a movie URL
    if (pathParts.length >= 2 && pathParts[0] === 'movies') {
      const movieTitle = decodeURIComponent(pathParts[1]);
      console.log(`Checking movie: "${movieTitle}" for URL: ${videoId}`);
      
      // Check each server for this movie
      for (const [serverId, fileServer] of Object.entries(fileServers)) {
        const movieData = fileServer.movies?.[movieTitle];
        if (!movieData) {
          console.log(`  Movie "${movieTitle}" not found on server ${serverId}`);
          continue;
        }
        
        console.log(`  Found movie "${movieTitle}" on server ${serverId}`);
        
        // Check if the movie has a video URL
        if (movieData.urls?.mp4) {
          console.log(`    Movie has URL: ${movieData.urls.mp4}`);
          
          // Extract the path from the videoId for comparison with relative URLs
          try {
            const videoIdPath = url.pathname;
            
            // Compare the movie's videoURL (which might be a relative path) with the path from videoId
            if (movieData.urls.mp4 === videoIdPath) {
              console.log(`    MATCH FOUND by comparing paths for ${videoId}`);
              return true;
            }
          } catch (error) {
            console.error(`    Error comparing paths: ${error.message}`);
          }
        } else {
          console.log(`    Movie has no videoURL`);
        }
      }
      
      console.log(`No match found for movie URL: ${videoId}`);
    }
  } catch (error) {
    console.error(`Error searching movie URL in file servers: ${videoId}`, error);
  }
  
  return false;
}

/**
 * Searches for a video URL in all file servers.
 * @param {string} videoId - The video URL/ID
 * @param {Object} fileServers - All file servers data
 * @returns {boolean} True if the video URL is found
 */
function isVideoUrlInFileServers(videoId, fileServers) {
  try {
    const url = new URL(videoId);
    const pathParts = url.pathname.split('/').filter(part => part);
    
    // Check if it's a TV show URL
    if (pathParts.length >= 2 && pathParts[0] === 'tv') {
      const showTitle = decodeURIComponent(pathParts[1]);
      console.log(`Checking TV show: "${showTitle}" for URL: ${videoId}`);
      
      // Check each server for this show
      for (const [serverId, fileServer] of Object.entries(fileServers)) {
        const showData = fileServer.tv?.[showTitle];
        if (!showData) {
          console.log(`  Show "${showTitle}" not found on server ${serverId}`);
          continue;
        }
        
        console.log(`  Found show "${showTitle}" on server ${serverId}`);
        
        // Check each season
        for (const seasonKey of Object.keys(showData.seasons || {})) {
          const seasonData = showData.seasons[seasonKey];
          if (!seasonData?.episodes) {
            console.log(`    No episodes found for ${seasonKey}`);
            continue;
          }
          
          console.log(`    Checking ${Object.keys(seasonData.episodes).length} episodes in ${seasonKey}`);
          
          // Check each episode
          for (const episodeFileName of Object.keys(seasonData.episodes)) {
            const episode = seasonData.episodes[episodeFileName];
            
            // Log the episode's videoURL for comparison
            if (episode.videoURL) {
              console.log(`      Episode ${episodeFileName} has URL: ${episode.videoURL}`);
              
              // Extract the path from the videoId for comparison with relative URLs
              try {
                const videoIdUrl = new URL(videoId);
                const videoIdPath = videoIdUrl.pathname;
                
                // Compare the episode's videoURL (which is a relative path) with the path from videoId
                if (episode.videoURL === videoIdPath) {
                  console.log(`      MATCH FOUND by comparing paths for ${videoId}`);
                  return true;
                }
              } catch (error) {
                console.error(`      Error extracting path from videoId: ${error.message}`);
              }
            } else {
              console.log(`      Episode ${episodeFileName} has no videoURL`);
            }
          }
        }
      }
      
      console.log(`No match found for TV URL: ${videoId}`);
    }
  } catch (error) {
    console.error(`Error searching video URL in file servers: ${videoId}`, error);
  }
  
  return false;
}

/**
 * Checks if a video URL is valid by verifying the media exists in any file server.
 * @param {string} videoId - The video URL/ID
 * @param {Object} fileServers - All file servers data
 * @returns {boolean} True if the video URL is valid
 */
function isVideoUrlValid(videoId, fileServers) {
  try {
    const url = new URL(videoId);
    const pathParts = url.pathname.split('/').filter(part => part);
    
    // Check if it's a movie URL
    if (pathParts.length >= 2 && pathParts[0] === 'movies') {
      return isMovieUrlInFileServers(videoId, fileServers);
    }
    
    // Check if it's a TV show URL
    if (pathParts.length >= 2 && pathParts[0] === 'tv') {
      return isVideoUrlInFileServers(videoId, fileServers);
    }
    
    // If it's neither a movie nor a TV show URL, it's invalid
    console.log(`URL is neither a movie nor a TV show URL: ${videoId}`);
    return false;
  } catch (error) {
    console.error(`Error validating video URL: ${videoId}`, error);
    return false;
  }
}

/**
 * Validates a single video URL.
 * @param {string} videoId - The video URL to validate
 * @param {Object} fileServers - All file servers data
 * @returns {Promise<boolean>} True if the video URL is valid
 */
export async function validateSingleVideoUrl(videoId, fileServers) {
  try {
    console.log(chalk.magenta(`Validating single video URL: ${videoId}`));
    return isVideoUrlValid(videoId, fileServers);
  } catch (error) {
    console.error(`Error validating video URL: ${videoId}`, error);
    return false;
  }
}

/**
 * Validates video URLs in the PlaybackStatus collection.
 * @param {Object} currentDB - Current database state
 * @param {Object} fileServers - All file servers data
 * @returns {Promise<Object>} Validation results
 */
export async function validatePlaybackVideoUrls(currentDB, fileServers) {
  const client = await clientPromise;
  console.log(chalk.bold.magenta(`Starting PlaybackStatus video URL validation...`));
  
  const results = {
    processed: 0,
    valid: 0,
    invalid: 0,
    errors: []
  };
  
  try {
    const db = client.db('Media');
    const playbackStatusCollection = db.collection('PlaybackStatus');
    
    // Get all PlaybackStatus records
    const playbackRecords = await playbackStatusCollection.find({}).toArray();
    results.processed = playbackRecords.length;
    
    console.log(chalk.magenta(`Found ${playbackRecords.length} PlaybackStatus records to validate`));
    
    // Process each record
    for (const record of playbackRecords) {
      try {
        const userId = record.userId;
        const videosWatched = record.videosWatched || [];
        let updatedVideosWatched = false;
        
        // Process each video in the videosWatched array
        for (let i = 0; i < videosWatched.length; i++) {
          const video = videosWatched[i];
          const videoId = video.videoId;
          
            // Skip if already validated recently (within the last 24 hours)
            const lastScanned = video.lastScanned ? new Date(video.lastScanned) : null;
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            
            if (lastScanned && lastScanned > twentyFourHoursAgo) {
              // Already validated recently, skip
              continue;
            }
          
          // Check if the video URL is valid
          const isValid = isVideoUrlValid(videoId, fileServers);
          
          // Update the video record with validation result
          videosWatched[i] = {
            ...video,
            isValid,
            lastScanned: new Date().toISOString()
          };
          
          updatedVideosWatched = true;
          
          if (isValid) {
            results.valid++;
          } else {
            results.invalid++;
          }
        }
        
        // Update the record in the database if changes were made
        if (updatedVideosWatched) {
          await playbackStatusCollection.updateOne(
            { _id: record._id },
            { $set: { videosWatched } }
          );
        }
      } catch (error) {
        console.error(`Error processing PlaybackStatus record for user ${record.userId}:`, error);
        results.errors.push({
          userId: record.userId instanceof ObjectId ? record.userId.toString() : record.userId,
          error: error.message
        });
      }
    }
    
    console.log(chalk.bold.magenta(`PlaybackStatus validation complete. Valid: ${results.valid}, Invalid: ${results.invalid}, Errors: ${results.errors.length}`));
    return results;
  } catch (error) {
    console.error(`Error during PlaybackStatus validation:`, error);
    results.errors.push({
      general: true,
      error: error.message,
      stack: error.stack
    });
    return results;
  }
}
