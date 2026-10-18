//import axiosInstance from './axiosInstance'

export function processUserData(jsonResponse) {
  // Assuming jsonResponse is an array of user records
  const users = jsonResponse

  // Prepare headers for the user table
  const userHeaders = ['Name', 'Email', 'Image', 'Limited Access', 'Approved', 'Actions']

  // Transform data for users
  const userData = users.map((user) => ({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    imageUrl: user.image, // Add image URL
    limitedAccess: user.limitedAccess ? true : false, // If the user is approved to view content
    approved: user.approved.toString(), // If the user is approved to view content
    roles: Array.isArray(user.roles) ? user.roles.map(String) : [], // Role ids (src/lib/roles)
  }))

  return {
    headers: userHeaders,
    data: userData,
  }
}

/**
 * Saves system status data to the database with incident management
 * @param {Object} statusData - The system status data to store
 * @param {string} serverId - ID of the server that sent the notification
 * @param {boolean} isWebhook - Whether this is a webhook notification (vs. a poll)
 * @returns {Promise<Object>} - Result of the operation
 */
export async function storeSystemStatus(statusData, serverId, isWebhook = false) {
  try {
    const client = await import('@src/lib/mongodb').then(module => module.default);
    const db = client.db('Media');
    const statusCollection = db.collection('SystemStatus');
    
    // Current timestamp
    const now = new Date();
    
    // Add metadata to the status data
    const enrichedStatus = {
      ...statusData,
      serverId,
      receivedAt: now,
      source: isWebhook ? 'webhook' : 'poll'
    };
    
    // Insert the individual status record for history
    await statusCollection.insertOne({
      ...enrichedStatus,
      _id: `status_${serverId}_${now.getTime()}`
    });
    
    // Update the latest status for this server
    await statusCollection.updateOne(
      { _id: 'latest_status' },
      { 
        $set: { 
          [`servers.${serverId}`]: enrichedStatus 
        },
        $currentDate: { lastUpdated: true }
      },
      { upsert: true }
    );
    
    // Process incidents if this is a webhook notification or a significant status
    const statusLevel = statusData.level || statusData.status; // Support both naming conventions
    
    // If this is a webhook notification or the status is critical/heavy, manage the incident
    if ((isWebhook || statusData.source === 'webhook') && 
        (statusLevel === 'critical' || statusLevel === 'heavy')) {
      
      // Check if there's an existing active incident for this server
      const existingDoc = await statusCollection.findOne({ _id: 'latest_status' });
      const activeIncidents = existingDoc?.activeIncidents || [];
      const existingIncident = activeIncidents.find(
        inc => inc.serverId === serverId && !inc.resolvedAt
      );
      
      if (existingIncident) {
        // Update the existing incident
        await statusCollection.updateOne(
          { 
            _id: 'latest_status',
            'activeIncidents.serverId': serverId,
            'activeIncidents.resolvedAt': null
          },
          {
            $set: {
              'activeIncidents.$.level': statusLevel,
              'activeIncidents.$.message': statusData.message || 'System is experiencing issues',
              'activeIncidents.$.updatedAt': now,
              // Reset consecutive normal polls counter since we got a new incident notification
              'activeIncidents.$.consecutiveNormalPolls': 0
            }
          }
        );
      } else {
        // Create a new incident with a minimum display time (10 minutes)
        const minDisplayUntil = new Date(now);
        minDisplayUntil.setMinutes(minDisplayUntil.getMinutes() + 10);
        
        // Generate a unique incident ID
        const incidentId = `incident-${serverId}-${Date.now()}`;
        
        await statusCollection.updateOne(
          { _id: 'latest_status' },
          {
            $push: {
              activeIncidents: {
                id: incidentId,
                serverId,
                level: statusLevel,
                message: statusData.message || 'System is experiencing issues',
                startedAt: now,
                updatedAt: now,
                resolvedAt: null,
                minDisplayUntil,
                consecutiveNormalPolls: 0
              }
            }
          },
          { upsert: true }
        );
      }
    }
    
    // If this is a poll result or non-webhook source and status is normal,
    // update any active incidents for this server
    if ((!isWebhook && statusData.source !== 'webhook') && statusLevel === 'normal') {
      // Get current document to check incidents
      const currentDoc = await statusCollection.findOne({ _id: 'latest_status' });
      if (!currentDoc?.activeIncidents) return { success: true };
      
      // Find the active incident for this server
      const activeIncidentIndex = currentDoc.activeIncidents.findIndex(
        inc => inc.serverId === serverId && !inc.resolvedAt
      );
      
      if (activeIncidentIndex >= 0) {
        // Clone the incidents array to modify it
        const updatedIncidents = [...currentDoc.activeIncidents];
        // Increment consecutive normal polls
        updatedIncidents[activeIncidentIndex].consecutiveNormalPolls += 1;
        
        // Update in database
        await statusCollection.updateOne(
          { _id: 'latest_status' },
          { $set: { activeIncidents: updatedIncidents } }
        );
        
        // If we've had 3 consecutive normal polls AND we're past the minimum display time,
        // mark the incident as resolved
        if (updatedIncidents[activeIncidentIndex].consecutiveNormalPolls >= 3 && 
            new Date(updatedIncidents[activeIncidentIndex].minDisplayUntil) <= now) {
          
          updatedIncidents[activeIncidentIndex].resolvedAt = now;
          
          await statusCollection.updateOne(
            { _id: 'latest_status' },
            { $set: { activeIncidents: updatedIncidents } }
          );
        }
      }
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error storing system status:', error);
    throw error;
  }
}

/**
 * Gets the latest system status from the database
 * @returns {Promise<Object>} Latest system status
 */
export async function getLatestSystemStatus() {
  const toServerArray = (serversValue) => {
    if (Array.isArray(serversValue)) return serversValue;
    if (serversValue && typeof serversValue === 'object') {
      return Object.entries(serversValue).map(([serverId, status]) => ({
        ...status,
        serverId: status?.serverId ?? serverId,
      }));
    }
    return [];
  };

  const toIncidentsArray = (incidentsValue) =>
    Array.isArray(incidentsValue) ? incidentsValue : [];

  const normalizeLatestStatus = (doc) => {
    const raw = doc || { servers: {}, activeIncidents: [] };
    return {
      ...raw,
      servers: raw.servers ?? {},
      activeIncidents: toIncidentsArray(raw.activeIncidents),
      normalizedServers: toServerArray(raw.servers),
      normalizedActiveIncidents: toIncidentsArray(raw.activeIncidents),
    };
  };

  try {
    const client = await import('@src/lib/mongodb').then(module => module.default);
    const db = client.db('Media');
    const statusCollection = db.collection('SystemStatus');
    
    const doc = await statusCollection.findOne({ _id: 'latest_status' });
    return normalizeLatestStatus(doc);
  } catch (error) {
    console.error('Error fetching latest system status:', error);
    return normalizeLatestStatus(null);
  }
}

/**
 * Generate appropriate overall message based on status levels
 * @param {string} level - Worst status level
 * @param {Array} statuses - Array of server statuses
 * @returns {string} - Human-readable message
 */
export function getSystemStatusMessage(level, statuses) {
  if (level === 'critical') {
    const criticalServers = statuses
      .filter(s => s.level === 'critical')
      .map(s => s.serverName)
      .join(', ');
    return `Critical load on ${criticalServers}. Some features may be unavailable.`;
  }
  
  if (level === 'heavy') {
    return 'System is experiencing heavy load. Performance may be affected.';
  }

  if (level === 'unknown') {
    const unreachableServers = statuses
      .filter(s => s.level === 'unknown')
      .map(s => s.serverName)
      .join(', ');
    return `Can't reach ${unreachableServers}. Titles stored there may not play right now.`;
  }

  return 'All systems operational.';
}
