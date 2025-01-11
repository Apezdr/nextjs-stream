'use server'

import clientPromise from '@src/lib/mongodb'
import {
  fileServerPrefixPath,
  fileServerURLWithPrefixPath,
  getAllServers,
  nodeJSURL,
  organizrURL,
  syncMoviesURL,
  syncTVURL,
} from '@src/utils/config'
import { AutoSyncManager, getLastSynced } from './admin_database'

async function getFileServerImportSettings() {
  const client = await clientPromise
  const result = await client.db('app_config').collection('settings').findOne({
    name: 'fileServerImportSettings',
  })
  return result ?? 'No fileServerImportSettings found'
}

// Set File Server Import Settings
async function setFileServerImportSettings(settings) {
  const client = await clientPromise
  const result = await client
    .db('app_config')
    .collection('Settings')
    .updateOne(
      {
        name: 'fileServerImportSettings',
      },
      {
        $set: {
          ...settings,
        },
      },
      { upsert: true }
    )
}

const autoSync = new AutoSyncManager()

async function getServerSettings() {
  const lastSyncTime = await getLastSynced()
  const fileImportSettings = await getFileServerImportSettings()
  const automaticSyncEnabled = await autoSync.getAutoSync()
  const servers = getAllServers()
  const webhookIds = process.env.VALID_WEBHOOK_IDS

  return {
    webhookIds: webhookIds,
    fileImport: fileImportSettings,
    // Urls
    servers: servers,
    //fileServerURL: fileServerURLWithPrefixPath(''),
    //fileServerPrefixPath: fileServerPrefixPath,
    organizrURL: organizrURL,
    nodeJSURL: nodeJSURL,
    syncTVURL: syncTVURL,
    syncMoviesURL: syncMoviesURL,
    // Settings
    syncAggressiveness: 'Full',
    automaticSyncEnabled: automaticSyncEnabled,
    lastSyncTime: lastSyncTime,
    automated: {
      runDownloadTmdbImages: {
        frequency: {
          unit: 'minutes',
          value: 7,
        },
      },
      generatePosterCollage: {
        frequency: {
          unit: 'hours',
          value: 3,
        },
      },
      runGenerateList: {
        frequency: {
          unit: 'minutes',
          value: 1,
        },
      },
      autoSync: {
        frequency: {
          unit: 'minutes',
          value: 1,
        },
      },
    },
  }
}

export { getServerSettings, getFileServerImportSettings, setFileServerImportSettings }
