/**
 * Validating a credits sidecar (CREDITS_SIDECAR.md, section 3).
 *
 * The structure, the enums and every length and count limit come from the
 * JSON Schema (./credits.schema.json), read here by a small walker that knows
 * the keywords that file uses. The rules a schema cannot state are checked
 * after it: unique ids, references that resolve in the same file, safe
 * relative paths, http(s) links, at least one credit field per entry, no
 * control characters, and the episode-only keys.
 *
 * Nothing is repaired or truncated: a file that breaks a rule is rejected
 * whole, so a credit is never stored with part of it missing.
 *
 * Pure: no I/O and no Node built-ins, so the API and the pages can check a
 * stored document with it too. The byte checks of the fetched file (its size
 * and its hash) are the sync's (core/credits).
 */

import schema from './credits.schema.json'

/** The largest credits file read, in bytes, here and in the processor. */
export const CREDITS_MAX_BYTES = 262_144

/** The schema versions this build reads. */
export const SUPPORTED_CREDITS_SCHEMA_VERSIONS: readonly number[] = [1]

export type CreditsKind =
  | 'film' | 'episode' | 'trailer' | 'poster' | 'backdrop' | 'logo' | 'thumbnail'
  | 'artwork' | 'music' | 'audio' | 'subtitles' | 'other'

export interface CreditsAsset {
  id: string
  kind: CreditsKind
  path?: string
  label?: string
  derivedFrom?: { libraryPath: string; note?: string }[]
}

export interface CreditsEntry {
  id: string
  assetIds: string[]
  kind?: CreditsKind
  work?: string
  author?: string
  authorUrl?: string
  attributionText?: string
  copyrightNotice?: string
  license?: string
  licenseUrl?: string
  sourceUrl?: string
  notices?: string[]
  historicalNotices?: string[]
  modification?: string
  previousModifications?: string[]
  exclusions?: string[]
  evidenceId?: string
  note?: string
  replaces?: string[]
}

export interface CreditsDocument {
  schemaVersion: 1
  assets: CreditsAsset[]
  entries: CreditsEntry[]
  suppress?: string[]
}

/** Where a sidecar sits: beside a movie's or show's metadata, or an episode's. */
export type CreditsScope = 'title' | 'episode'

/**
 * Why a file was rejected. Each is a failed input, never an absence: the
 * stored credits stay and the next pass tries again.
 */
export type CreditsRejection = 'too-large' | 'invalid-json' | 'unsupported-version' | 'schema' | 'hash-mismatch'

export type CreditsValidation =
  | { ok: true; document: CreditsDocument }
  | { ok: false; reason: CreditsRejection; errors: string[] }

/** The most errors one result lists. */
const MAX_ERRORS = 20

const URL_FIELDS = ['authorUrl', 'licenseUrl', 'sourceUrl'] as const
/** An entry must say at least one of these. */
const CREDIT_FIELDS = ['work', 'author', 'attributionText', 'copyrightNotice', 'license', 'notices'] as const

// C0 and C1 control characters, except tab, line feed and carriage return.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/

/**
 * Parse and validate a credits file's text.
 *
 * @param text - The file as fetched (UTF-8 decoded). A leading byte-order mark is ignored.
 * @param scope - 'episode' for an <NN>_credits.json, which may use `suppress` and `replaces`
 */
export function validateCreditsText(text: string, scope: CreditsScope): CreditsValidation {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch (error) {
    return { ok: false, reason: 'invalid-json', errors: [error instanceof Error ? error.message : String(error)] }
  }
  return validateCreditsDocument(parsed, scope)
}

