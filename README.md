# Notes for users that log into the app
When a new user logs into the app their account will be rejected by default, unless they are an admin user or automatic approval is enabled. Admin users **exclusively** control who is permitted to log in, changing a users `Approved` flag will stop them from navigating around if they're active otherwise if they're not allowed it will prevent them from logging in and they will get a "Waiting for Approval" messaging.

**New:** You can now configure automatic user approval using the `AUTO_APPROVE_USERS` environment variable. See the [User Approval System documentation](USER_APPROVAL_SYSTEM.md) for details.

# Issues with Video Playback
Unfortunately not all browsers support HEVC properly with HDR, so if you're playing a 4k designated video it will require you to cast it or use a browser that supports HEVC proper. There's a list on the web for HEVC with HDR supported browsers but I usually go to Microsoft Edge for my 4k video playback or any videos really. Seems to preload faster overall for videos in Edge.

# NextJS-Stream App Implementation

**Note:** It is recommended to self-host the app and all related services on the same machine to simplify setup.

To implement the NextJS-Stream app, follow these steps:

1. Visit the following GitHub repository:
    https://github.com/Apezdr/nextjs-stream

2. Clone the repository to your local machine:
   
    `git clone https://github.com/Apezdr/nextjs-stream.git`
   

3. Navigate to the cloned directory:
   
    `cd nextjs-stream`
   

4. Install the required dependencies:
   
    `npm install`
   

5. Configure the environment variables:
    Create a `.env.local` file in the root directory and add the following variables:
    ```env
    # Database Configuration
    MONGODB_URI=mongodb://dbUser:your_password@your_ip:your_port/?authMechanism=DEFAULT
    MONGODB_DB=Media
    MONGODB_DB_USERS=Users
    
    # NextAuth Configuration
    NEXTAUTH_SECRET=your_nextauth_secret
    AUTH_TRUST_HOST="true"
    AUTH_GOOGLE_ID=your_google_client_id
    AUTH_GOOGLE_SECRET=your_google_client_secret
    AUTH_DISCORD_ID=your_discord_client_id
    AUTH_DISCORD_SECRET=your_discord_client_secret
    
    # TMDB Server Configuration (Optional)
    # Dedicated TMDB server URL for external media integration
    # Falls back to NEXT_PUBLIC_NODE_SERVER_URL if not set
    TMDB_NODE_SERVER_URL=https://subdomain.your-domain.com/node/tmdb # Optional
    
    # Chromecast Configuration (Optional)
    CHROMECAST_RECEIVER_ID=your_chromecast_receiver_id # Optional
    
    # Base URL Configuration
    NEXT_PUBLIC_BASE_URL=https://cinema.your-domain.com
    
    # Webhook Configuration
    WEBHOOK_ID=322fb39e4591514d2b8c1697sbc72c9c
    WEBHOOK_ID_2=521ebe9e6211514d2b8c1697sbc72c98
    
    # Radarr Configuration (Optional)
    # Only needed if you are using Radarr integration
    RADARR_ICAL_LINK=https://your-radarr-server.com/radarr/feed/v3/calendar/Radarr.ics?unmonitored=true&apikey=your_api_key&PastDays=1880&FutureDays=380 # Optional
    RADARR_URL=your_radarr_url # Optional
    RADARR_API_KEY=your_radarr_api_key # Optional
    
    # Sonarr Configuration (Optional)
    # Only needed if you are using Sonarr integration
    SONARR_URL=your_sonarr_url # Optional
    SONARR_API_KEY=your_sonarr_api_key # Optional
    
    # Tdarr Configuration (Optional)
    # Only needed if you are using Tdarr integration
    TDARR_URL=your_tdarr_url # Optional
    TDARR_API_KEY=your_tdarr_api_key # Optional
    
    # SABnzbd Configuration (Optional)
    # Only needed if you are using SABnzbd integration
    SABNZBD_URL=http://192.168.1.2:8080/sabnzbd # Example URL, replace with your actual URL # Optional
    SABNZBD_API_KEY=your_sabnzbd_api_key # Optional
    
    # Public URLs and Paths
    NEXT_PUBLIC_ORGANIZR_URL=http://localhost:3000
    NEXT_PUBLIC_FILE_SERVER_URL=https://subdomain.your-domain.com
    NEXT_PUBLIC_FILE_SERVER_PREFIX_PATH= # Optional prefix path for file server
    NEXT_PUBLIC_ADMIN_USER_EMAILS=email1@xxxx.com,email2@zzzz.com
    
    # Site Information (Optional)
    # Use these variables to customize the site title and description
    NEXT_PUBLIC_SITE_TITLE=Cinema Sanctuary # Optional
    NEXT_PUBLIC_SITE_DESCRIPTION=Sharing media content with friends and family. # Optional
    
    # Sync URL, uses the node server
    NEXT_PUBLIC_NODE_SERVER_URL=http://localhost:3000
    
    # User Approval Settings (Optional)
    # Set to 'true' to automatically approve new users, 'false' to require manual admin approval (default)
    AUTO_APPROVE_USERS=false # Optional

   ```

    Replace the placeholder values with your actual credentials and API keys. Anywhere you see `cinema.your-domain.com` or `subdomain.your-domain.com` you don't have to use a subdomain but it would generally be the approach on the same host.

   ## Set up Admin users
   To set up an admin user (until roles are implemented proper) you can set up admin users through the environment variable `NEXT_PUBLIC_ADMIN_USER_EMAILS` there can be one or multiple, seperate multiple with a comma.

   **Single:**
   `email1@xxxx.com`
   
   **Multiple:**
   `email1@xxxx.com,email2@zzzz.com`


   ## Webhook
   If you're using the auto sync feature you must set up the `WEBHOOK_ID` or if using multiple servers `WEBHOOK_ID_2` etc.; with a randomized string to act as the key. This also is used for node server health checks.

   **Endpoint:**
   
   `POST` -> `/api/admin/sync`
   
   **Params**:
   
   `X-Webhook-ID`: Use one of your ID's set up under `WEBHOOK_ID`,
   
   `Content-Type`: `application/json`

