import { ObjectId } from 'mongodb'
import isAuthenticated from '../../../../../utils/routeAuth'
import { generateNormalizedVideoId } from '../../../../../utils/flatDatabaseUtils'
import { updateValidationStatus } from '../../../../../utils/watchHistory/database'

/**
 * @param {*} req
 * Handles POST requests to update the validation status of a video in the user's watch history.
 * Expects a JSON body with `videoId` and `isValid` fields.
 * @returns {Response} - Returns a JSON response indicating success or failure.
 * If the user is not authenticated, returns a 401 Unauthorized response.
 */
export const POST = async (req) => {
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  try {
    const body = await req.json()
    const { videoId, isValid } = body

    // Use centralized function to update validation status
    const normalizedVideoId = generateNormalizedVideoId(videoId)
    const result = await updateValidationStatus({
      userId: authResult.id,
      normalizedVideoId,
      isValid
    })

    console.log(`Updated validation status for video ${videoId}: isValid = ${isValid}`)

    return new Response(JSON.stringify({ 
      message: 'Validation status updated',
      videoId,
      isValid 
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Validation status update error:', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
