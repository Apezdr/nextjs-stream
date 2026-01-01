# Flat Media Structure Sync Utilities

This module provides utilities for syncing data between file servers and a flat database structure with separate collections for Movies, TV Shows, Seasons, and Episodes.

## Key Features

- Separate collections for each entity type (Movies, TV Shows, Seasons, Episodes)
- Proper indexing for efficient queries
- Hash-based synchronization for improved performance
- Parallel processing for faster sync operations
- Video availability checking and cleanup

## Collections

The flat structure uses the following collections:

- `FlatMovies`: For movie data
- `FlatTVShows`: For TV show data
- `FlatSeasons`: For season data
- `FlatEpisodes`: For episode data

## Usage Example

```javascript
import { syncToFlatStructure } from '@src/utils/flatSync';

// Sync data from a file server to the flat structure
const results = await syncToFlatStructure(
  fileServerData,
  serverConfig,
  fieldAvailability,
  false, // skipInitialization
  true   // checkAvailability - check and remove unavailable videos
);
```

## Video Availability

The module includes functions to check video availability across file servers and remove unavailable videos from the flat database structure.

### Basic Usage

```javascript
import { 
  checkAndRemoveUnavailableVideosFlat 
} from '@src/utils/flatSync';

// Check and remove unavailable videos
const results = await checkAndRemoveUnavailableVideosFlat(currentDB, fileServers);
```

### Advanced Usage

```javascript
import {
  checkVideoAvailabilityAcrossServers,
  removeUnavailableVideosFlat
} from '@src/utils/flatSync';

// Check video availability
const recordsToRemove = await checkVideoAvailabilityAcrossServers(currentDB, fileServers);

// Now you can inspect or modify recordsToRemove if needed

// Remove unavailable videos
const results = await removeUnavailableVideosFlat(recordsToRemove);
```

## Database Structure

Each collection follows a specific schema:

### FlatMovies

```javascript
{
  _id: ObjectId,
  title: String,  // Unique
  type: 'movie',
  metadata: Object,
  videoURL: String,
  posterURL: String,
  // ... other fields
}
```

### FlatTVShows

```javascript
{
  _id: ObjectId,
  title: String,  // Unique
  type: 'tvShow',
  metadata: Object,
  poster: String,
  // ... other fields
}
```

### FlatSeasons

```javascript
{
  _id: ObjectId,
  showId: ObjectId,  // Reference to FlatTVShows._id
  showTitle: String,
  seasonNumber: Number,
  type: 'season',
  metadata: Object,
  seasonPoster: String,
  // ... other fields
}
```

### FlatEpisodes

```javascript
{
  _id: ObjectId,
  showId: ObjectId,  // Reference to FlatTVShows._id
  seasonId: ObjectId,  // Reference to FlatSeasons._id
  showTitle: String,
  seasonNumber: Number,
  episodeNumber: Number,
  type: 'episode',
  title: String,
  metadata: Object,
  videoURL: String,
  thumbnail: String,
  // ... other fields
}
```
