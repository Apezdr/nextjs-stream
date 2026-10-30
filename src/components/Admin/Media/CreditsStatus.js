import { useId } from 'react'

/**
 * The sync's state of a title's (or an episode's) credits sidecar, for
 * admins: what is stored and where it came from, and, while the last attempt
 * failed, why (CREDITS_SIDECAR.md, section 5).
 *
 * The credits a failure keeps are the last valid ones: the notice says so,
 * and names the file they came from, so they are never read as a newly
 * verified file. Read-only: credits are edited in the sidecar, not here.
 *
 * @param {{ record: { _id?: string, credits?: object, creditsSource?: string, creditsHash?: string, creditsStatus?: object } | null, scope?: 'title'|'episode'|'library' }} props
 */
export default function CreditsStatus({ record, scope = 'title' }) {
  const headingId = useId()
  const credits = record?.credits
  const status = record?.creditsStatus
  const entries = Array.isArray(credits?.entries) ? credits.entries.length : 0
  const file = scope === 'episode' ? 'its <NN>_credits.json' : scope === 'library' ? 'a credits.json at the library root' : 'its credits.json'

  return (
    <section aria-labelledby={headingId} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 id={headingId} className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">
        {scope === 'library' ? <>Library credits of server <span className="font-mono normal-case">{record?._id}</span></> : <>Credits &amp; licenses</>}
      </h2>
      {credits ? (
        <p className="text-sm text-gray-700">
          {entries} {entries === 1 ? 'entry' : 'entries'} from server <span className="font-mono">{record.creditsSource || 'unknown'}</span>
          {record.creditsHash ? (
            <>
              , file <span className="font-mono" title={record.creditsHash}>{record.creditsHash.slice(0, 12)}</span>
            </>
          ) : null}
          .{scope === 'episode' ? ' The episode also shows its show’s credits.' : ''}
        </p>
      ) : (
        <p className="text-sm text-gray-500">No credits synced. Add {file} beside the metadata to show credits.</p>
      )}
      {status?.state === 'error' ? (
        <div role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">The last credits sync failed: {describeReason(status.reason)}</p>
          {status.detail ? <p className="mt-1 whitespace-pre-line break-words font-mono text-xs">{status.detail}</p> : null}
          <p className="mt-2">
            Server <span className="font-mono">{status.serverId}</span>
            {status.since ? <>, since {formatUtc(status.since)}</> : null}.{' '}
            {RETRIED.has(status.reason) || (status.reason?.startsWith('server:') && !PINNED_SERVER.has(status.reason))
              ? 'The sync retries on every pass.'
              : 'The file is read again once it changes.'}
            {credits
              ? ` The credits shown are the last valid ones${record.creditsHash ? ` (file ${record.creditsHash.slice(0, 12)})` : ''}, not the failed file.`
              : ' No credits are shown until a file is valid.'}
          </p>
        </div>
      ) : null}
    </section>
  )
}

// Failures the sync retries on every pass; the others wait for the file to
// change (CREDITS_SIDECAR.md, section 5).
const RETRIED = new Set(['fetch-failed', 'hash-mismatch'])
const PINNED_SERVER = new Set(['server:too-large', 'server:empty', 'server:not-a-file'])

const REASONS = {
  'fetch-failed': 'the file could not be fetched from the file server',
  'too-large': 'the file is over 256 KiB',
  'invalid-json': 'the file is not valid JSON',
  'unsupported-version': 'the file’s schemaVersion is not one this build reads',
  schema: 'the file does not follow the credits schema',
  'hash-mismatch': 'the file changed since the processor published it',
  'not-utf8': 'the file is not saved as UTF-8',
  'malformed-locator': 'the processor published a credits URL without its hash',
  'server:unreadable': 'the processor could not read the file',
  'server:too-large': 'the processor found the file over 256 KiB',
  'server:empty': 'the processor found the file empty',
  'server:not-a-file': 'the processor found a folder or other non-file named like the credits file',
}

function describeReason(reason) {
  return REASONS[reason] || reason
}

function formatUtc(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
