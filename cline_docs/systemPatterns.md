## System Patterns

- **How the system is built:** The system is built using Next.js, a React framework. It follows a component-based architecture, with components organized in the `src/components` directory. The `src/app` directory contains the route handlers and layout components.

- **Key technical decisions:**
    - Using Next.js for server-side rendering and routing.
    - Enabling React Strict Mode for development.
    - Using a standalone deployment.
    - Enabling the experimental React Compiler for performance optimization.
    - Configuring ESLint for code quality.
    - Configuring image optimization with specific formats and remote patterns.

- **Architecture patterns:** 
    - The system follows a typical Next.js architecture with a focus on server-side rendering and component-based development.
    - Multi-server sync architecture:
        - Field-level availability tracking to manage data ownership across servers
        - Priority-based synchronization where higher priority servers take precedence
        - Two-phase sync process:
            1. Gathering Phase: Collect data from all servers concurrently
            2. Finalization Phase: Compare and merge data based on priority
        - Selective update pattern:
            - Start with existing data from database instead of empty objects
            - Only update fields that are from the current server or are new
            - Preserve data from other servers that aren't being updated
            - Only mark as changed if there are actual differences
            - Prevents update loops between servers
        - Subscriber pattern for sync operations to handle concurrent sync requests
        - Webhook support for external sync triggers
        - Granular sync operations:
            - Movies: metadata, captions, video info
            - TV Shows: show metadata, season data, episode details
            - Media assets: posters, backdrops, thumbnails, logos
        - Error handling and rollback mechanisms
        - Progress tracking and logging
    - It also utilizes various third-party libraries and APIs for media streaming and metadata retrieval.
