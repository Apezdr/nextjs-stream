/**
 * Shared utilities for media list operations
 * Used by both movie and TV list query functions
 */

/**
 * Serialize MongoDB objects to plain objects for client transfer
 * Handles ObjectId conversion, Date objects, and nested structures
 *
 * @param {*} data - Data to serialize (can be object, array, or primitive)
 * @returns {*} Serialized data safe for client transfer
 */
export function serializeForClient(data) {
  if (!data) return data;
  
  if (Array.isArray(data)) {
    return data.map(item => serializeForClient(item));
  }
  
  if (data instanceof Date) {
    // Convert Date objects to ISO strings
    return data.toISOString();
  }
  
  if (typeof data === 'object' && data !== null) {
    const serialized = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '_id' && value?.toString) {
        // Convert MongoDB ObjectId to string
        serialized[key] = value.toString();
      } else if (value instanceof Date) {
        // Convert Date objects to ISO strings
        serialized[key] = value.toISOString();
      } else if (typeof value === 'object' && value !== null) {
        serialized[key] = serializeForClient(value);
      } else {
        serialized[key] = value;
      }
    }
    return serialized;
  }
  
  return data;
}

/**
 * Validates and normalizes pagination parameters
 * Ensures page and limit are within acceptable ranges
 * 
 * @param {number} page - Page number (1-based)
 * @param {number} limit - Items per page
 * @returns {Object} Validated { page, limit, skip } values
 */
export function validatePaginationParams(page = 1, limit = 20) {
  const validPage = Math.max(1, parseInt(page) || 1);
  const validLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
  const skip = (validPage - 1) * validLimit;
  
  return {
    page: validPage,
    limit: validLimit,
    skip
  };
}

/**
 * Build MongoDB sort query object based on sort order
 * 
 * @param {string} sortOrder - Sort order ('newest' or 'oldest')
 * @param {string} dateField - Field to sort by (e.g., 'metadata.release_date')
 * @returns {Object} MongoDB sort query object
 */
export function buildSortQuery(sortOrder, dateField) {
  return sortOrder === 'oldest' 
    ? { [dateField]: 1 }  // Ascending (oldest first)
    : { [dateField]: -1 }; // Descending (newest first)
}

/**
 * Parse comma-separated string into array, filtering empty values
 * 
 * @param {string} str - Comma-separated string
 * @returns {Array<string>} Array of trimmed non-empty strings
 */
export function parseCommaSeparated(str) {
  if (!str) return [];
  return str.split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Constants for media list operations
 */
export const CONSTANTS = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
  DEFAULT_SORT: 'newest',
  VALID_SORT_OPTIONS: ['newest', 'oldest']
};

/**
 * Build genre filter query for MongoDB
 * Uses $all operator to require ALL specified genres
 * 
 * @param {Array<string>} genres - Genre names to filter by
 * @returns {Object} MongoDB query object or empty object if no genres
 */
export function buildGenreFilter(genres) {
  if (!genres || genres.length === 0) return {};
  
  return {
    'metadata.genres.name': { $all: genres }
  };
}

/**
 * Build HDR filter query for MongoDB
 * Handles comma-separated HDR values like "HDR10, Dolby Vision"
 * Uses regex to match any of the selected HDR types within the string
 *
 * @param {Array<string>} hdrTypes - HDR types to filter by
 * @param {string} hdrField - Field path for HDR data (default: 'hdr')
 * @returns {Object} MongoDB query object or empty object if no HDR types
 */
