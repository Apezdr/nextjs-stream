import { getServerConfig } from "./config"

// Used by chromecast to fetch a random banner media
export const GET = async (req) => {

  return new Response(JSON.stringify(await getServerConfig()), {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*', // Allows all origins
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=1800', // Cache for 30 minutes
    },
  })
}