import { isAuthenticatedAndApproved } from '../../../../../utils/routeAuth'
import { httpGet } from '@src/lib/httpHelper'

const sonarrIcalLink = process.env.SONARR_ICAL_LINK
const radarrIcalLink = process.env.RADARR_ICAL_LINK

export async function GET(req, props) {
  const params = await props.params;
  const authResult = await isAuthenticatedAndApproved(req)
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

    const { data: iCalData } = await httpGet(icalLink, {
      responseType: 'text',
      timeout: 10000,
      retry: { limit: 3, baseDelay: 1000 },
    })

    return new Response(iCalData, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.log(error)
    return new Response(JSON.stringify({ error: 'Failed to sync data' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
