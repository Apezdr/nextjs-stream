import isAuthenticated from '../../../../../utils/routeAuth'

const sonarrIcalLink = process.env.SONARR_ICAL_LINK
const radarrIcalLink = process.env.RADARR_ICAL_LINK

const MAX_RETRIES = 3
const RETRY_DELAY = 1000 // 1 second

async function fetchWithRetry(url, retries, delay) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return response
      } else {
        throw new Error(`Failed to fetch: ${response.statusText}`)
      }
    } catch (error) {
      if (attempt < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      } else {
        throw error
      }
    }
  }
}

export async function GET(req, props) {
  const params = await props.params;
  const authResult = await isAuthenticated(req)
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

    const iCalRequest = await fetchWithRetry(icalLink, MAX_RETRIES, RETRY_DELAY)
    const iCalData = await iCalRequest.text()

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
