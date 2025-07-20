# Genres API Endpoint Documentation

## Overview
The Genres API endpoint provides comprehensive genre-based content discovery for your React Native TV App. It supports listing available genres, filtering content by genres, and retrieving genre statistics.

**Base URL:** `/api/authenticated/genres`  
**Method:** `GET`  
**Authentication:** Required (supports both web sessions and mobile JWT tokens)

## Actions

The endpoint supports three main actions controlled by the `action` query parameter:

### 1. List Genres (`action=list`)
Retrieves all available genres with optional content counts.

### 2. Get Content by Genre (`action=content`)
Filters and retrieves content (movies/TV shows) by specific genres with pagination and sorting.

### 3. Genre Statistics (`action=statistics`)
Provides analytics and statistics about genres and their content distribution.

---

## Query Parameters

### Common Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `action` | string | `"list"` | Action to perform: `"list"`, `"content"`, or `"statistics"` |
| `type` | string | `"all"` | Content type filter: `"all"`, `"movie"`, or `"tv"` |
| `isTVdevice` | boolean | `false` | Enable TV device optimizations (exposes additional data like videoURL, duration) |

### List Action Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `includeCounts` | boolean | `true` | Include content counts for each genre |

### Content Action Parameters

| Parameter | Type | Default | Required | Description |
|-----------|------|---------|----------|-------------|
| `genre` | string | - | ✅ | Genre name(s) to filter by (comma-separated for multiple) |
| `page` | number | `0` | - | Page number for pagination (0-based) |
| `limit` | number | `30` | - | Number of items per page |
| `sort` | string | `"newest"` | - | Sort method: `"newest"`, `"oldest"`, `"title"`, `"rating"` |
| `sortOrder` | string | `"desc"` | - | Sort order: `"asc"` or `"desc"` |
| `includeWatchHistory` | boolean | `false` | - | Include user's watch history data |

### Statistics Action Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `genre` | string | - | Filter statistics to specific genre(s) (comma-separated) |

---

## Request Examples

### 1. List All Available Genres
```
GET /api/authenticated/genres?action=list&includeCounts=true
```

### 2. List Movie Genres Only
```
GET /api/authenticated/genres?action=list&type=movie&includeCounts=true
```

### 3. Get Action Movies (First Page)
```
GET /api/authenticated/genres?action=content&genre=Action&type=movie&page=0&limit=20&sort=newest
```

### 4. Get Comedy Content (Movies + TV Shows)
```
GET /api/authenticated/genres?action=content&genre=Comedy&type=all&page=0&limit=30&sort=rating&sortOrder=desc
```

### 5. Get Multiple Genres (Action + Adventure)
```
GET /api/authenticated/genres?action=content&genre=Action,Adventure&type=all&page=0&limit=30
```

### 6. TV Device Optimized Request
```
GET /api/authenticated/genres?action=content&genre=Drama&type=tv&isTVdevice=true&includeWatchHistory=true
```

### 7. Genre Statistics
```
GET /api/authenticated/genres?action=statistics&type=all
```

---

## Response Formats

### List Action Response
```json
{
  "availableGenres": [
    {
      "id": 28,
      "name": "Action",
      "movieCount": 104,
      "tvShowCount": 0,
      "totalCount": 104
    },
    {
      "id": 35,
      "name": "Comedy",
      "movieCount": 113,
      "tvShowCount": 56,
      "totalCount": 169
    },
    {
      "id": 18,
      "name": "Drama",
      "movieCount": 102,
      "tvShowCount": 82,
      "totalCount": 184
    }
  ],
  "totalGenres": 23,
  "mediaTypeCounts": {
    "movies": 319,
    "tvShows": 136,
    "total": 455
  },
  "filters": {
    "type": "all",
    "includeCounts": true
  }
}
```

### Content Action Response
```json
{
  "currentItems": [
    {
      "id": "movie_12345",
      "title": "Action Movie Title",
      "type": "movie",
      "metadata": {
        "release_date": "2024-01-15",
        "vote_average": 7.8,
        "genres": [
          {"id": 28, "name": "Action"},
          {"id": 53, "name": "Thriller"}
        ]
      },
      "customUrl": "/watch/movie/12345",
      "watchHistory": {
        "watched": true,
        "progress": 0.75,
        "lastWatched": "2024-01-20T10:30:00Z"
      }
    }
  ],
  "previousItem": {
    "id": "movie_12344",
    "title": "Previous Movie"
  },
  "nextItem": {
    "id": "movie_12346", 
    "title": "Next Movie"
  },
  "genreInfo": {
    "requestedGenres": ["Action"],
    "totalResults": 245,
    "currentPage": 0,
    "totalPages": 9
  },
  "filters": {
    "type": "movie",
    "sort": "newest",
    "sortOrder": "desc"
  }
}
```

