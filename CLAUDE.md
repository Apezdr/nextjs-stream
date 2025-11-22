# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Core Development
- `npm run dev` - Start development server on port 3232
- `npm run dev-turbo` - Start development server with Turbopack on port 3232
- `npm run build` - Build the application for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint with auto-fix on app, components, lib, layouts, and scripts directories
- `npm run analyze` - Build with bundle analysis enabled

### Testing
- `npm test` - Run Jest tests
- `npm run test:watch` - Run Jest tests in watch mode

## Architecture Overview

### Technology Stack
- **Framework**: Next.js 15 with React 19
- **Language**: TypeScript/JavaScript (mixed codebase)
- **Database**: MongoDB with custom adapter
- **Authentication**: NextAuth.js with Google/Discord providers
- **Media Integration**: TMDB API for external metadata
- **Testing**: Jest with React Testing Library
- **Styling**: Tailwind CSS with custom components

### Directory Structure
- `src/app/` - Next.js App Router pages and API routes
- `src/components/` - Reusable React components organized by feature
- `src/lib/` - Core utilities (MongoDB, auth configuration)
- `src/utils/` - Business logic utilities and database operations
- `src/contexts/` - React contexts for global state

### Database Architecture
Two sync implementations exist:
1. **Traditional Sync** (`src/utils/sync/`) - Nested document structure
2. **Flat Database Sync** (`src/utils/flatSync/`) - Separate collections for Movies, TV Shows, Seasons, Episodes

Current implementation uses flat database structure for better performance with large datasets.

### Key Components

#### Authentication System
- Uses NextAuth.js with MongoDB adapter
- Custom user approval system (admin-controlled or auto-approval)
- QR code authentication for mobile devices
- Path aliases: `@src/*` and `@components/*`

#### Media Management
- Multi-server architecture with priority-based data ownership
- Comprehensive sync system with hash-based optimization
- Support for multiple media qualities (4K, HDR, Dolby Vision)
- Integration with external services (Radarr, Sonarr, Tdarr, SABnzbd)

##### Dual-Title Architecture (CRITICAL)
**Two distinct title types are used throughout the system:**

1. **`originalTitle`** - Filesystem key used in file server operations
   - Used for all file server paths: `/movies/${originalTitle}/poster.jpg`
   - Primary key for database lookups in new sync architecture
   - Represents actual folder/file names on servers
   - **Always use for filesystem operations and database keys**

2. **`title`** - Pretty display name from TMDB metadata
   - Used for UI display and user-facing features
   - Sourced from TMDB API for consistent naming
   - May differ from filesystem names
   - **Use for display/UI purposes only**

**Example:**
```javascript
// ✅ CORRECT - Use originalTitle for filesystem operations
const posterPath = `/movies/${movie.originalTitle}/poster.jpg`
const dbLookup = await repository.findByOriginalTitle(originalTitle)

// ✅ CORRECT - Use title for display
const displayName = movie.title // "The Matrix"

// ❌ WRONG - Never use title for filesystem operations
const wrongPath = `/movies/${movie.title}/poster.jpg` // Will fail!
```

##### Multi-Server Priority System (CRITICAL)
**Field-level priority management using `fieldAvailability` and server priorities:**

- Each field can have different source servers based on data availability
- Server priority determines data precedence (lower number = higher priority)
- Pre-computed `fieldAvailability` object maps which servers have data for each field
- Use `isCurrentServerHighestPriorityForField()` before updating any field

**Priority Check Pattern:**
```javascript
import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'

// Always check priority before updating fields
const canUpdate = isCurrentServerHighestPriorityForField(
  fieldAvailability,
  'movies',
  originalTitle,  // Use originalTitle as key
  'posterURL',
  serverConfig
)

if (canUpdate) {
  movie.posterURL = newUrl
  movie.posterSource = serverConfig.id
}
```

**Field-Level Source Tracking:**
- `metadataSource`, `videoSource`, `posterSource`, etc.
- Each field tracks which server provided the data
- Enables granular conflict resolution and data provenance

#### Watchlist System
- Personal and shared playlists
- Dual search (internal database + TMDB)
- External media support via TMDB integration
- Smart deduplication and deterministic hydration

## Development Guidelines

### File Organization
- Use TypeScript for new files in `/src/lib/` and `/src/app/api/`
- JavaScript is acceptable for components and utilities
- Follow existing patterns for component organization
- Use path aliases `@src/*` and `@components/*`

### Environment Configuration
Create `.env.local` with required variables:
- MongoDB connection and database names
- NextAuth configuration and provider secrets
- TMDB integration settings
- Admin user emails
- Server URLs and webhook IDs

### Testing
- Test files should be in `__tests__/` directory
- Use Jest with jsdom environment
- Mock external dependencies in `__mocks__/`
- Follow existing patterns for component testing

### Sync System

#### Two Sync Architectures (Current State)

**1. Traditional Flat Sync** (`src/utils/flatSync/`)
- Production system currently in use
- Field-level priority system with `fieldAvailability`
- Uses `originalTitle` as database keys
- Granular source tracking per field

**2. New Domain-Driven Sync** (`src/utils/sync/`)
- Modern architecture with TypeScript support
- Strategy pattern with pluggable sync operations
- Built on proven priority system from flat sync
- Domain-specific services (MovieSyncService, etc.)

