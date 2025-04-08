import isAuthenticated from '@src/utils/routeAuth'
import { 
  getFlatAvailableMoviesCount, 
  getFlatAvailableTVShowsCount 
} from '@src/utils/flatDatabaseUtils'
import { hasWatchHistory } from '@src/utils/flatRecentlyWatchedChecker'

export async function GET(req) {
  try {
    // Check authentication
    const authResult = await isAuthenticated(req)
    if (authResult instanceof Response) {
      return authResult
    }
    
    // Get URL parameters
    const url = new URL(req.url)
    const type = url.searchParams.get('type')
    
    // Handle request based on type
    if (type === 'recentlyWatched') {
      const hasHistory = await hasWatchHistory(authResult.user.id)
      return new Response(
        JSON.stringify({ 
          hasWatchHistory: hasHistory,
          count: hasHistory ? 1 : 0 
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    // Default behavior - get counts and durations in parallel
    const [movieData, tvData] = await Promise.all([
      getFlatAvailableMoviesCount(),
      getFlatAvailableTVShowsCount()
    ])
    
    // Calculate hours from milliseconds
    const movieHours = Math.round(movieData.totalDuration / (1000 * 60 * 60));
    const tvHours = Math.round(tvData.totalDuration / (1000 * 60 * 60));
    
    // Return as JSON
    return new Response(
      JSON.stringify({ 
        moviesCount: movieData.count, 
        tvShowsCount: tvData.count,
        total: movieData.count + tvData.count,
        movieHours,
        tvHours,
        totalHours: movieHours + tvHours
      }), 
      { headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error fetching media counts:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch media counts', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { 'Content-Type': 'application/json' } 
      }
    )
  }
}
