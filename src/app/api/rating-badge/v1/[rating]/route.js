import { isSupportedContentRating } from '@src/utils/contentRating'
import { generateContentRatingSvg } from '@src/utils/contentRatingSvg'

const SVG_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=31536000, immutable',
  'Content-Security-Policy': "default-src 'none'; script-src 'none'; style-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; sandbox",
  'Content-Type': 'image/svg+xml; charset=utf-8',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
})

function errorResponse(message, status) {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

async function badgeResponse(request, context, includeBody) {
  const url = new URL(request.url)
  if ([...url.searchParams].length > 0) {
    return errorResponse('Unexpected query parameters', 400)
  }

  const { rating } = await context.params
  if (typeof rating !== 'string' || rating.length > 24 || !rating.endsWith('.svg')) {
    return errorResponse('Rating badge not found', 404)
  }

  const contentRating = rating.slice(0, -4)
  if (!isSupportedContentRating(contentRating)) {
    return errorResponse('Rating badge not found', 404)
  }

  const svg = generateContentRatingSvg(contentRating)
  const headers = {
    ...SVG_HEADERS,
    'Content-Length': String(new TextEncoder().encode(svg).byteLength),
  }

  return new Response(includeBody ? svg : null, { status: 200, headers })
}

export async function GET(request, context) {
  return badgeResponse(request, context, true)
}

export async function HEAD(request, context) {
  return badgeResponse(request, context, false)
}
