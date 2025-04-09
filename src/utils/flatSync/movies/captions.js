/**
 * Movie captions sync utilities for flat structure
 */

import { createFullUrl, filterLockedFieldsPreserveStructure, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType, processCaptionURLs } from '../../sync/utils';
import { updateMovieInFlatDB } from './database';
import { isEqual } from 'lodash';
import { sortSubtitleEntries } from '../../sync/captions';
import { doesFieldExistAcrossServers } from '@src/utils/flatSync';

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
  
  console.log(`Movie: Found ${Object.keys(gatheredCaptions).length} captions for "${movieTitle}" from server ${serverConfig.id}`);
  
  // Start with current captions
  const currentCaptions = movie.captionURLs || {};
  const finalCaptionURLs = { ...currentCaptions };
  
  // Track which languages we've seen from this server
  const languagesSeenFromThisServer = new Set();
  let changed = false;
  
  // Update captions from the gathered data
  for (const [lang, captionObj] of Object.entries(gatheredCaptions)) {
    const currentCaption = finalCaptionURLs[lang];
    languagesSeenFromThisServer.add(lang);
    
    // Only update if the caption doesn't exist or has changed
    if (!currentCaption || 
        currentCaption.url !== captionObj.url || 
        currentCaption.lastModified !== captionObj.lastModified ||
        currentCaption.sourceServerId !== captionObj.sourceServerId) {
      
      finalCaptionURLs[lang] = captionObj;
      changed = true;
      console.log(`Movie: Updated caption for "${movieTitle}" - Language: ${lang}, URL: ${captionObj.url}`);
    }
  }
  
  // Remove captions that were sourced from this server but no longer exist on it
  for (const [lang, caption] of Object.entries(finalCaptionURLs)) {
    if (caption.sourceServerId === serverConfig.id && !languagesSeenFromThisServer.has(lang)) {
      console.log(`Movie: Removing caption no longer on server - "${movieTitle}" - Language: ${lang}`);
      delete finalCaptionURLs[lang];
      changed = true;
    }
  }
  
  // Check if each caption exists on any server, and remove orphaned captions
  for (const [lang, caption] of Object.entries(finalCaptionURLs)) {
    const fieldPath = `urls.subtitles.${lang}.url`;
    
    // Check if any server has this caption available
    const fieldExists = doesFieldExistAcrossServers(
      fieldAvailability,
      'movies',
      movieTitle,
      fieldPath
    );
    
    if (!fieldExists) {
      console.log(`Movie: Removing orphaned caption not available on any server - "${movieTitle}" - Language: ${lang}`);
      delete finalCaptionURLs[lang];
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
  
  // Filter out locked fields while preserving structure
  const filteredUpdateData = filterLockedFieldsPreserveStructure(movie, updateData);
  
  if (Object.keys(filteredUpdateData).length === 0) {
    console.log(`Movie: All fields are locked for "${movieTitle}", skipping update`);
    return null;
  }
  
  console.log(`Movie: Updating captions for "${movieTitle}" from server ${serverConfig.id}`);
  
  if (filteredUpdateData.captionSource) {
    console.log(`Caption source: ${filteredUpdateData.captionSource}`);
  }
  
  if (filteredUpdateData.captionURLs) {
    console.log(`Caption languages: ${Object.keys(filteredUpdateData.captionURLs).join(', ')}`);
  }
  
  // Update the movie in the flat database with properly structured data
  await updateMovieInFlatDB(client, movieTitle, { $set: filteredUpdateData });
  
  return {
    field: 'captions',
    updated: true,
    languages: filteredUpdateData.captionURLs ? Object.keys(filteredUpdateData.captionURLs) : []
  };
}
