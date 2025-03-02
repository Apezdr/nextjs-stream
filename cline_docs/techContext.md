## Tech Context

- **Technologies used:**
    - Next.js: A React framework for building server-side rendered applications.
    - React: A JavaScript library for building user interfaces.
    - JavaScript/TypeScript: Programming languages used for development.
    - ESLint: A linter for code quality.
    - MongoDB: Database for storing media metadata and user data.
    - Various third-party libraries and APIs for media streaming and metadata retrieval (e.g., TMDB, OMDB, Radarr, Sonarr, Tdarr, SABnzbd).

- **Development setup:**
    - The project requires Node.js and npm to be installed.
    - Dependencies can be installed using `npm install`.
    - Environment variables need to be configured in a `.env.local` file.
    - The development server can be started using `npm run dev`.

- **Technical constraints:**
    - Browser compatibility issues with HEVC and HDR video playback.
    - Potential image optimization costs when deploying on Vercel.

- **Sync Implementation:**
    - Multi-server architecture with priority-based data ownership
    - Field-level availability tracking:
        ```typescript
        interface FieldAvailability {
          movies: {
            [title: string]: {
              [fieldPath: string]: string[] // Array of server IDs
            }
          },
          tv: {
            [title: string]: {
              [fieldPath: string]: string[] // Array of server IDs
            }
          }
        }
        ```
    - Two-phase sync process:
        1. Gathering Phase:
           - Concurrent data collection from all servers
           - Priority-based field selection
           - Cache-aware metadata fetching
        2. Finalization Phase:
           - Compare timestamps and priorities
           - Merge data based on server ownership
           - Update database with consolidated data
    - Selective Update Pattern:
        - Start with existing data from database instead of empty objects
        - Only update fields that are from the current server or are new
        - Preserve data from other servers that aren't being updated
        - Only mark as changed if there are actual differences
        - Specific comparison logic to prevent update loops between servers
        - Each server only updates its own data or adds new data
        - Maintains proper priority-based selection during the gathering phase
    - Sync Operations:
        - Movies: metadata, captions, video info (including mediaQuality fields)
        - TV Shows: show/season/episode data
        - Media Assets: posters, backdrops, thumbnails
    - Media Quality Tracking:
        - Format information (HEVC, AVC, etc.)
        - Bit depth (8-bit, 10-bit, etc.)
        - Color space (BT.709, BT.2020, etc.)
        - Transfer characteristics (SDR, HDR, etc.)
        - HDR format support (Dolby Vision, HDR10+, standard HDR)
        - Enhanced viewing experience flags
    - Concurrency Control:
        - Subscriber pattern for handling multiple sync requests
        - Webhook support for external triggers
        - Progress tracking and error handling
