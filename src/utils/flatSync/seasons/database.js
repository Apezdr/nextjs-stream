/**
 * TV season database operations for flat structure
 */

import { ObjectId } from 'mongodb';

/**
 * Updates a TV season in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title
 * @param {string} originalTitle - Original TV show title from the file server
 * @param {number} seasonNumber - Season number
 * @param {Object} updates - Update operations
 * @returns {Promise<Object>} Update result
 */
export async function updateSeasonInFlatDB(client, showTitle, originalTitle, seasonNumber, updates) {
  try {
    // Validate inputs to prevent null showTitle
    if (!showTitle) {
      throw new Error(`Cannot update season with null showTitle - showTitle is required`);
    }
    
    // First, get the TV show ID
    const tvShow = await client
      .db('Media')
      .collection('FlatTVShows')
      .findOne({ originalTitle: originalTitle }, { projection: { _id: 1 } });
    
    if (!tvShow) {
      throw new Error(`TV show "${originalTitle}" not found in flat structure`);
    }
    
    // Ensure showTitle is always included in the update
    if (updates.$set) {
      updates.$set.showTitle = showTitle;
      updates.$set.showId = tvShow._id;
    } else {
      updates.$set = { 
        showTitle: showTitle,
        showId: tvShow._id
      };
    }
    
    // Fix the query to use the actual show ID to match the index on showId and seasonNumber
    const result = await client
      .db('Media')
      .collection('FlatSeasons')
      .updateOne(
        { 
          showId: tvShow._id,
          seasonNumber: seasonNumber 
        }, 
        updates, 
        { upsert: true }
      );
    
    return result;
  } catch (error) {
    console.error(`Error updating season ${seasonNumber} of "${showTitle}" in flat structure:`, error);
    return { error };
  }
}

/**
 * Gets a TV season from the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title
 * @param {number} seasonNumber - Season number
 * @param {boolean} forceOriginalTitleLookup - Force lookup by original title
 * @returns {Promise<Object|null>} Season document or null
 */
export async function getSeasonFromFlatDB(client, showTitle, seasonNumber, forceOriginalTitleLookup = false) {
  try {
    // Determine whether to lookup by title or originalTitle based on parameter
    const lookupQuery = forceOriginalTitleLookup ? { originalTitle: showTitle } : { title: showTitle };
    
    // First, get the TV show ID
    const tvShow = await client
      .db('Media')
      .collection('FlatTVShows')
      .findOne(lookupQuery, { projection: { _id: 1, title: 1 } });
    
    if (!tvShow) {
      return null;
    }
    
    // First try to find the season using the official ID (primary index)
    const seasonByIds = await client
      .db('Media')
      .collection('FlatSeasons')
      .findOne({ 
        showId: tvShow._id,
        seasonNumber: seasonNumber 
      });
    
    if (seasonByIds) {
      return seasonByIds;
    }
    
    // If not found by ID, check if there's a season with this natural key but mismatched showId
    const seasonByNaturalKey = await client
      .db('Media')
      .collection('FlatSeasons')
      .findOne({
        showTitle: tvShow.title,
        seasonNumber: seasonNumber
      });
    
    // If we found a season with mismatched IDs, update it to have correct showId
    // This prevents duplicates in our database
    if (seasonByNaturalKey) {
      // Update the season to have correct showId (which is the source of truth)
      await client
        .db('Media')
        .collection('FlatSeasons')
        .updateOne(
          { _id: seasonByNaturalKey._id },
          { $set: { showId: tvShow._id } }
        );
      
      // Return the season with updated showId
      return {
        ...seasonByNaturalKey,
        showId: tvShow._id
      };
    }
    
    // Season not found by any means
    return null;
  } catch (error) {
    console.error(`Error getting season ${seasonNumber} of "${showTitle}" from flat structure:`, error);
    return null;
  }
}

/**
 * Gets a TV season by ID from the flat database structure
 * @param {Object} client - MongoDB client
 * @param {ObjectId} id - Season ID
 * @returns {Promise<Object|null>} Season document or null
 */
export async function getSeasonByIdFromFlatDB(client, id) {
  try {
    return await client
      .db('Media')
      .collection('FlatSeasons')
      .findOne({ _id: id });
  } catch (error) {
    console.error(`Error getting season by ID "${id}" from flat structure:`, error);
    return null;
  }
}

/**
 * Creates a new TV season in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {Object} seasonData - Season data
 * @returns {Promise<Object>} Insert result
 */
