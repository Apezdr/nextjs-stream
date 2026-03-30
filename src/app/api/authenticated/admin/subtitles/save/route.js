import isAuthenticated, { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { getServer } from '@src/utils/config'
import { getBackendAuthHeaders } from '@src/utils/backendAuth'

export async function POST(req) {
  // Ensure user is authenticated and has admin rights
  const authResult = await isAuthenticatedAndApproved(req) // second param = requireAdmin
  if (authResult instanceof Response) {
    return authResult // Return the unauthorized response if not admin
  }

  if (authResult.role !== 'admin') {
    return new Response(
      JSON.stringify({
        success: false,
        error: 'User is not an admin',
      }),
      {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }

  try {
    const { subtitleContent, mediaType, mediaTitle, language, season, episode, sourceServerId } =
      await req.json()

    if (!subtitleContent || !mediaType || !mediaTitle || !language) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Missing required parameters',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    }

    // Get the server configuration
    const server = getServer(sourceServerId)
    // Using internalEndpoint for server-to-server requests; falls back to syncEndpoint if unset.
    const nodeServerUrl = server.internalEndpoint || server.syncEndpoint

    console.log(`sub save server: ${JSON.stringify(server, null, 2)}`)
    console.log(`nodeServerUrl: ${nodeServerUrl}`)

    // Construct URL for saving the subtitle file
    let saveUrl = `${nodeServerUrl}/api/admin/subtitles/save`
    console.log(`Saving subtitles to URL: ${saveUrl}`)

    // Build headers with authentication
    const headers = {
      'Content-Type': 'application/json',
      ...await getBackendAuthHeaders(req),
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
        episode,
      }),
      // Include credentials to forward cookies
      credentials: 'include',
    })

    // Check if the request was successful
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      console.error('Failed to save subtitles:', errorData)
      console.error(`Endpoint: ${saveUrl}`)
      console.log(
        `Request Body: ${JSON.stringify({
          subtitleContent,
          mediaType,
          mediaTitle,
          language,
          season,
          episode,
        })}`
      )

      throw new Error(`Failed to save subtitles: ${response.status} ${response.statusText}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Subtitles saved successfully',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    console.error('Error saving subtitles:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Failed to save subtitles',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
