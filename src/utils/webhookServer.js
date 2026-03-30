"use server";

function getWebhookEnvKeys() {
  const keys = Object.keys(process.env).filter(
    (key) => key === 'WEBHOOK_ID' || /^WEBHOOK_ID_\d+$/.test(key)
  );

  return keys.sort((a, b) => {
    const getIndex = (key) => {
      if (key === 'WEBHOOK_ID') return 1;
      const match = key.match(/^WEBHOOK_ID_(\d+)$/);
      return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
    };

    return getIndex(a) - getIndex(b);
  });
}

/**
 * Gets all configured webhook IDs with metadata about server association.
 * @returns {Promise<Array<{webhookId: string, envKey: string, serverId: string | null, isWildcard: boolean}>>}
 */
export async function getAllWebhookConfigs() {
  const envKeys = getWebhookEnvKeys();

  return envKeys
    .map((envKey) => {
      const webhookId = process.env[envKey];
      if (!webhookId) return null;

      if (envKey === 'WEBHOOK_ID') {
        return {
          webhookId,
          envKey,
          serverId: 'default',
          isWildcard: false,
        };
      }

      const match = envKey.match(/^WEBHOOK_ID_(\d+)$/);
      if (!match) return null;

      const index = parseInt(match[1], 10);
      const nodeServerKey = `NODE_SERVER_URL_${index}`;
      const serverId = process.env[nodeServerKey] ? `server${index}` : null;

      return {
        webhookId,
        envKey,
        serverId,
        isWildcard: !serverId,
      };
    })
    .filter(Boolean);
}

/**
 * Gets the mapping between webhook IDs and server IDs
 * @returns {Promise<Map<string, string>>} A map of webhook IDs to server IDs
 */
export async function getWebhookServerMapping() {
  const webhookConfigs = await getAllWebhookConfigs();
  const mapping = new Map();

  for (const config of webhookConfigs) {
    if (config.serverId) {
      mapping.set(config.webhookId, config.serverId);
    }
  }

  return mapping;
}

/**
 * Validates a webhook ID and returns server information
 * @param {string} webhookId - The webhook ID to validate
 * @returns {Promise<{isValid: boolean, serverId: string|null}>} Validation result
 */
export async function validateWebhookId(webhookId) {
  if (!webhookId) return { isValid: false, serverId: null };

  const webhookConfigs = await getAllWebhookConfigs();
  const matchedConfig = webhookConfigs.find((config) => config.webhookId === webhookId);

  return {
    isValid: !!matchedConfig,
    serverId: matchedConfig?.serverId || null,
    isWildcard: matchedConfig?.isWildcard || false,
  };
}

/**
 * Gets the reverse mapping between server IDs and webhook IDs
 * @returns {Promise<Map<string, string>>} A map of server IDs to webhook IDs
 */
export async function getServerWebhookMapping() {
  // Build server to webhook mapping (reverse of getWebhookServerMapping)
  const webhookToServerMap = await getWebhookServerMapping();
  const serverToWebhookMap = new Map();
  
  // Iterate over webhook->server mapping and create the reverse mapping
  for (const [webhookId, serverId] of webhookToServerMap.entries()) {
    serverToWebhookMap.set(serverId, webhookId);
  }
  
  return serverToWebhookMap;
}

/**
 * Gets the webhook ID for a specific server
 * @param {string} serverId - The server ID to get the webhook ID for
 * @returns {Promise<string|null>} The webhook ID for the server, or null if not found
 */
export async function getWebhookIdForServer(serverId) {
  if (!serverId) return null;
  
  const mapping = await getServerWebhookMapping();
  return mapping.get(serverId) || null;
}
