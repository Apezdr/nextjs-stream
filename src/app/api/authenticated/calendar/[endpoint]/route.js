import { approvedGate } from '@src/lib/roles/gates'
import { describeRequestError, httpGet } from '@src/lib/httpHelper'
import { libraryAccessFor } from '@src/lib/roles/libraryAccess'
import { isFullLibrary } from '@src/lib/roles/libraryScope'

// What a scoped user gets: Sonarr's and Radarr's feeds name the library's
// titles by their own names, which can't be matched to a library scope, so a
// user held to one sees an empty calendar rather than titles outside it.
const EMPTY_CALENDAR = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//nextjs-stream//library scope//EN', 'END:VCALENDAR', ''].join('\r\n')

const sonarrIcalLink = process.env.SONARR_ICAL_LINK
const radarrIcalLink = process.env.RADARR_ICAL_LINK

export async function GET(req, props) {
  const params = await props.params;
  const authResult = await approvedGate.route()
  if (authResult instanceof Response) {
    return authResult
  }

  const { endpoint } = params

  try {
    let icalLink
    let filename

    switch (endpoint) {
      case 'sonarr':
        icalLink = sonarrIcalLink
        filename = 'Sonarr.ics'
        break
      case 'radarr':
        icalLink = radarrIcalLink
        filename = 'Radarr.ics'
        break
      default:
        return new Response(JSON.stringify({ error: 'Invalid endpoint' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
    }

    const iCalData = !isFullLibrary(await libraryAccessFor(authResult))
      ? EMPTY_CALENDAR
      : (await httpGet(icalLink, {
      responseType: 'text',
      timeout: 10000,
      retry: { limit: 3, baseDelay: 1000 },
    })).data

    return new Response(iCalData, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    // One line, never the error object: got's error prints its options, the
    // feed URL with its API key among them
    console.error(`[calendar] ${endpoint} feed failed: ${describeRequestError(error)}`)
    return new Response(JSON.stringify({ error: 'Failed to sync data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
