 
const dotenv = require('dotenv')
dotenv.config()

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // The compiler reduces the amount of manual memoization
  // developers have to do through APIs such as useMemo and useCallback
  // - making code simpler, easier to maintain, and less error prone.
  // -----Removed but will be needed to upgrade to React 19-----
  reactCompiler: true,
  // Enable Cache Components for Partial Pre-rendering (PPR)  
  // This allows instant static shell loads while dynamic content streams in
  cacheComponents: true,
  cacheLife: {
    // Media library lists - 1 minute cache for fresh content while reducing DB load
    mediaLists: {
      stale: 60,        // 1 minute client cache
      revalidate: 60,   // 1 minute server revalidation
      expire: 300,      // 5 minutes max before forced refresh
    },
    // Navigation and UI components - rarely change
    navigation: {
      stale: 300,       // 5 minutes client cache
      revalidate: 3600, // 1 hour server revalidation
      expire: 86400,    // 1 day expiration
    },
    // User-specific content - moderate frequency
    userContent: {
      stale: 60,        // 1 minute client cache
      revalidate: 900,  // 15 minutes server revalidation
      expire: 3600,     // 1 hour expiration
    },
    // System status - frequently updated
    systemStatus: {
      stale: 30,        // 30 seconds client cache
      revalidate: 60,   // 1 minute server revalidation
      expire: 300,      // 5 minutes expiration
    },
  },
  //esmExternals: false,
  // ESLint Configuration
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  allowedDevOrigins: ['localhost', 'cinema-local.adamdrumm.com'],
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 259200,
    remotePatterns: [{
      protocol: 'https',
      hostname: '**', // Allows all hosts
      port: '',
      pathname: '/**',
    }],
    qualities: [25, 50, 75, 90, 100],
    // remotePatterns: process.env.REMOTE_PATTERNS
    //   ? process.env.REMOTE_PATTERNS.split(',').map((pattern) => {
    //       const [protocol, hostname] = pattern.trim().split('://')
    //       return { protocol, hostname }
    //     })
    //   : [
    //       {
    //         protocol: 'https',
    //         hostname: 'image.tmdb.org',
    //       },
    //       {
    //         protocol: 'https',
    //         hostname: 'm.media-amazon.com',
    //       },
    //       {
    //         protocol: 'https',
    //         hostname: 'iconape.com',
    //       },
    //       {
    //         protocol: 'https',
    //         hostname: 'www.freeiconspng.com',
    //       },
    //     ],
  },
  // Additional Next.js configurations can be added here
  /* webpack(config) {
    Object.defineProperty(config, 'devtool', {
      get() {
        return 'source-map'
      },
      set() {},
    })
    return config
  }, */
  //productionBrowserSourceMaps: true,
}

module.exports = nextConfig
