'use server'

//import { updateSettingsInDB } from '@src/utils/sync_db'
import { AutoSyncManager, SyncAggressivenessManager } from '@src/utils/admin_database'

const autoSyncManager = new AutoSyncManager()
const syncAgressivenessManager = new SyncAggressivenessManager()

export async function updateSyncAggressiveness(formData) {
  'use server'

  const syncAggressiveness = formData.get('syncAggressiveness')

  // Validate input
  if (!['Minimal', 'Standard', 'Aggressive', 'Full'].includes(syncAggressiveness)) {
    throw new Error('Invalid sync aggressiveness value')
  }

  // Update in the database
  await syncAgressivenessManager.setSyncAggressiveness(syncAggressiveness)

  // Optionally, you can redirect or provide feedback
}

export async function updateAutomaticSync(formData) {
  'use server'

  const automaticSyncEnabled = formData.get('automaticSyncEnabled') === 'true'

  // Update in the database
  await autoSyncManager.setAutoSync(automaticSyncEnabled)

  // Optionally, provide feedback
}
