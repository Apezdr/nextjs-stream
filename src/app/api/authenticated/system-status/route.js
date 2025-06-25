"use server";

import { getAllServers, getWebhookIdForServer } from '@src/utils/config';
import { httpGet } from '@src/lib/httpHelper';
import { getLatestSystemStatus, getSystemStatusMessage } from '@src/utils/admin_utils';
import { isAuthenticatedEither } from '@src/utils/routeAuth';

const SERVER_ENDPOINT = '/api/system-status';
const DEFAULTS = {
  GLOBAL_TIMEOUT: 5000,      // ms
  SERVER_TIMEOUT: 2000,      // ms per-server
  HTTP_GET: {
    timeout: 1500,
    http2: true,
    retry: { limit: 2, baseDelay: 200 }
  },
  CACHE_CONTROL: 'private, must-revalidate, max-age=30',
  FALLBACK_CACHE: 'private, must-revalidate, max-age=10'
};

/** Generate a simple hash-based ETag from any object */
function generateETag(obj) {
  const s = JSON.stringify(obj), len = s.length;
  let h = 0;
  for (let i = 0; i < len; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return `"${h.toString(36)}"`;
}

/** Wrap any promise to reject after ms with the given message */
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(message)), ms))
  ]);
}

/**
 * Build a uniform status object.
 * If data is null or error is set, returns an 'unknown' status.
 */
function buildStatus(server, data = null, headers = {}, error = null) {
  const base = {
    serverId: server.id,
    serverName: server.name ?? server.id,
    lastUpdated: headers['last-modified'] ?? new Date().toISOString()
  };

  if (error) {
    return { ...base, level: 'unknown', message: error, error };
  }
  if (!data) {
    return { ...base, level: 'unknown', message: 'Status information not available' };
  }
  return { ...base, ...data, etag: headers.etag ?? null };
}

export async function GET(request) {
  // auth
  const auth = await isAuthenticatedEither(request);
  if (auth instanceof Response) return auth;

  const incomingETag = request.headers.get('If-None-Match');
  const servers = getAllServers();

  try {
    // fetch all in parallel with overall timeout
    const statuses = await withTimeout(
      fetchAllStatuses(servers),
      DEFAULTS.GLOBAL_TIMEOUT,
      'Global operation timeout'
    );
    return await processResponse(statuses, incomingETag);
  } catch (err) {
    console.error('Global error:', err);
    return fallbackResponse(servers);
  }
}

async function fetchAllStatuses(servers) {
  const tasks = servers.map(server =>
    withTimeout(fetchOneStatus(server), DEFAULTS.SERVER_TIMEOUT, 'Server timeout')
  );
  const settled = await Promise.allSettled(tasks);
  return settled.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : buildStatus(servers[i], null, {}, r.reason.message)
  );
}

async function fetchOneStatus(server) {
  const webhookId = await getWebhookIdForServer(server.id);
  const headers = webhookId ? { 'X-Webhook-ID': webhookId } : {};

  const { data, headers: resp } = await httpGet(
    `${server.syncEndpoint}${SERVER_ENDPOINT}`,
    { ...DEFAULTS.HTTP_GET, headers },
    true // allow 304 caching
  );
  return buildStatus(server, data, resp);
}

async function processResponse(statuses, incomingETag) {
  const { servers: cached, activeIncidents = [] } = await getLatestSystemStatus();
  const incidents = activeIncidents.filter(i => !i.resolvedAt);

  // merge incidents on top of live statuses
  const merged = statuses.map(st => {
    const inc = incidents.find(i => i.serverId === st.serverId);
    if (inc && new Date(inc.minDisplayUntil) > new Date()) {
      return {
        ...st,
        level: inc.level,
        message: inc.message,
        isIncidentActive: true,
        incidentStartedAt: inc.startedAt,
        minDisplayUntil: inc.minDisplayUntil
      };
    }
    return st;
  });

  // pick the worst level
  const levels = ['normal', 'heavy', 'critical'];
  const worst = merged.reduce(
    (w, s) => levels.indexOf(s.level) > levels.indexOf(w) ? s.level : w,
    'normal'
  );

  const response = {
    overall: {
      level: worst,
      message: getSystemStatusMessage(worst, merged),
      updatedAt: new Date().toISOString()
    },
    servers: merged,
    hasActiveIncidents: incidents.length > 0
  };

  const etag = generateETag(response);
  if (incomingETag === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        'Cache-Control': DEFAULTS.CACHE_CONTROL,
        'ETag': etag
      }
    });
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': DEFAULTS.CACHE_CONTROL,
      'ETag': etag
    }
  });
}

async function fallbackResponse(servers) {
  const { servers: latest = [], activeIncidents = [] } = await getLatestSystemStatus();
  const incidents = activeIncidents.filter(i => !i.resolvedAt);

  const fallback = servers.map(s => {
    const cached = latest.find(l => l.serverId === s.id);
    return cached ?? buildStatus(s, null, {}, 'Global timeout');
  });

  const response = {
    overall: {
      level: 'unknown',
      message: 'System status temporarily unavailable',
      updatedAt: new Date().toISOString()
    },
    servers: fallback,
    hasActiveIncidents: incidents.length > 0
  };

  const etag = generateETag(response);
  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': DEFAULTS.FALLBACK_CACHE,
      'ETag': etag,
      'X-Status': 'fallback'
    }
  });
}