export async function createSeasonInFlatDB(client, seasonData) {
  try {
    // Check for required fields
    if (!seasonData.showId) {
      throw new Error('Season data must include showId');
    }
    
    if (!seasonData.seasonNumber) {
      throw new Error('Season data must include seasonNumber');
    }
    
    // Ensure the season has showTitle if it has showId
    if (!seasonData.showTitle && seasonData.showId) {
      // Look up showTitle from the show
      const show = await client
        .db('Media')
        .collection('FlatTVShows')
        .findOne({ _id: seasonData.showId }, { projection: { title: 1 } });
        
      if (show && show.title) {
        seasonData.showTitle = show.title;
      } else {
        throw new Error(`Cannot create season without showTitle and show not found for ID ${seasonData.showId}`);
      }
    }
    
    // Check for existing season with same seasonNumber but null showTitle
    // These cause the E11000 duplicate key error with show_title_season_index
    try {
      const existingNullTitleSeason = await client
        .db('Media')
        .collection('FlatSeasons')
        .findOne({ 
          showTitle: null, 
          seasonNumber: seasonData.seasonNumber 
        });
        
      if (existingNullTitleSeason) {
        console.log(`Found existing season with null showTitle and same seasonNumber ${seasonData.seasonNumber}, updating instead of creating new`);
        
        // Create a copy of seasonData without the _id field
        const { _id, ...seasonDataWithoutId } = seasonData;
        
        // Update the existing season with our new data, excluding the _id
        const updateResult = await client
          .db('Media')
          .collection('FlatSeasons')
          .updateOne(
            { _id: existingNullTitleSeason._id },
            { $set: seasonDataWithoutId }
          );
          
        return {
          acknowledged: true,
          modifiedCount: updateResult.modifiedCount,
          upsertedId: existingNullTitleSeason._id,
          upsertedCount: 0
        };
      }
    } catch (lookupError) {
      // Non-critical error, just log and continue
      console.warn(`Error checking for duplicate null showTitle: ${lookupError.message}`);
    }
    
    // Ensure the season has an _id
    if (!seasonData._id) {
      seasonData._id = new ObjectId();
    }
    
    // Ensure the season has a type
    if (!seasonData.type) {
      seasonData.type = 'season';
    }
    
    const result = await client
      .db('Media')
      .collection('FlatSeasons')
      .insertOne(seasonData);
    
    return result;
  } catch (error) {
    console.error(`Error creating season ${seasonData.seasonNumber} of show ID "${seasonData.showId}" in flat structure:`, error);
    return { error };
  }
}

/**
 * Updates only the showId for a TV season in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title from file server
 * @param {number} seasonNumber - Season number
 * @param {ObjectId} newShowId - The new show ID to set
 * @returns {Promise<Object>} Update result
 */
export async function updateSeasonShowId(client, showTitle, seasonNumber, newShowId) {
  try {
    if (!showTitle) {
      throw new Error('Cannot update season with null showTitle');
    }
    
    // Find and update the season by showTitle and seasonNumber
    // This matches the compound index that's causing the duplicate key error
    const result = await client
      .db('Media')
      .collection('FlatSeasons')
      .updateOne(
        { 
          showTitle: showTitle,
          seasonNumber: seasonNumber 
        }, 
        { 
          $set: { showId: newShowId }
        }
      );
    
    if (result.matchedCount === 0) {
      console.warn(`No season found for "${showTitle}" season ${seasonNumber} to update showId`);
    } else {
      console.log(`Updated showId for "${showTitle}" season ${seasonNumber}`);
    }
    
    return result;
  } catch (error) {
    console.error(`Error updating showId for season ${seasonNumber} of "${showTitle}":`, error);
    return { error };
  }
}

/**
 * Gets all seasons for a TV show from the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} showTitle - TV show title
 * @returns {Promise<Array<Object>>} Array of season documents
 */
export async function getAllSeasonsForShowFromFlatDB(client, showTitle) {
  try {
    // First, get the TV show ID
    const tvShow = await client
      .db('Media')
      .collection('FlatTVShows')
      .findOne({ title: showTitle }, { projection: { _id: 1 } });
    
    if (!tvShow) {
      return [];
    }
    
    return await client
      .db('Media')
      .collection('FlatSeasons')
      .find({ showId: tvShow._id })
      .sort({ seasonNumber: 1 })
      .toArray();
  } catch (error) {
    console.error(`Error getting all seasons for "${showTitle}" from flat structure:`, error);
    return [];
  }
}
