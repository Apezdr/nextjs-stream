/* eslint-disable @typescript-eslint/no-empty-function */
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
  experimental: {
    reactCompiler: true,
    //esmExternals: false,
  },
  // ESLint Configuration
  pageExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'mdx'],
  eslint: {
    // Run ESLint on these directories during the build process
    dirs: ['app', 'components', 'layouts', 'scripts'],
    // Ensure ESLint runs in development and fails the build on errors
    ignoreDuringBuilds: false,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 259200,
    remotePatterns: [{
      protocol: 'https',
      hostname: '**', // Allows all hosts
    }],
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