/** Validate a parsed credits document (a fetched file, or a stored one). */
export function validateCreditsDocument(value: unknown, scope: CreditsScope): CreditsValidation {
  if (!isPlainObject(value)) {
    return { ok: false, reason: 'schema', errors: ['(root): must be an object'] }
  }
  if (!SUPPORTED_CREDITS_SCHEMA_VERSIONS.includes(value.schemaVersion as number)) {
    return {
      ok: false,
      reason: 'unsupported-version',
      errors: [`schemaVersion: ${JSON.stringify(value.schemaVersion ?? null)} is not one this build reads (${SUPPORTED_CREDITS_SCHEMA_VERSIONS.join(', ')})`],
    }
  }

  const errors: string[] = []
  const report = (message: string) => {
    if (errors.length < MAX_ERRORS) errors.push(message)
  }
  checkSchema(value, schema as SchemaNode, '', report)
  // The rules below read the structure the schema guarantees.
  if (errors.length > 0) return { ok: false, reason: 'schema', errors }

  const document = value as unknown as CreditsDocument
  checkDocumentRules(document, scope, report)
  if (errors.length > 0) return { ok: false, reason: 'schema', errors }
  return { ok: true, document }
}

// ---------------------------------------------------------------------------
// The schema walker: the keywords credits.schema.json uses, nothing more.
// ---------------------------------------------------------------------------

interface SchemaNode {
  $ref?: string
  type?: 'object' | 'array' | 'string' | 'integer'
  const?: unknown
  enum?: unknown[]
  pattern?: string
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  items?: SchemaNode
  required?: string[]
  properties?: Record<string, SchemaNode>
  additionalProperties?: boolean
}

const patternCache = new Map<string, RegExp>()

function resolveRef(node: SchemaNode): SchemaNode {
  let current = node
  while (current.$ref) {
    const name = current.$ref.replace(/^#\/\$defs\//, '')
    const target = (schema as any).$defs?.[name] as SchemaNode | undefined
    if (!target) throw new Error(`credits.schema.json: unknown $ref ${current.$ref}`)
    current = target
  }
  return current
}

function checkSchema(value: unknown, rawNode: SchemaNode, path: string, report: (message: string) => void): void {
  const node = resolveRef(rawNode)
  const at = path || '(root)'

  if ('const' in node && value !== node.const) {
    report(`${at}: must be ${JSON.stringify(node.const)}`)
    return
  }
  if (node.enum && !node.enum.includes(value)) {
    report(`${at}: must be one of ${node.enum.join(', ')}`)
    return
  }

  switch (node.type) {
    case 'object': {
      if (!isPlainObject(value)) {
        report(`${at}: must be an object`)
        return
      }
      for (const key of node.required ?? []) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) report(`${at}: ${key} is required`)
      }
      for (const [key, child] of Object.entries(value)) {
        const childNode = node.properties?.[key]
        if (!childNode) {
          if (node.additionalProperties === false) report(`${join(path, key)}: is not a known field`)
          continue
        }
        checkSchema(child, childNode, join(path, key), report)
      }
      return
    }
    case 'array': {
      if (!Array.isArray(value)) {
        report(`${at}: must be an array`)
        return
      }
      if (node.minItems !== undefined && value.length < node.minItems) report(`${at}: must have at least ${node.minItems} item(s)`)
      if (node.maxItems !== undefined && value.length > node.maxItems) report(`${at}: must have at most ${node.maxItems} items`)
      if (node.items) value.forEach((item, index) => checkSchema(item, node.items!, `${path}[${index}]`, report))
      return
    }
    case 'string': {
      if (typeof value !== 'string') {
        report(`${at}: must be a string`)
        return
      }
      const length = Array.from(value).length
      if (node.minLength !== undefined && length < node.minLength) report(`${at}: must not be empty`)
      if (node.maxLength !== undefined && length > node.maxLength) report(`${at}: is ${length} characters, over the limit of ${node.maxLength}`)
      if (node.pattern) {
        let pattern = patternCache.get(node.pattern)
        if (!pattern) {
          pattern = new RegExp(node.pattern, 'u')
          patternCache.set(node.pattern, pattern)
        }
        if (!pattern.test(value)) report(`${at}: has characters or a form that is not allowed`)
      }
      return
    }
    case 'integer': {
      if (!Number.isInteger(value)) report(`${at}: must be an integer`)
      return
    }
    default:
      return
  }
}

