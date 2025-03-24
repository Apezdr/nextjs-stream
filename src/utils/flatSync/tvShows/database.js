/**
 * TV show database operations for flat structure
 */

import { ObjectId } from 'mongodb';

/**
 * Updates a TV show in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} title - TV show title
 * @param {Object} updates - Update operations
 * @returns {Promise<Object>} Update result
 */
export async function updateTVShowInFlatDB(client, title, updates) {
  try {
    const result = await client
      .db('Media')
      .collection('FlatTVShows')
      .updateOne({ originalTitle: title }, updates, { upsert: true });

    if (result.upsertedCount == 0 && result.modifiedCount == 0) {
      console.log(`TV show "${title}" not found in flat structure`);
      debugger;
    }

    return result;
  } catch (error) {
    console.error(`Error updating TV show "${title}" in flat structure:`, error);
    return { error };
  }
}

/**
 * Gets a TV show from the flat database structure
 * @param {Object} client - MongoDB client
 * @param {string} title - TV show title from the file server
 * @returns {Promise<Object|null>} TV show document or null
 */
export async function getTVShowFromFlatDB(client, title) {
  try {
    return await client
      .db('Media')
      .collection('FlatTVShows')
      .findOne({ originalTitle: title });
  } catch (error) {
    console.error(`Error getting TV show "${title}" from flat structure:`, error);
    return null;
  }
}

/**
 * Gets a TV show by ID from the flat database structure
 * @param {Object} client - MongoDB client
 * @param {ObjectId} id - TV show ID
 * @returns {Promise<Object|null>} TV show document or null
 */
export async function getTVShowByIdFromFlatDB(client, id) {
  try {
    return await client
      .db('Media')
      .collection('FlatTVShows')
      .findOne({ _id: id });
  } catch (error) {
    console.error(`Error getting TV show by ID "${id}" from flat structure:`, error);
    return null;
  }
}

/**
 * Creates a new TV show in the flat database structure
 * @param {Object} client - MongoDB client
 * @param {Object} tvShowData - TV show data
 * @returns {Promise<Object>} Insert result
 */
export async function createTVShowInFlatDB(client, tvShowData) {
  try {
    // Ensure the TV show has an _id
    if (!tvShowData._id) {
      tvShowData._id = new ObjectId();
    }
    
    // Ensure the TV show has a type
    if (!tvShowData.type) {
      tvShowData.type = 'tvShow';
    }
    
    // Set originalTitle to the initial title if not already set
    if (!tvShowData.originalTitle && tvShowData.title) {
      tvShowData.originalTitle = tvShowData.title;
    }
    
    const result = await client
      .db('Media')
      .collection('FlatTVShows')
      .insertOne(tvShowData);
    
    return result;
  } catch (error) {
    console.error(`Error creating TV show "${tvShowData.title}" in flat structure:`, error);
    return { error };
  }
}
