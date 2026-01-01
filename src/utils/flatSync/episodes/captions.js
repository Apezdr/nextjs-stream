/**
 * TV episode captions sync utilities for flat structure
 */

import { createFullUrl, filterLockedFields, isSourceMatchingServer, isCurrentServerHighestPriorityForField, MediaType, findEpisodeFileName, processCaptionURLs } from '../../sync/utils';
import { sortSubtitleEntries } from '../../sync/captions';

/**
 * Processes TV episode captions updates
 * @param {Object} client - MongoDB client
 * @param {Object} show - TV show object
 * @param {Object} season - Season object from current database
 * @param {Object} episode - Episode object from current database
 * @param {Object} flatShow - Flat show object from flat database
 * @param {Object} flatSeason - Flat season object from flat database
 * @param {Object} flatEpisode - Flat episode object from flat database
 * @param {Object} fileServerSeasonData - File server season data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object|null>} Update result or null
 */
export async function syncEpisodeCaptions(client, show, season, episode, flatShow, flatSeason, flatEpisode, fileServerSeasonData, serverConfig, fieldAvailability) {
  const episodeFileName = findEpisodeFileName(
    Object.keys(fileServerSeasonData.episodes || {}),
    season.seasonNumber,
    episode.episodeNumber
  );
  
  if (!episodeFileName) return null;
  
  const fileServerEpisodeData = fileServerSeasonData.episodes[episodeFileName];
  if (!fileServerEpisodeData?.subtitles) return null;
  
  const showTitle = show.title;
  const originalTitle = show.originalTitle;
  
  // Process each subtitle language
  const processedCaptions = {};
  
  for (const [langName, subtitleData] of Object.entries(fileServerEpisodeData.subtitles)) {
    const fieldPath = `seasons.Season ${season.seasonNumber}.episodes.${episodeFileName}.subtitles.${langName}.url`;
    
    // Check if the current server has the highest priority for this caption language
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      fieldAvailability,
      'tv',
      originalTitle,
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
  
  if (Object.keys(processedCaptions).length === 0) return null;
  
  // Start with current captions
  const currentCaptions = flatEpisode.captionURLs || {};
  const finalCaptionURLs = { ...currentCaptions };
  let changed = false;
  
  // Track which languages we've seen from this server (for cleanup)
  const languagesSeenFromThisServer = new Set();
  
  // Update captions from the processed data
  for (const [lang, captionObj] of Object.entries(processedCaptions)) {
    // Mark this language as seen from this server
    languagesSeenFromThisServer.add(lang);
    
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
  
  // Remove captions that were sourced from this server but no longer exist on it
  for (const [lang, caption] of Object.entries(finalCaptionURLs)) {
    if (caption.sourceServerId === serverConfig.id && !languagesSeenFromThisServer.has(lang)) {
      console.log(`Episode: Removing caption no longer on server - "${showTitle}" S${season.seasonNumber}E${episode.episodeNumber} - Language: ${lang}`);
      delete finalCaptionURLs[lang];
      changed = true;
    }
  }
  
  if (!changed) return null;
  
  // Determine caption source from the first language (if available)
  let newCaptionSource = flatEpisode.captionSource;
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
  const filteredUpdateData = filterLockedFields(flatEpisode, updateData);
  
  if (!filteredUpdateData.captionURLs) return null;
  
  console.log(`Episode: Updating captions for "${showTitle}" S${season.seasonNumber}E${episode.episodeNumber} from server ${serverConfig.id}`);
  
  // Return both the status and the update data
  return {
    ...filteredUpdateData,
    field: 'captions',
    updated: true
  };
}
