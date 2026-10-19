/**
 * The Logs page's copy and download formats, for the lines it shows.
 */

const TRACE_FIELDS = ['trace_id', 'span_id', 'trace_flags']

/** A line's own fields, and its trace ID kept apart: on their own the trace fields say nothing. */
export function splitMeta(meta) {
  if (!meta) return { fields: null, traceId: null }
  const fields = Object.fromEntries(Object.entries(meta).filter(([key]) => !TRACE_FIELDS.includes(key)))
  return {
    fields: Object.keys(fields).length > 0 ? fields : null,
    traceId: typeof meta.trace_id === 'string' ? meta.trace_id : null,
  }
}

// Swedish formats a date as YYYY-MM-DD HH:mm:ss, which reads unambiguously anywhere.
const exportTime = new Intl.DateTimeFormat('sv-SE', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

export const formatExportTime = (iso) => (iso ? exportTime.format(new Date(iso)) : null)

/** `2026-10-19 18:27:55 WARN  [auth-middleware] message {"status":404}` */
export function formatLine(entry) {
  const { fields } = splitMeta(entry.meta)
  const time = formatExportTime(entry.time) ?? '-'.padEnd(19)
  const level = (entry.level ?? 'raw').toUpperCase().padEnd(5)
  return `${time} ${level} [${entry.category ?? '-'}] ${entry.message}${fields ? ` ${JSON.stringify(fields)}` : ''}`
}

export function toText(entries) {
  return entries.map(formatLine).join('\n') + '\n'
}

/**
 * @param {object[]} entries
 * @param {{ server: string, sources: string, level: string, search: string, range: string, timeZone: string }} context
 */
export function toMarkdown(entries, context) {
  const body = toText(entries)
  const fence = body.includes('```') ? '````' : '```'
  const first = formatExportTime(entries[0]?.time)
  const last = formatExportTime(entries.at(-1)?.time)
  const filters = [`Sources: ${context.sources}`, `Level: ${context.level}`, `Time: ${context.range}`]
  if (context.search) filters.push(`Search: "${context.search}"`)
  return [
    `### Processor log: ${context.server}`,
    '',
    `- ${entries.length} ${entries.length === 1 ? 'line' : 'lines'}${first && last ? `, ${first} to ${last} (${context.timeZone})` : ''}`,
    `- ${filters.join(' · ')}`,
    '',
    `${fence}text`,
    body.trimEnd(),
    fence,
    '',
  ].join('\n')
}

export function toJson(entries, context) {
  return `${JSON.stringify({ ...context, exportedAt: new Date().toISOString(), entries }, null, 2)}\n`
}

export function exportFileName(server, extension, now = new Date()) {
  const stamp = exportTime.format(now).replace(/[-: ]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')
  return `processor-log-${server.replace(/[^\w-]+/g, '_')}-${stamp}.${extension}`
}

export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}
