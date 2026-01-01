/**
 * Media Data Enricher for Notifications
 * 
 * Fetches fresh media data from the database using stored IDs
 * This ensures notifications always display current information
 */

import clientPromise from '@src/lib/mongodb';
import { ObjectId } from 'mongodb';

export class MediaDataEnricher {
  /**
   * Enrich notification content with fresh database data
   * @param {Object} notificationContent - Content with IDs to enrich
   * @returns {Promise<Object>} Enriched content with full media data
   */
  static async enrichNotificationContent(notificationContent) {
    if (!notificationContent?.data) {
      return notificationContent;
    }

    const enrichedData = { ...notificationContent.data };

    try {
      const client = await clientPromise;

      // Enrich movies if present
      if (enrichedData.newMovies && Array.isArray(enrichedData.newMovies)) {
        enrichedData.newMovies = await this.enrichMovies(client, enrichedData.newMovies);
      }

      // Enrich episodes if present
      if (enrichedData.newEpisodes && Array.isArray(enrichedData.newEpisodes)) {
        enrichedData.newEpisodes = await this.enrichEpisodes(client, enrichedData.newEpisodes);
      }

      // Enrich shows with new episodes if present
      if (enrichedData.showsWithNewEpisodes && Array.isArray(enrichedData.showsWithNewEpisodes)) {
        enrichedData.showsWithNewEpisodes = await this.enrichShowsWithEpisodes(client, enrichedData.showsWithNewEpisodes);
      }

      return {
        ...notificationContent,
        data: enrichedData
      };
    } catch (error) {
      console.error('Error enriching notification content:', error);
      // Return original content with fallback data on error
      return notificationContent;
    }
  }

  /**
   * Enrich movie data from stored IDs
   * @param {Object} client - MongoDB client
   * @param {Array} movieReferences - Array of movie objects with IDs
   * @returns {Promise<Array>} Array of enriched movie objects
   */
  static async enrichMovies(client, movieReferences) {
    if (!movieReferences || movieReferences.length === 0) {
      return [];
    }

    try {
      // Extract valid ObjectIds
      const movieIds = movieReferences
        .map(movie => {
          try {
            return new ObjectId(movie.id);
          } catch (error) {
            console.warn(`Invalid movie ID: ${movie.id}`);
            return null;
          }
        })
        .filter(id => id !== null);

      if (movieIds.length === 0) {
        return movieReferences; // Return fallback data
      }

      // Batch fetch movies from database
      const movies = await client
        .db('Media')
        .collection('FlatMovies')
        .find({ 
          _id: { $in: movieIds } 
        })
        .toArray();

      // Create a map for efficient lookup
      const movieMap = new Map();
      movies.forEach(movie => {
        movieMap.set(movie._id.toString(), movie);
      });

      // Enrich each movie reference with fresh data
      return movieReferences.map(movieRef => {
        const freshMovie = movieMap.get(movieRef.id);
        if (freshMovie) {
          return {
            ...movieRef, // Keep original metadata like createdAt
            id: freshMovie._id,
            title: freshMovie.title,
            originalTitle: freshMovie.originalTitle,
            releaseDate: freshMovie.metadata?.release_date,
            genre: freshMovie.metadata?.genres?.[0]?.name,
            rating: freshMovie.metadata?.vote_average,
            duration: freshMovie.duration,
            posterUrl: freshMovie.posterURL,
            backdropUrl: freshMovie.backdropURL,
            overview: freshMovie.metadata?.overview,
            // Mark as enriched
            _enriched: true
          };
        } else {
          // Movie no longer exists - return fallback data
          console.warn(`Movie ${movieRef.id} no longer exists in database`);
          return {
            ...movieRef,
            _enriched: false,
            _missing: true
          };
        }
      });
    } catch (error) {
      console.error('Error enriching movies:', error);
      return movieReferences; // Return fallback data
    }
  }

  /**
   * Enrich episode data from stored IDs
   * @param {Object} client - MongoDB client
   * @param {Array} episodeReferences - Array of episode objects with IDs
   * @returns {Promise<Array>} Array of enriched episode objects
   */
  static async enrichEpisodes(client, episodeReferences) {
    if (!episodeReferences || episodeReferences.length === 0) {
      return [];
    }

    try {
      // Extract valid ObjectIds
      const episodeIds = episodeReferences
        .map(episode => {
          try {
            return new ObjectId(episode.id);
          } catch (error) {
            console.warn(`Invalid episode ID: ${episode.id}`);
            return null;
          }
        })
        .filter(id => id !== null);

      if (episodeIds.length === 0) {
        return episodeReferences; // Return fallback data
      }

      // Batch fetch episodes from database
      const episodes = await client
        .db('Media')
        .collection('FlatEpisodes')
        .find({ 
          _id: { $in: episodeIds } 
        })
        .toArray();

      // Create a map for efficient lookup
      const episodeMap = new Map();
      episodes.forEach(episode => {
        episodeMap.set(episode._id.toString(), episode);
      });

      // Enrich each episode reference with fresh data
      return episodeReferences.map(episodeRef => {
        const freshEpisode = episodeMap.get(episodeRef.id);
        if (freshEpisode) {
          return {
            ...episodeRef, // Keep original metadata like createdAt
            id: freshEpisode._id,
            showTitle: freshEpisode.showTitle,
            seasonNumber: freshEpisode.seasonNumber,
            episodeNumber: freshEpisode.episodeNumber,
            title: freshEpisode.title,
            overview: freshEpisode.overview,
            airDate: freshEpisode.airDate,
            duration: freshEpisode.duration,
            thumbnailUrl: freshEpisode.thumbnailURL,
            // Mark as enriched
            _enriched: true
          };
        } else {
          // Episode no longer exists - return fallback data
          console.warn(`Episode ${episodeRef.id} no longer exists in database`);
          return {
            ...episodeRef,
            _enriched: false,
            _missing: true
          };
        }
      });
    } catch (error) {
      console.error('Error enriching episodes:', error);
      return episodeReferences; // Return fallback data
    }
  }