// ---------------------------------------------------------------------------
// The rules the schema cannot state.
// ---------------------------------------------------------------------------

function checkDocumentRules(document: CreditsDocument, scope: CreditsScope, report: (message: string) => void): void {
  const assetIds = new Set<string>()
  document.assets.forEach((asset, index) => {
    if (assetIds.has(asset.id)) report(`assets[${index}].id: "${asset.id}" is used by another asset`)
    assetIds.add(asset.id)
    if (asset.path !== undefined) checkRelativePath(asset.path, `assets[${index}].path`, report)
    asset.derivedFrom?.forEach((input, inputIndex) => {
      const at = `assets[${index}].derivedFrom[${inputIndex}].libraryPath`
      checkRelativePath(input.libraryPath, at, report)
      if (!/^(movies|tv)\//.test(input.libraryPath)) report(`${at}: must begin with movies/ or tv/`)
    })
  })

  const entryIds = new Set<string>()
  document.entries.forEach((entry, index) => {
    const at = `entries[${index}]`
    if (entryIds.has(entry.id)) report(`${at}.id: "${entry.id}" is used by another entry`)
    entryIds.add(entry.id)

    const named = new Set<string>()
    entry.assetIds.forEach((assetId, assetIndex) => {
      if (named.has(assetId)) report(`${at}.assetIds[${assetIndex}]: "${assetId}" is listed twice`)
      named.add(assetId)
      if (!assetIds.has(assetId)) report(`${at}.assetIds[${assetIndex}]: "${assetId}" is not an asset of this file`)
    })

    if (!CREDIT_FIELDS.some((field) => hasCreditValue(entry[field]))) {
      report(`${at}: needs at least one of ${CREDIT_FIELDS.join(', ')}`)
    }
    for (const field of URL_FIELDS) {
      const url = entry[field]
      if (url !== undefined && !isPublicHttpUrl(url)) {
        report(`${at}.${field}: must be an absolute http: or https: URL without a user name or password`)
      }
    }
    if (entry.replaces !== undefined && scope !== 'episode') {
      report(`${at}.replaces: only an episode's credits file may replace inherited entries`)
    }
  })

  if (document.suppress !== undefined && scope !== 'episode') {
    report('suppress: only an episode\'s credits file may suppress inherited entries')
  }

  forEachString(document, '', (text, path) => {
    if (CONTROL_CHARACTERS.test(text)) report(`${path}: contains a control character`)
  })
}

function hasCreditValue(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string'
}

/**
 * A path relative to a folder: no leading slash, backslash, drive letter or
 * scheme, and no empty, `.` or `..` segment.
 */
function checkRelativePath(path: string, at: string, report: (message: string) => void): void {
  if (path.startsWith('/')) return report(`${at}: must be relative (it begins with /)`)
  if (path.includes('\\')) return report(`${at}: must use / between folders`)
  if (/^[A-Za-z]:/.test(path)) return report(`${at}: must be relative (it begins with a drive letter)`)
  // A URL, or a scheme a browser would act on. (A colon later in a file name,
  // legal on Linux, is not a scheme.)
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(path) || /^(javascript|data|file|vbscript|blob):/i.test(path)) {
    return report(`${at}: must be relative (it begins with a scheme)`)
  }
  if (path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    report(`${at}: must not have an empty, "." or ".." segment`)
  }
}

/** An absolute http: or https: URL, with no user name or password. */
export function isPublicHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === '' && url.hostname !== ''
}

function forEachString(value: unknown, path: string, visit: (text: string, path: string) => void): void {
  if (typeof value === 'string') return visit(value, path || '(root)')
  if (Array.isArray(value)) return value.forEach((item, index) => forEachString(item, `${path}[${index}]`, visit))
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) forEachString(child, join(path, key), visit)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key
}