### Statistics Action Response
```json
{
  "genreBreakdown": [
    {
      "id": 18,
      "name": "Drama",
      "movieCount": 102,
      "tvShowCount": 82,
      "totalCount": 184
    },
    {
      "id": 35,
      "name": "Comedy",
      "movieCount": 113,
      "tvShowCount": 56,
      "totalCount": 169
    },
    {
      "id": 28,
      "name": "Action",
      "movieCount": 104,
      "tvShowCount": 0,
      "totalCount": 104
    }
  ],
  "totalGenres": 23,
  "mediaTypeCounts": {
    "movies": 319,
    "tvShows": 136,
    "total": 455
  },
  "topGenres": {
    "byTotalContent": [
      {
        "id": 18,
        "name": "Drama",
        "movieCount": 102,
        "tvShowCount": 82,
        "totalCount": 184
      },
      {
        "id": 35,
        "name": "Comedy",
        "movieCount": 113,
        "tvShowCount": 56,
        "totalCount": 169
      }
    ],
    "byMovieContent": [
      {
        "id": 35,
        "name": "Comedy",
        "movieCount": 113,
        "tvShowCount": 56,
        "totalCount": 169
      },
      {
        "id": 28,
        "name": "Action",
        "movieCount": 104,
        "tvShowCount": 0,
        "totalCount": 104
      }
    ],
    "byTVContent": [
      {
        "id": 18,
        "name": "Drama",
        "movieCount": 102,
        "tvShowCount": 82,
        "totalCount": 184
      },
      {
        "id": 35,
        "name": "Comedy",
        "movieCount": 113,
        "tvShowCount": 56,
        "totalCount": 169
      }
    ]
  },
  "filters": {
    "type": "all",
    "genres": null
  }
}
```

---

## TV Device Optimizations

When `isTVdevice=true` is set, the response includes additional fields optimized for TV playback:

### Additional Fields in Content Items
- `videoURL`: Direct video file URL for playback
- `duration`: Content duration in seconds
- `fileSize`: File size in bytes
- `resolution`: Video resolution (e.g., "1920x1080")
- `codec`: Video codec information

### Example TV Device Response Item
```json
{
  "id": "movie_12345",
  "title": "Action Movie Title",
  "customUrl": "/watch/movie/12345",
  "videoURL": "/api/video/stream/movie_12345.mp4",
  "duration": 7320,
  "fileSize": 2147483648,
  "resolution": "1920x1080",
  "codec": "h264",
  "metadata": {
    "release_date": "2024-01-15",
    "vote_average": 7.8
  }
}
```

---

## Error Responses

### 400 Bad Request
```json
{
  "error": "Genre parameter is required for content action",
  "action": "content",
  "timestamp": "2024-01-20T10:30:00Z"
}
```

### 401 Unauthorized
```json
{
  "error": "Authentication required",
  "timestamp": "2024-01-20T10:30:00Z"
}
```

### 500 Internal Server Error
```json
{
  "error": "Error processing genre request",
  "action": "content",
  "timestamp": "2024-01-20T10:30:00Z"
}
```

---

## Implementation Notes for React Native TV App

### 1. Authentication Headers
Include either:
- **Web Session:** Cookie-based authentication
- **Mobile JWT:** `Authorization: Bearer <jwt_token>` header

### 2. Pagination Strategy
- Use `page=0` for first page
- Check `totalPages` in response for pagination limits
- Use `previousItem` and `nextItem` for smooth navigation

### 3. Genre Selection
- Support multiple genre selection with comma-separated values
- Genre names are case-sensitive (use exact names from list action)

### 4. TV Device Features
- Always set `isTVdevice=true` for TV app requests
- Use `videoURL` field for direct video playback
- Leverage `duration` for progress tracking

### 5. Performance Optimization
- Set appropriate `limit` values (20-30 for TV interfaces)
- Use `includeWatchHistory=false` if not needed to improve response time
- Cache genre list responses as they change infrequently

### 6. Error Handling
- Handle 401 errors by refreshing authentication
- Implement retry logic for 500 errors
- Validate genre names before making content requests

---

## Rate Limiting
This endpoint respects the application's rate limiting policies. For TV apps, consider implementing request debouncing for rapid navigation scenarios.

## CORS Support
The endpoint includes proper CORS headers for cross-origin requests from your React Native TV app.