export function buildHdrFilter(hdrTypes, hdrField = 'hdr') {
  if (!hdrTypes || hdrTypes.length === 0) return {};
  
  // Build regex pattern to match any of the HDR types
  // This handles comma-separated values like "HDR10, Dolby Vision"
  // Pattern: /(HDR10|Dolby Vision)/i (case-insensitive)
  const regexPattern = hdrTypes.map(type => {
    // Escape special regex characters in the HDR type
    return type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|');
  
  return {
    [hdrField]: { $regex: new RegExp(regexPattern, 'i') }
  };
}

/**
 * Build resolution filter query for MongoDB
 * Uses regex to match width-based ranges (handles ultrawide, different aspect ratios)
 *
 * @param {Array<string>} resolutions - Resolution labels to filter by (e.g., '4K', '1080p')
 * @param {string} dimensionsField - Field path for dimensions data (default: 'dimensions')
 * @returns {Object} MongoDB query object or empty object if no resolutions
 */
export function buildResolutionFilter(resolutions, dimensionsField = 'dimensions') {
  if (!resolutions || resolutions.length === 0) return {};
  
  // Build regex patterns based on horizontal resolution (width)
  // This correctly handles ultrawide (3840x1604) as 4K
  const patterns = [];
  
  resolutions.forEach(res => {
    if (res === '4K' || res === '2160p') {
      // 4K: width >= 3000 (includes 3840, 4096, etc.)
      patterns.push('(3[0-9]{3}|[4-9][0-9]{3})x'); // Matches 3000x-9999x
    } else if (res === '1080p') {
      // 1080p: width >= 1900 && < 3000
      patterns.push('(19[0-9]{2}|2[0-9]{3})x'); // Matches 1900x-2999x
    } else if (res === '720p') {
      // 720p: width >= 1200 && < 1900
      patterns.push('(1[2-8][0-9]{2})x'); // Matches 1200x-1899x
    } else if (res === 'SD') {
      // SD: width < 1200
      patterns.push('([0-9]{1,3}|1[01][0-9]{2})x'); // Matches 0x-1199x
    }
  });
  
  if (patterns.length === 0) return {};
  
  // Combine patterns with OR
  const regexPattern = patterns.join('|');
  
  return {
    [dimensionsField]: { $regex: new RegExp(regexPattern) }
  };
}

/**
 * Extract resolution label from dimensions string
 * Uses width-based categorization to handle various aspect ratios correctly
 *
 * @param {string} dimensions - Dimension string (e.g., '3840x2160', '3840x1604')
 * @returns {string|null} Resolution label (e.g., '4K', '1080p') or null
 */
export function dimensionsToResolution(dimensions) {
  if (!dimensions || typeof dimensions !== 'string') return null;
  
  // Extract width (number before 'x')
  const match = dimensions.match(/(\d+)x/);
  if (!match) return null;
  
  const width = parseInt(match[1]);
  
  if (width >= 3000) {
    return '4K';
  } else if (width >= 1900) {
    return '1080p';
  } else if (width >= 1200) {
    return '720p';
  } else if (width > 0) {
    return 'SD';
  }
  
  return null;
}

/**
 * Extract unique genres from media items
 * Used to build filter options
 * 
 * @param {Array} items - Media items with metadata.genres
 * @returns {Array<string>} Sorted array of unique genre names
 */
export function extractUniqueGenres(items) {
  const genreSet = new Set();
  
  items.forEach(item => {
    if (item.metadata?.genres && Array.isArray(item.metadata.genres)) {
      item.metadata.genres.forEach(genre => {
        if (genre && genre.name) {
          genreSet.add(genre.name);
        }
      });
    }
  });
  
  return Array.from(genreSet).sort();
}

/**
 * Extract unique HDR types from media items
 * Handles both string and array HDR values
 * 
 * @param {Array} items - Media items with hdr field
 * @param {string} hdrField - Field to extract HDR from (default: 'hdr')
 * @returns {Array<string>} Sorted array of unique HDR types
 */
export function extractUniqueHdrTypes(items, hdrField = 'hdr') {
  const hdrSet = new Set();
  
  items.forEach(item => {
    const hdrValue = item[hdrField];
    
    if (hdrValue) {
      if (typeof hdrValue === 'string') {
        // Handle comma-separated HDR types (e.g., "HDR10, HLG")
        hdrValue.split(',').forEach(type => {
          const trimmed = type.trim();
          if (trimmed) hdrSet.add(trimmed);
        });
      } else if (hdrValue === true) {
        hdrSet.add('HDR');
      } else if (Array.isArray(hdrValue)) {
        hdrValue.forEach(type => {
          if (type) hdrSet.add(type);
        });
      }
    }
  });
  
  return Array.from(hdrSet).sort();
}

/**
 * Parse search params into filter options object
 * Used by Server Components to seed initial client state
 *
 * @param {Object} searchParams - Next.js searchParams object
 * @returns {Object} Filter options object
 */
export function parseSearchParamsToFilters(searchParams = {}) {
  return {
    page: searchParams.page ? parseInt(searchParams.page) : CONSTANTS.DEFAULT_PAGE,
    sortOrder: searchParams.sort || CONSTANTS.DEFAULT_SORT,
    genres: searchParams.genres ? searchParams.genres.split(',').filter(Boolean) : [],
    hdrTypes: searchParams.hdr ? searchParams.hdr.split(',').filter(Boolean) : [],
    resolutions: searchParams.res ? searchParams.res.split(',').filter(Boolean) : []
  };
}