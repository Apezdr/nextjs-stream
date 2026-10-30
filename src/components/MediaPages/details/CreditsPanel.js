import { isPublicHttpUrl } from '@src/utils/credits/validate'
import { SectionHeading } from './Primitives'

/**
 * Credits & licenses: a title's (or an episode's) credits, as the API
 * resolves them (src/utils/credits/resolve, CREDITS_SIDECAR.md section 8).
 *
 * Its own panel, below the synopsis and outside the hero. Entries are grouped
 * by kind (video, artwork, music and audio, subtitles, other) and keep their
 * authored order inside a group. Every supplied field is shown in full: the
 * longer conditions (notices, historical notices, a note) sit in a
 * disclosure, which keeps them in the page and reachable from the keyboard.
 * Text is rendered as text, and a link only for an http(s) URL.
 *
 * Server-renderable: no state, no effects.
 *
 * @param {{ credits: { entries: Array<object> } | null | undefined, id?: string, title?: string }} props
 */
export default function CreditsPanel({ credits, id = 'credits', title = 'Credits & licenses' }) {
  const groups = groupEntries(credits?.entries)
  if (groups.length === 0) return null
  const derived = derivedInputsByEntry(groups)
  return (
    <section id={id} aria-labelledby={`${id}-heading`}>
      <SectionHeading id={`${id}-heading`}>{title}</SectionHeading>
      <div className="space-y-8 rounded-xl bg-black/45 p-5 ring-1 ring-white/15 sm:p-6">
        {groups.map((group) => (
          <div key={group.key}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-white/75">{group.label}</h3>
            <ul role="list" className="mt-3 divide-y divide-white/10">
              {group.entries.map((entry, index) => (
                <li key={`${entry.scope}:${entry.id}:${index}`} className="py-5 first:pt-0 last:pb-0">
                  <CreditEntry entry={entry} derivedFrom={derived.get(entry) ?? []} headingId={`${id}-${group.key}-${index}`} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

const KIND_LABELS = {
  film: 'Film',
  episode: 'Episode',
  trailer: 'Trailer',
  poster: 'Poster',
  backdrop: 'Backdrop',
  logo: 'Logo',
  thumbnail: 'Thumbnail',
  artwork: 'Artwork',
  music: 'Music',
  audio: 'Audio',
  subtitles: 'Subtitles',
  other: 'Other',
}

const GROUPS = [
  { key: 'video', label: 'Video', kinds: ['film', 'episode', 'trailer'] },
  { key: 'artwork', label: 'Artwork', kinds: ['poster', 'backdrop', 'logo', 'thumbnail', 'artwork'] },
  { key: 'sound', label: 'Music & audio', kinds: ['music', 'audio'] },
  { key: 'subtitles', label: 'Subtitles', kinds: ['subtitles'] },
  { key: 'other', label: 'Other', kinds: ['other'] },
]

/** The entry's kind: its own, else its first asset's. */
function entryKind(entry) {
  return entry.kind || entry.assets?.[0]?.kind || 'other'
}

/** The entries in display groups, each group in authored order; empty groups left out. */
export function groupEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return []
  return GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    entries: entries.filter((entry) => group.kinds.includes(entryKind(entry))),
  })).filter((group) => group.entries.length > 0)
}

/**
 * What each entry lists under "Derived from": the inputs of its assets, each
 * asset's once, on the first entry (in display order) that names it. Several
 * contributing works credited on one collage then list its inputs once, not
 * once per work. Assets of different files may share an id, so an asset is
 * told apart by its entry's scope too.
 */
export function derivedInputsByEntry(groups) {
  const shown = new Set()
  const byEntry = new Map()
  for (const group of groups) {
    for (const entry of group.entries) {
      const inputs = []
      for (const asset of entry.assets ?? []) {
        const key = `${entry.scope}:${asset.id}`
        if (!asset.derivedFrom?.length || shown.has(key)) continue
        shown.add(key)
        inputs.push(...asset.derivedFrom.map((input) => input.note || input.libraryPath))
      }
      byEntry.set(entry, inputs)
    }
  }
  return byEntry
}

function assetName(asset) {
  return asset.label || KIND_LABELS[asset.kind] || asset.kind
}

function CreditEntry({ entry, derivedFrom, headingId }) {
  const assets = Array.isArray(entry.assets) ? entry.assets : []
  const heading = entry.work || assets.map(assetName).join(', ') || KIND_LABELS[entryKind(entry)]
  const conditions = [
    ...(entry.notices ?? []).map((text) => ({ label: 'Notice', text })),
    ...(entry.historicalNotices ?? []).map((text) => ({ label: 'Notice on the original work', text })),
    ...(entry.note ? [{ label: 'Note', text: entry.note }] : []),
  ]

  return (
    <article aria-labelledby={headingId}>
      <h4 id={headingId} className="break-words text-base font-semibold text-white">
        {heading}
      </h4>
      <p className="mt-1 text-sm text-white/75">
        {entry.scope === 'show' ? 'Series credit · ' : ''}
        Applies to: {assets.length > 0 ? assets.map(assetName).join(', ') : KIND_LABELS[entryKind(entry)]}
      </p>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,max-content)_1fr]">
        <Row label="By" show={entry.author || entry.authorUrl}>
          {entry.author ? <Text>{entry.author}</Text> : null}
          {entry.authorUrl ? <ExternalLink href={entry.authorUrl} className={entry.author ? 'ml-2' : ''} /> : null}
        </Row>
        <Row label="Attribution" show={entry.attributionText}>
          <Text>{entry.attributionText}</Text>
        </Row>
        <Row label="Copyright" show={entry.copyrightNotice}>
          <Text>{entry.copyrightNotice}</Text>
        </Row>
        <Row label="License" show={entry.license || entry.licenseUrl}>
          {entry.license ? <Text>{entry.license}</Text> : null}
          {entry.licenseUrl ? (
            <span className={entry.license ? 'mt-0.5 block' : ''}>
              <ExternalLink href={entry.licenseUrl} />
            </span>
          ) : null}
        </Row>
        <Row label="Source" show={entry.sourceUrl}>
          <ExternalLink href={entry.sourceUrl} />
        </Row>
        <Row label="Derived from" show={derivedFrom.length > 0}>
          <TextList items={derivedFrom} />
        </Row>
        <Row label="Changes" show={entry.modification}>
          <Text>{entry.modification}</Text>
        </Row>
        <Row label="Earlier changes" show={entry.previousModifications?.length > 0}>
          <TextList items={entry.previousModifications} />
        </Row>
        <Row label="Not covered" show={entry.exclusions?.length > 0}>
          <TextList items={entry.exclusions} />
        </Row>
      </dl>

      {conditions.length > 0 ? (
        <details className="group mt-3 rounded-lg bg-white/5 ring-1 ring-white/10">
          <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium text-blue-200 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300">
            Notices and conditions ({conditions.length})
          </summary>
          <dl className="space-y-3 px-3 pb-3 pt-1 text-sm">
            {conditions.map((condition, index) => (
              <div key={index}>
                <dt className="text-xs font-medium uppercase tracking-wide text-white/70">{condition.label}</dt>
                <dd className="mt-0.5 text-white/90">
                  <Text>{condition.text}</Text>
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </article>
  )
}

function Row({ label, show, children }) {
  if (!show) return null
  return (
    <>
      <dt className="font-medium text-white/70">{label}</dt>
      <dd className="min-w-0 text-white/95">{children}</dd>
    </>
  )
}

/** Supplied text, line breaks kept, never parsed as HTML or Markdown. */
function Text({ children }) {
  return <span className="whitespace-pre-line break-words">{children}</span>
}

function TextList({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null
  if (items.length === 1) return <Text>{items[0]}</Text>
  return (
    <ul className="list-disc space-y-1 pl-5">
      {items.map((item, index) => (
        <li key={index}>
          <Text>{item}</Text>
        </li>
      ))}
    </ul>
  )
}

/**
 * A link for an http(s) URL, its text the URL itself (without the scheme), so
 * what it opens is never hidden behind a label. Anything else is shown as
 * plain text, never as a link.
 */
function ExternalLink({ href, className = '' }) {
  if (!isPublicHttpUrl(href)) return <Text>{String(href ?? '')}</Text>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`break-all rounded text-blue-300 underline underline-offset-2 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 ${className}`}
    >
      {href.replace(/^https?:\/\//, '')}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}
