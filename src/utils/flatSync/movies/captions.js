/**
 * Movie captions sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType, processCaptionURLs } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { isEqual } from 'lodash';
import { sortSubtitleEntries } from '../../sync/captions';

/**
 * Gathers captions for a movie from a file server
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Object|null} Processed caption URLs or null
 */
function gatherMovieCaptions(movie, fileServerData, serverConfig, fieldAvailability) {
  if (!fileServerData?.urls?.subtitles) return null;
  
  const movieTitle = movie.originalTitle || movie.title;
  const subtitlesData = fileServerData.urls.subtitles;
  
  // Process each subtitle language
  const processedCaptions = {};
  
  for (const [langName, subtitleData] of Object.entries(subtitlesData)) {
    const fieldPath = `urls.subtitles.${langName}.url`;
    
    // Check if the current server has the highest priority for this caption language
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'movies',
      movieTitle,
      fieldPath,
      serverConfig
    );
    
    if (!isHighestPriority) continue;
    
    processedCaptions[langName] = {
      srcLang: subtitleData.srcLang,
      url: createFullUrl(subtitleData.url, serverConfig),
      lastModified: subtitleData.lastModified,
      sourceServerId: serverConfig.id
    };
  }
  
  return Object.keys(processedCaptions).length > 0 ? processedCaptions : null;
}

/**
 * Processes movie caption updates
 * @param {Object} client - MongoDB client
 * @param {Object} movie - Movie object
 * @param {Object} fileServerData - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncMovieCaptions(client, movie, fileServerData, serverConfig, fieldAvailability) {
  const movieTitle = movie.originalTitle || movie.title;
  
  // Gather captions from the file server
  const gatheredCaptions = gatherMovieCaptions(movie, fileServerData, serverConfig, fieldAvailability);
  if (!gatheredCaptions) return null;
  
  // Start with current captions
  const currentCaptions = movie.captionURLs || {};
  const finalCaptionURLs = { ...currentCaptions };
  let changed = false;
  
  // Update captions from the gathered data
  for (const [lang, captionObj] of Object.entries(gatheredCaptions)) {
    const currentCaption = finalCaptionURLs[lang];
    
    // Only update if the caption doesn't exist or has changed
    if (!currentCaption || 
        currentCaption.url !== captionObj.url || 
        currentCaption.lastModified !== captionObj.lastModified ||
        currentCaption.sourceServerId !== captionObj.sourceServerId) {
      
      finalCaptionURLs[lang] = captionObj;
      changed = true;
    }
  }
  
  if (!changed) return null;
  
  // Determine caption source from the first language (if available)
  let newCaptionSource = movie.captionSource;
  const sortedEntries = sortSubtitleEntries(Object.entries(finalCaptionURLs));
  if (sortedEntries.length > 0) {
    newCaptionSource = sortedEntries[0][1].sourceServerId;
  } else {
    newCaptionSource = null;
  }
  
  const updateData = {
    captionURLs: Object.fromEntries(sortedEntries),
    captionSource: newCaptionSource
  };
  
  // Filter out locked fields
  const filteredUpdateData = filterLockedFields(movie, updateData);
  
  if (!filteredUpdateData.captionURLs) return null;
  
  console.log(`Movie: Updating captions for "${movieTitle}" from server ${serverConfig.id}`);
  
  // Update the movie in the flat database
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'captions',
    updated: true
  };
}
