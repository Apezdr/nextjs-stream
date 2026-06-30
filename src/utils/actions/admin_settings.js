'use server'

//import { updateSettingsInDB } from '@src/utils/sync_db'
import { AutoSyncManager, SyncAggressivenessManager, AutoCaptionsManager } from '@src/utils/admin_database'

const autoSyncManager = new AutoSyncManager()
const syncAgressivenessManager = new SyncAggressivenessManager()
const autoCaptionsManager = new AutoCaptionsManager()

const ALLOWED_LANG_CODES = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru',
  'ja', 'ko', 'zh', 'ar', 'tr', 'sv', 'da', 'fi', 'no',
])

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

export async function updateAutoCaptions(formData) {
  'use server'

  const enabled = formData.get('enabled') === 'true'
  const rawLanguages = formData.getAll('languages')
  const languages = rawLanguages
    .map((l) => String(l).trim().toLowerCase())
    .filter((l) => ALLOWED_LANG_CODES.has(l))

  if (enabled && languages.length === 0) {
    throw new Error('Select at least one language to enable auto-captions')
  }

  await autoCaptionsManager.setAutoCaptions({ enabled, languages })
}
