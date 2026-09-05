'use server'

import { revalidatePath } from 'next/cache'
//import { updateSettingsInDB } from '@src/utils/sync_db'
import {
  AutoSyncManager,
  SyncAggressivenessManager,
  AutoCaptionsManager,
  JitServeSettingsManager,
} from '@src/utils/admin_database'
import { invalidateCachedJitServeSettings } from '@src/utils/jit/serveSettings'
import { invalidateTranscoderHealthCache } from '@src/utils/jit/health'

const autoSyncManager = new AutoSyncManager()
const syncAgressivenessManager = new SyncAggressivenessManager()
const autoCaptionsManager = new AutoCaptionsManager()
const jitServeSettingsManager = new JitServeSettingsManager()

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

export async function updateJitServeSettings(formData) {
  'use server'

  // 'env' clears the runtime override (serve layer falls back to the
  // JIT_SERVE_MODE env var); the three concrete modes set it.
  const rawMode = formData.get('jitServeMode')
  if (!['env', 'off', 'rescue', 'prefer'].includes(rawMode)) {
    throw new Error('Invalid JIT serve mode')
  }
  const mode = rawMode === 'env' ? null : rawMode

  // Blank clears the queue-ceiling override; otherwise a non-negative int.
  const rawQueued = String(formData.get('jitServeMaxQueued') ?? '').trim()
  let maxQueued = null
  if (rawQueued !== '') {
    const n = Number.parseInt(rawQueued, 10)
    if (!Number.isInteger(n) || n < 0) {
      throw new Error('Invalid JIT queue ceiling — must be a non-negative integer or blank')
    }
    maxQueued = n
  }

  await jitServeSettingsManager.setJitServeSettings({ mode, maxQueued })

  // The delivery choice is embedded in the Server Component payload as the
  // player's videoURL. Clear process-local policy decisions first, then evict
  // every route shape that can hold a previously selected direct/HLS source.
  invalidateCachedJitServeSettings()
  invalidateTranscoderHealthCache()
  revalidatePath('/list/movie/[title]/play', 'page')
  revalidatePath('/list/tv/[title]/[season]/[episode]/play', 'page')
  revalidatePath('/list/[...media]', 'page')
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