#### Critical Sync Architecture Rules

**ALWAYS use `originalTitle` for sync operations:**
```javascript
// ✅ CORRECT - All sync operations use originalTitle
const movie = await repository.findByOriginalTitle(originalTitle)
const assetPath = `/movies/${originalTitle}/poster.jpg`
const canUpdate = isCurrentServerHighestPriorityForField(
  fieldAvailability, 'movies', originalTitle, 'posterURL', serverConfig
)
```

**New Sync Architecture Components:**
- `SyncManager` - Main orchestrator with dual-title support
- `MovieMetadataStrategy` - Handles metadata with priority checking
- `MovieAssetStrategy` - Manages assets (posters, backdrops, logos) with priority
- `BaseRepository` - Uses `originalTitle` for all database operations
- `SyncContext` - Enhanced with `entityTitle` and `entityOriginalTitle`

**Priority System Integration:**
- Import `isCurrentServerHighestPriorityForField` from `@src/utils/sync/utils`
- Check priority before every field update
- Use `fieldAvailability` object for pre-computed server data mapping
- Respect existing server priority configuration

**New Architecture Benefits:**
- Type safety with TypeScript interfaces
- Clear separation of concerns with strategy pattern
- Comprehensive error handling and event tracking
- Performance optimizations with caching and bulk operations
- Real-time progress monitoring and observability

### API Routes
- Authentication required routes under `/api/authenticated/`
- Use Next.js App Router conventions
- Follow existing patterns for error handling and response formatting

## Common Patterns

### Database Operations
- Use `clientPromise` from `@src/lib/mongodb`
- Implement proper error handling and connection management
- Follow flat database patterns for new features

#### Sync Development Patterns

**When working with movie/media sync:**
```javascript
// ✅ ALWAYS use originalTitle for database/filesystem operations
const movie = await movieRepository.findByOriginalTitle(originalTitle)
const videoPath = `/movies/${originalTitle}/video.mp4`

// ✅ ALWAYS check server priority before updates
const canUpdatePoster = isCurrentServerHighestPriorityForField(
  fieldAvailability, 'movies', originalTitle, 'posterURL', serverConfig
)

if (canUpdatePoster) {
  movie.posterURL = newPosterUrl
  movie.posterSource = serverConfig.id
}

// ✅ Use title for display purposes only
const displayTitle = movie.title // For UI components
```

**New Sync Strategy Pattern:**
```javascript
// When creating new sync strategies
class NewSyncStrategy implements SyncStrategy {
  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const originalTitle = context.entityOriginalTitle || entity?.originalTitle
    
    // Use originalTitle for all filesystem operations
    const dataPath = `/movies/${originalTitle}/data.json`
    
    // Check priority before updating
    if (this.shouldUpdateField('fieldName', originalTitle, context)) {
      // Perform update with source tracking
    }
  }
  
  private shouldUpdateField(fieldPath: string, mediaTitle: string, context: SyncContext): boolean {
    return isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'movies', mediaTitle, fieldPath, context.serverConfig
    )
  }
}
```

### Component Development
- Use Tailwind CSS for styling
- Implement skeleton loading states
- Follow accessibility best practices
- Use React hooks for state management

### Error Handling
- Implement proper error boundaries
- Use toast notifications for user feedback
- Log errors appropriately without exposing sensitive data

## Linting and Code Quality
- ESLint runs on app, components, lib, layouts, and scripts directories
- Prettier configuration available
- TypeScript strict mode enabled with custom path mappings
- Pre-commit hooks ensure code quality

## Troubleshooting Sync Issues

### Common Mistakes to Avoid

**❌ Using `title` for filesystem operations:**
```javascript
// WRONG - Will cause 404 errors
const posterPath = `/movies/${movie.title}/poster.jpg`
```

**❌ Not checking server priority:**
```javascript
// WRONG - May overwrite higher priority data
movie.posterURL = newUrl // Direct assignment without priority check
```

**❌ Using `title` as database key:**
```javascript
// WRONG - Should use originalTitle
const movie = await repository.findByTitle(title)
```

### Quick Fixes

**✅ Always use originalTitle for filesystem/database:**
```javascript
const movie = await repository.findByOriginalTitle(originalTitle)
const assetPath = `/movies/${originalTitle}/asset.jpg`
```

**✅ Always check priority before field updates:**
```javascript
if (isCurrentServerHighestPriorityForField(fieldAvailability, 'movies', originalTitle, 'posterURL', serverConfig)) {
  movie.posterURL = newUrl
  movie.posterSource = serverConfig.id
}
```

**✅ Use title only for display:**
```javascript
const displayName = movie.title // UI components only
```
- Remember that the title and original title are used for different things; the Title is used for the Display/UI where as the originalTitle is used for filesystem lookup/key in the file system data.
- To test the sync operation:\
http://localhost:3232/api/authenticated/admin/sync\
\
Headers:\
X-Webhook-ID:507f131e4591274d9b8c1691bbd76c9c
- Avoid defaulting values to proceed when errors arise in the new architecture flatsync process. It is crucial that we build a resiliant and bulletproof sync structure that relies on data that is properly passed within the functions.