// src/lib/roles/editorData.ts
// What each capability's editor needs to offer its choices (e.g. the live
// quality profiles), by capability key. A feature whose editor needs data
// adds its loader here, next to its entry in registry.ts.
import 'server-only'
import { arrProfileChoices } from '@src/lib/arr/profileChoices'

export async function capabilityEditorData(): Promise<Record<string, unknown>> {
  const [arrRequest] = await Promise.all([arrProfileChoices()])
  return { 'arr.request': arrRequest }
}