  /**
   * Enrich shows with new episodes data
   * @param {Object} client - MongoDB client
   * @param {Array} showReferences - Array of show objects with episode IDs
   * @returns {Promise<Array>} Array of enriched show objects
   */
  static async enrichShowsWithEpisodes(client, showReferences) {
    if (!showReferences || showReferences.length === 0) {
      return [];
    }

    try {
      // Collect all episode IDs from all shows
      const allEpisodeIds = [];
      showReferences.forEach(show => {
        if (show.episodes && Array.isArray(show.episodes)) {
          show.episodes.forEach(episodeRef => {
            try {
              allEpisodeIds.push(new ObjectId(episodeRef.id));
            } catch (error) {
              console.warn(`Invalid episode ID in show ${show.showTitle}: ${episodeRef.id}`);
            }
          });
        }
      });

      if (allEpisodeIds.length === 0) {
        return showReferences; // Return fallback data
      }

      // Batch fetch all episodes
      const episodes = await client
        .db('Media')
        .collection('FlatEpisodes')
        .find({ 
          _id: { $in: allEpisodeIds } 
        })
        .toArray();

      // Create a map for efficient lookup
      const episodeMap = new Map();
      episodes.forEach(episode => {
        episodeMap.set(episode._id.toString(), episode);
      });

      // Enrich each show's episodes
      return showReferences.map(show => {
        const enrichedEpisodes = show.episodes ? show.episodes.map(episodeRef => {
          const freshEpisode = episodeMap.get(episodeRef.id);
          if (freshEpisode) {
            return {
              ...episodeRef,
              id: freshEpisode._id,
              showTitle: freshEpisode.showTitle,
              seasonNumber: freshEpisode.seasonNumber,
              episodeNumber: freshEpisode.episodeNumber,
              title: freshEpisode.title,
              overview: freshEpisode.overview,
              airDate: freshEpisode.airDate,
              duration: freshEpisode.duration,
              thumbnailUrl: freshEpisode.thumbnailURL,
              _enriched: true
            };
          } else {
            console.warn(`Episode ${episodeRef.id} in show ${show.showTitle} no longer exists`);
            return {
              ...episodeRef,
              _enriched: false,
              _missing: true
            };
          }
        }).filter(episode => !episode._missing) : []; // Filter out missing episodes

        return {
          ...show,
          episodes: enrichedEpisodes,
          totalNewEpisodes: enrichedEpisodes.length, // Update count after filtering
          _enriched: true
        };
      });
    } catch (error) {
      console.error('Error enriching shows with episodes:', error);
      return showReferences; // Return fallback data
    }
  }

  /**
   * Enrich individual notification data (for single notification display)
   * @param {Object} notification - Single notification object
   * @returns {Promise<Object>} Enriched notification
   */
  static async enrichSingleNotification(notification) {
    return await this.enrichNotificationContent(notification);
  }

  /**
   * Enrich multiple notifications in batch (for notification list display)
   * @param {Array} notifications - Array of notification objects
   * @returns {Promise<Array>} Array of enriched notifications
   */
  static async enrichNotificationBatch(notifications) {
    if (!notifications || notifications.length === 0) {
      return [];
    }

    try {
      // Process notifications in parallel
      const enrichedNotifications = await Promise.all(
        notifications.map(notification => this.enrichNotificationContent(notification))
      );

      return enrichedNotifications;
    } catch (error) {
      console.error('Error enriching notification batch:', error);
      return notifications; // Return original notifications on error
    }
  }

  /**
   * Check if content needs enrichment
   * @param {Object} notificationContent - Notification content to check
   * @returns {boolean} True if enrichment is needed
   */
  static needsEnrichment(notificationContent) {
    if (!notificationContent?.data) {
      return false;
    }

    const data = notificationContent.data;
    
    // Check if movies need enrichment (have IDs but missing detailed data)
    if (data.newMovies && data.newMovies.length > 0) {
      const firstMovie = data.newMovies[0];
      if (firstMovie.id && !firstMovie._enriched && !firstMovie.posterUrl) {
        return true;
      }
    }

    // Check if episodes need enrichment
    if (data.newEpisodes && data.newEpisodes.length > 0) {
      const firstEpisode = data.newEpisodes[0];
      if (firstEpisode.id && !firstEpisode._enriched && !firstEpisode.title) {
        return true;
      }
    }

    // Check if shows with episodes need enrichment
    if (data.showsWithNewEpisodes && data.showsWithNewEpisodes.length > 0) {
      const firstShow = data.showsWithNewEpisodes[0];
      if (firstShow.episodes && firstShow.episodes.length > 0) {
        const firstEpisode = firstShow.episodes[0];
        if (firstEpisode.id && !firstEpisode._enriched && !firstEpisode.title) {
          return true;
        }
      }
    }

    return false;
  }
}