7. Configure next.config.js:
    Update your `next.config.js` file with the following configurations:

    **Disclaimer: It's recommended to only update the remotePatterns to match the server hosting the files for your media server.**

    ```javascript
    const nextConfig = {
      reactStrictMode: true,
      experimental: {
        reactCompiler: true,
        esmExternals: false,
      },
      pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
      eslint: {
        dirs: ['app', 'components', 'layouts', 'scripts'],
        ignoreDuringBuilds: false,
      },
      images: {
        minimumCacheTTL: 604800,
        remotePatterns: [
          {
            protocol: 'https',
            hostname: 'subdomain.your-domain.com',
          },
          {
            protocol: 'https',
            hostname: 'image.tmdb.org',
          },
          {
            protocol: 'https',
            hostname: 'm.media-amazon.com',
          },
          {
            protocol: 'https',
            hostname: 'iconape.com',
          },
          {
            protocol: 'https',
            hostname: 'www.freeiconspng.com',
          },
        ],
      },
    }

    module.exports = nextConfig
    ```

    Replace 'subdomain.your-domain.com' with your actual server hostname (think in the context of a file host).

8. Run the development server:
   
    `npm run dev`
   

9. Open your browser and visit `http://localhost:3000` to see the app running.

10. Explore the code in the repository to understand the implementation details and customize as needed for your project.

Remember to keep your `.env.local` file secure and never commit it to version control.

## Watchlist and TMDB Integration

This application includes a comprehensive watchlist system with support for both internal library media and external TMDB-only content. Users can create custom playlists, share them with others, and manage their viewing preferences.

### Watchlist Features

- **Personal Watchlists**: Add movies and TV shows from your library or external TMDB content
- **Custom Playlists**: Create and organize multiple themed playlists
- **Playlist Sharing**: Share playlists with other users with configurable permissions
- **External Media Support**: Add movies/shows not in your library via TMDB integration
- **Dual Search System**: Comprehensive search across both internal database and TMDB
- **Bulk Operations**: Manage multiple items at once
- **Smart Filtering**: Advanced search and filter capabilities

### TMDB Server Configuration

The application supports a dedicated TMDB server configuration for enhanced external media integration:

#### Environment Variables

- `TMDB_API_KEY`: Your TMDB API key (required for external media features)
- `TMDB_NODE_SERVER_URL`: Optional dedicated TMDB server URL
  - Falls back to `NEXT_PUBLIC_NODE_SERVER_URL` if not specified
  - Useful for load balancing or dedicated TMDB processing

#### Configuration Examples

**Basic Setup (using main server):**
```env
TMDB_API_KEY=your_tmdb_api_key
NEXT_PUBLIC_NODE_SERVER_URL=https://your-server.com/node
```

**Dedicated TMDB Server:**
```env
TMDB_API_KEY=your_tmdb_api_key
NEXT_PUBLIC_NODE_SERVER_URL=https://your-server.com/node
TMDB_NODE_SERVER_URL=https://tmdb-server.your-domain.com/node
```

### Watchlist API Endpoints

The watchlist system provides comprehensive REST API endpoints:

#### Core Operations
- `GET /api/authenticated/watchlist?action=list` - Get user's watchlist
- `POST /api/authenticated/watchlist?action=add` - Add item to watchlist
- `POST /api/authenticated/watchlist?action=toggle` - Toggle item in watchlist
- `DELETE /api/authenticated/watchlist?action=remove` - Remove item from watchlist
- `GET /api/authenticated/watchlist?action=status` - Check if item is in watchlist

