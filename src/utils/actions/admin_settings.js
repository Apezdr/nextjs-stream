'use server'

//import { updateSettingsInDB } from '@src/utils/sync_db'
import {
  AutoSyncManager,
  SyncAggressivenessManager,
  AutoCaptionsManager,
  JitServeSettingsManager,
  ServerDisplayNameManager,
  SyncServerLatencySettingsManager,
  AppTimeZoneManager,
  SystemPerformanceAlertSettingsManager,
  LocalAccessSettingsManager,
} from '@src/utils/admin_database'
import { requireAdminAction } from '@src/utils/routeAuth'
import { getAllServers } from '@src/utils/config'
import { formatServerLabel, SERVER_DISPLAY_NAME_MAX_LENGTH } from '@src/utils/serverLabel'
import { revalidatePath } from 'next/cache'
import { normalizeTimeZone } from '@src/utils/dateTime'
import { clearAppTimeZoneCache } from '@src/utils/appTimeZone.server'

const autoSyncManager = new AutoSyncManager()
const syncAgressivenessManager = new SyncAggressivenessManager()
const autoCaptionsManager = new AutoCaptionsManager()
const jitServeSettingsManager = new JitServeSettingsManager()
const serverDisplayNameManager = new ServerDisplayNameManager()
const syncServerLatencySettingsManager = new SyncServerLatencySettingsManager()
const appTimeZoneManager = new AppTimeZoneManager()
const systemPerformanceAlertSettingsManager = new SystemPerformanceAlertSettingsManager()
const localAccessSettingsManager = new LocalAccessSettingsManager()

const ALLOWED_LANG_CODES = new Set([
  'en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ru',
  'ja', 'ko', 'zh', 'ar', 'tr', 'sv', 'da', 'fi', 'no',
])

export async function updateSyncAggressiveness(formData) {
  'use server'
  await requireAdminAction()

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
  await requireAdminAction()

  const automaticSyncEnabled = formData.get('automaticSyncEnabled') === 'true'

  // Update in the database
  await autoSyncManager.setAutoSync(automaticSyncEnabled)

  // Optionally, provide feedback
}

export async function updateJitServeSettings(formData) {
  'use server'
  await requireAdminAction()

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
}

export async function updateAutoCaptions(formData) {
  'use server'
  await requireAdminAction()

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

export async function updateServerDisplayName(_previousState, formData) {
  await requireAdminAction()
  const serverId = String(formData.get('serverId') || '')
  const configuredServer = getAllServers().find((server) => server.id === serverId)
  if (!configuredServer) return { status: 'error', message: 'Unknown server.' }
  if (configuredServer.environmentDisplayName) {
    return {
      status: 'error',
      message: `This name is managed by ${configuredServer.displayNameEnvironmentVariable}.`,
    }
  }

  const rawDisplayName = String(formData.get('displayName') || '')
  const hasUnsupportedControl = Array.from(rawDisplayName).some((character) => {
    const codePoint = character.codePointAt(0)
    return codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
  })
  if (hasUnsupportedControl) {
    return { status: 'error', message: 'Server name contains unsupported control characters.' }
  }

  const displayName = rawDisplayName.replace(/\s+/g, ' ').trim()
  if (displayName.length > SERVER_DISPLAY_NAME_MAX_LENGTH) {
    return { status: 'error', message: `Server name must be ${SERVER_DISPLAY_NAME_MAX_LENGTH} characters or fewer.` }
  }

  await serverDisplayNameManager.setServerDisplayName(serverId, displayName)
  revalidatePath('/admin/settings')
  return {
    status: 'success',
    message: displayName ? 'Server name saved.' : 'Default server name restored.',
    displayName: displayName || formatServerLabel(serverId),
  }
}

export async function updateSyncServerLatency(_previousState, formData) {
  await requireAdminAction()
  const enabled = formData.get('syncServerLatencyEnabled') === 'true'
  await syncServerLatencySettingsManager.setEnabled(enabled)
  revalidatePath('/admin/settings')
  revalidatePath('/admin')
  return { status: 'success', enabled }
}

export async function updateAppTimeZone(_previousState, formData) {
  await requireAdminAction()
  const timeZone = normalizeTimeZone(formData.get('timeZone'))
  if (!timeZone) return { status: 'error', message: 'Select a valid IANA time zone.' }
  await appTimeZoneManager.setTimeZone(timeZone)
  clearAppTimeZoneCache()
  revalidatePath('/', 'layout')
  revalidatePath('/admin/settings')
  return { status: 'success', message: 'Time zone saved.', timeZone }
}

export async function updateSystemPerformanceAlerts(_previousState, formData) {
  await requireAdminAction()
  const enabled = formData.get('systemPerformanceAlertsEnabled') === 'true'
  await systemPerformanceAlertSettingsManager.setEnabled(enabled)
  revalidatePath('/', 'layout')
  revalidatePath('/admin/settings')
  return { status: 'success', enabled }
}

export async function updateLocalAccess(_previousState, formData) {
  // requireAdminAction reads the session, and a local-access session is itself
  // the owner — so a local caller can turn this off again after enabling it.
  await requireAdminAction()
  const enabled = formData.get('localAccessEnabled') === 'true'
  await localAccessSettingsManager.setEnabled(enabled)
  revalidatePath('/', 'layout')
  revalidatePath('/admin/settings')
  return { status: 'success', enabled }
}
