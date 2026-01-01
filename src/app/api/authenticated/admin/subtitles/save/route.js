import isAuthenticated, { isAuthenticatedEither } from '@src/utils/routeAuth'
import { getServer } from '@src/utils/config'

export async function POST(req) {
  // Ensure user is authenticated and has admin rights
  const authResult = await isAuthenticatedEither(req) // second param = requireAdmin
  if (authResult instanceof Response) {
    return authResult // Return the unauthorized response if not admin
  }

  if (!authResult.admin) {
    return new Response(JSON.stringify({ 
      success: false,
      error: 'User is not an admin'
    }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  try {
    const { 
      subtitleContent, 
      mediaType, 
      mediaTitle, 
      language, 
      season, 
      episode,
      sourceServerId
    } = await req.json()

    if (!subtitleContent || !mediaType || !mediaTitle || !language) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: 'Missing required parameters' 
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Get the server configuration
    const server = getServer(sourceServerId)
    const nodeServerUrl = server.syncEndpoint

    console.log(`sub save server: ${JSON.stringify(server, null, 2)}`)
    console.log(`nodeServerUrl: ${nodeServerUrl}`)

    // Construct URL for saving the subtitle file
    let saveUrl = `${nodeServerUrl}/api/admin/subtitles/save`
    console.log(`Saving subtitles to URL: ${saveUrl}`)
    
    // Prepare headers for authentication to the backend
    const headers = {
      'Content-Type': 'application/json',
      'Cookie': req.headers.get('cookie') || '' // Forward cookies from the original request
    };
    
    // Authentication forwarding priority:
    // 1. Authorization header (Bearer token)
    // 2. Session token
    // 3. Mobile token
    // 4. Auth result token (from isAuthenticated)
    
    // Forward Authorization header if present
    const authHeader = req.headers.get('authorization');
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }
    
    // Forward session token if present
    const sessionToken = req.headers.get('x-session-token');
    if (sessionToken) {
      headers['x-session-token'] = sessionToken;
    }
    
    // Forward mobile token if present
    const mobileToken = req.headers.get('x-mobile-token');
    if (mobileToken) {
      headers['x-mobile-token'] = mobileToken;
    }
    
    // If we have a token from auth check and no Authorization header yet, use it
    if (!headers['Authorization'] && authResult.token) {
      headers['Authorization'] = `Bearer ${authResult.token}`;
    }
    
    // Send the subtitle content to the server using fetch with authentication
    const response = await fetch(saveUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        subtitleContent,
        mediaType,
        mediaTitle,
        language,
        season,
        episode
      }),
      // Include credentials to forward cookies
      credentials: 'include'
    })

    // Check if the request was successful
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Failed to save subtitles:', errorData)
      console.error(`Endpoint: ${saveUrl}`)
      console.log(`Request Body: ${JSON.stringify({
        subtitleContent,
        mediaType,
        mediaTitle,
        language,
        season,
        episode
      })}`)
      
      throw new Error(`Failed to save subtitles: ${response.status} ${response.statusText}`)
    }

    return new Response(JSON.stringify({ 
      success: true, 
      message: 'Subtitles saved successfully' 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (error) {
    console.error('Error saving subtitles:', error)
    return new Response(JSON.stringify({ 
      success: false, 
      error: 'Failed to save subtitles' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