#### Playlist Operations
- `GET /api/authenticated/watchlist?action=playlists` - Get user's playlists
- `POST /api/authenticated/watchlist?action=create-playlist` - Create new playlist
- `PUT /api/authenticated/watchlist?action=update-playlist` - Update playlist
- `DELETE /api/authenticated/watchlist?action=delete-playlist` - Delete playlist
- `POST /api/authenticated/watchlist?action=share-playlist` - Share playlist with users

#### Bulk Operations
- `POST /api/authenticated/watchlist?action=bulk-update` - Bulk update items
- `DELETE /api/authenticated/watchlist?action=bulk-remove` - Bulk remove items
- `POST /api/authenticated/watchlist?action=move-items` - Move items between playlists

### Admin Features

Administrators can monitor TMDB server status through the admin dashboard:

- **Connection Status**: Real-time TMDB server connectivity monitoring
- **Configuration Validation**: Verify API keys and server URLs
- **Health Metrics**: Response times and service availability
- **Error Diagnostics**: Detailed error reporting and troubleshooting

### Troubleshooting TMDB Integration

#### Common Issues

**TMDB Server Not Configured:**
- Ensure `TMDB_API_KEY` is set in your environment
- Verify `TMDB_NODE_SERVER_URL` or `NEXT_PUBLIC_NODE_SERVER_URL` is configured
- Check the admin dashboard for configuration status

**Connection Failures:**
- Verify server URLs are accessible
- Check firewall and network settings
- Review server logs for detailed error messages

**API Key Issues:**
- Ensure your TMDB API key is valid and active
- Check API key permissions and rate limits
- Verify the key is correctly set in environment variables

#### Testing Configuration

Use the admin dashboard to test your TMDB configuration:
1. Navigate to the admin panel
2. Check the "TMDB Server Status" section
3. Use the refresh button to test connectivity
4. Review any error messages for troubleshooting guidance

### External Media Integration

When adding external media (not in your library):

1. **Search**: Use the TMDB search functionality to find content
2. **Add to Watchlist**: External items are marked with TMDB metadata
3. **Playlist Organization**: External and internal media can be mixed in playlists
4. **Sharing**: Shared playlists include both internal and external content

External media items include rich metadata from TMDB:
- High-quality posters and backdrops
- Detailed descriptions and cast information
- Release dates and ratings
- Genre classifications

### Dual Search System

The watchlist system features a comprehensive dual search approach that provides the best of both worlds:

#### Search Strategy
1. **Database Search**: Fast partial matching against your internal media library
2. **TMDB Search**: Comprehensive search against The Movie Database
3. **Smart Deduplication**: Automatically filters out TMDB results already in your library
4. **Visual Grouping**: Clear categorization of search results by source

#### Search Categories
- **In Your Watchlist**: Items already added to your current playlist
- **Available in Media Server**: Content from your library that can be added immediately
- **Add from TMDB**: External content not in your library but available via TMDB

#### Benefits
- **Comprehensive Coverage**: Find content whether it's in your library or not
- **Performance Optimized**: Database searches are lightning fast
- **No Duplicates**: Smart filtering prevents showing the same content twice
- **Rich Metadata**: All results include posters, descriptions, and release information

### Deterministic Hydration Strategy

The watchlist system uses an intelligent, deterministic approach to display content that ensures maximum performance and reliability:

#### Hydration Strategy
1. **Database-First**: Primary lookup using internal `mediaId` in flat collections (fastest)
2. **TMDB Fallback**: If `mediaId` fails, lookup using `tmdbId` via `metadata.id` in flat collections
3. **API Fallback**: If both database lookups fail, fetch display data from TMDB API

#### Benefits
- **Performance**: Database lookups are extremely fast compared to API calls
- **Resilience**: Multiple fallback mechanisms ensure content is always displayed
- **Automatic Detection**: Content automatically appears as "available" when added to your library
- **Backward Compatibility**: Works with existing watchlist items regardless of how they were added

#### How It Works
1. **Playlist Loading**: When you view a playlist, each item goes through the hydration process
2. **Smart Detection**: The system automatically determines if content is in your library or external
3. **Seamless Experience**: Internal content shows with "Available now!" and direct links
4. **External Display**: TMDB-only content shows with rich metadata but no direct links

#### Visual Indicators
- **Available Content**: Green checkmark with "Available now!" and clickable links
- **External Content**: Yellow "EXTERNAL" badge with TMDB metadata for browsing
- **Rich Metadata**: All content shows posters, descriptions, ratings, and genre information

This approach ensures your watchlist always reflects the current state of your media library without requiring manual updates or complex synchronization processes.

## Deployment Note

While it is possible to host this app on Vercel, please be aware that the image optimization costs may prevent practical usage at scale. If you choose to deploy on Vercel, it's recommended to use the `unoptimized` flag for `next/image` to avoid these costs at the expense of placeholder images being unavailable.

**Ref:**
https://nextjs.org/docs/app/api-reference/components/image#unoptimized

To do this, add the following to your `next.config.js`:


```javascript
module.exports = {
   images: {
     unoptimized: true,
   },
}
```
