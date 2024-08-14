# Notes for users that log into the app
When a new user logs into the app their account will be rejected by default, unless they are an admin user. Admin users **exclusively** control who is permitted to log in, changing a users `Approved` flag will stop them from navigating around if they're active otherwise if they're not allowed it will prevent them from logging in and they will get a "Waiting for Approval" messaging.

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
    MONGODB_URI=mongodb://dbUser:your_password@your_ip:your_port/?authMechanism=DEFAULT
    MONGODB_DB=Media
    MONGODB_DB_USERS=Users

    NEXTAUTH_SECRET=your_nextauth_secret
    AUTH_TRUST_HOST="true"
    AUTH_GOOGLE_ID=your_google_client_id
    AUTH_GOOGLE_SECRET=your_google_client_secret

    AUTH_DISCORD_ID=your_discord_client_id
    AUTH_DISCORD_SECRET=your_discord_client_secret

    TMDB_API_KEY=your_tmdb_api_key
    OMDB_API_KEY=your_omdb_api_key

    CHROMECAST_RECEIVER_ID=your_chromecast_receiver_id

    NEXT_PUBLIC_BASE_URL=https://cinema.your-domain.com

    VALID_WEBHOOK_IDS=322fb39e4591514d2b8c1697sbc72c9c,521ebe9e6211514d2b8c1697sbc72c98 # file server, some other webapp

    RADARR_ICAL_LINK=https://your-radarr-server.com/radarr/feed/v3/calendar/Radarr.ics?unmonitored=true&apikey=your_api_key&PastDays=1880&FutureDays=380
    
    NEXT_PUBLIC_FILE_SERVER_URL=https://subdomain.your-domain.com
    NEXT_PUBLIC_ADMIN_USER_EMAILS=email1@xxxx.com,email2@zzzz.com
    # Site Title
    NEXT_PUBLIC_SITE_TITLE=Cinema Sanctuary
    # Site Description
    NEXT_PUBLIC_SITE_DESCRIPTION=Sharing media content with friends and family.
   ```

    Replace the placeholder values with your actual credentials and API keys. Anywhere you see `cinema.your-domain.com` or `subdomain.your-domain.com` you don't have to use a subdomain but it would generally be the approach on the same host.

   ## Set up Admin users
   To set up an admin user (until roles are implemented proper) you can set up admin users through the environment variable `NEXT_PUBLIC_ADMIN_USER_EMAILS` there can be one or multiple, seperate multiple with a comma.

   **Single:**
   `email1@xxxx.com`
   
   **Multiple:**
   `email1@xxxx.com,email2@zzzz.com`


   ## Webhook
   If you're using the auto sync feature you must set up the `VALID_WEBHOOK_IDS` with a randomized string to act as the key to be used by your `generate_list.sh` on the backend that runs to generate the JSON lists. It's also necessary to update the `generate_list.sh` file with the new webhook ID.

   **Endpoint:**
   
   `POST` -> `/api/admin/sync`
   
   **Params**:
   
   `X-Webhook-ID`: Use one of your ID's set up under `VALID_WEBHOOK_IDS`,
   
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