/**
 * Flat media structure sync entry point
 *
 * Syncs data between file servers and the flat database structure (separate
 * collections for Movies, TV Shows, Seasons, and Episodes) through the
 * domain-driven sync architecture.
 */

import { createLogger } from '@src/lib/logger';
import { syncWithNewArchitecture } from './newArchitectureAdapter';

/**
 * Syncs all media data from file servers to the flat database structure.
 * An error thrown by the sync propagates to the caller (syncAllServers).
 * @param {Object} fileServer - File server data
 * @param {Object} serverConfig - Server configuration
 * @param {Object} fieldAvailability - Field availability map
 * @param {boolean} skipInitialization - Passed through to the adapter (default: false)
 * @param {boolean} forceSync - Force sync even if hashes match (default: false)
 * @param {Object} options - Additional options
 * @param {boolean} options.allEnabledServersProbed - True when every enabled file server answered this run
 * @returns {Promise<Object>} Sync results
 */
export async function syncToFlatStructure(fileServer, serverConfig, fieldAvailability, skipInitialization = false, forceSync = false, options = {}) {
  const log = createLogger('FlatSync');

  log.info({
    serverId: serverConfig.id,
    skipInitialization,
    forceSync,
  }, 'Starting sync to flat structure');

  log.info({ serverId: serverConfig.id }, 'Delegating to NEW domain-driven sync architecture');
  return await syncWithNewArchitecture(fileServer, serverConfig, fieldAvailability, {
    forceSync,
    skipInitialization,
    allEnabledServersProbed: options.allEnabledServersProbed
  });
}
