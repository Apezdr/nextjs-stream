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
    - Sync Operations:
        - Movies: metadata, captions, video info
        - TV Shows: show/season/episode data
        - Media Assets: posters, backdrops, thumbnails
    - Concurrency Control:
        - Subscriber pattern for handling multiple sync requests
        - Webhook support for external triggers
        - Progress tracking and error handling
