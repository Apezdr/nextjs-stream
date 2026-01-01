"use server";

/**
 * Gets the mapping between webhook IDs and server IDs
 * @returns {Promise<Map<string, string>>} A map of webhook IDs to server IDs
 */
export async function getWebhookServerMapping() {
  // Build webhook to server mapping
  const mapping = new Map();
  
  // Default server
  const defaultWebhookId = process.env.WEBHOOK_ID;
  if (defaultWebhookId) {
    mapping.set(defaultWebhookId, 'default');
  }
  
  // Additional servers
  let serverIndex = 2;
  while (process.env[`NODE_SERVER_URL_${serverIndex}`]) {
    const webhookId = process.env[`WEBHOOK_ID_${serverIndex}`];
    if (webhookId) {
      mapping.set(webhookId, `server${serverIndex}`);
    }
    serverIndex++;
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
  
  const mapping = await getWebhookServerMapping();
  const serverId = mapping.get(webhookId);
  
  return {
    isValid: !!serverId,
    serverId: serverId || null
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
