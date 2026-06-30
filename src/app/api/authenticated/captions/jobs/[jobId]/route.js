import { getSession } from '@src/lib/cachedAuth'
import { getServer, getWebhookIdForServer, getDefaultServer } from '@src/utils/config'

export const GET = async (req, props) => {
  const session = await getSession()
  if (!session?.user) {
    return jsonError(401, 'Authentication required')
  }

  const { jobId } = await props.params
  if (!jobId) return jsonError(400, 'Missing jobId')

  const url = new URL(req.url)
  const serverId = url.searchParams.get('serverId')

  const serverConfig = serverId ? getServer(serverId) : getDefaultServer()
  if (!serverConfig?.syncEndpoint) {
    return jsonError(503, 'No processor server resolved')
  }

  const webhookId = await getWebhookIdForServer(serverConfig.id ?? serverId)

  const processorUrl = `${stripTrailingSlash(serverConfig.syncEndpoint)}/api/captions/jobs/${encodeURIComponent(jobId)}`

  let res
  try {
    res = await fetch(processorUrl, {
      method: 'GET',
      headers: webhookId ? { 'X-Webhook-ID': webhookId } : {},
    })
  } catch (err) {
    return jsonError(502, `Processor unreachable: ${err.message}`)
  }

  const body = await res.text()
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function stripTrailingSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
