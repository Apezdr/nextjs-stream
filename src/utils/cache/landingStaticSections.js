"use cache"
import { cacheLife, cacheTag } from "react"

// Cache static sections that are shared across all users
export async function getCachedStaticSections() {
  cacheLife("days") // Static content cached for days
  cacheTag("static-sections") // Tag for content updates
  
  return [
    {
      id: "recently-added",
      label: "Recently Added", 
      type: "recentlyAdded",
      static: true,
      priority: 3 // After user playlists
    },
    {
      id: "movies",
      label: "Movies",
      type: "movie",
      sort: "id",
      sortOrder: "asc", 
      static: true,
      priority: 4
    },
    {
      id: "tv", 
      label: "TV",
      type: "tv",
      sort: "id",
      sortOrder: "asc",
      static: true,
      priority: 5
    }
  ]
}

// Cache watch history section (user-specific but stable)
export async function getCachedWatchHistorySection(userId) {
  if (!userId) return null
  
  cacheLife("hours") // User-specific content cached for hours
  cacheTag(`user-watch-history-${userId}`) // User-specific tag
  
  return {
    id: "watch-history",
    label: "Watch History",
    type: "recentlyWatched",
    static: false,
    priority: 1, // Always first after welcome
    userId: userId
  }
}
