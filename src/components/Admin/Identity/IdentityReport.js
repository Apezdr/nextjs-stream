'use client'

/**
 * Title matching, for the admin area.
 *
 * Radarr (movies) and Sonarr (TV) know the exact TMDB entry for every folder
 * they manage. Once per pass the media processor compares those answers with
 * the match pinned on each folder and keeps ONE report in memory
 * (media-processor integrations/identity/). This page is the only place to
 * read that report outside the processor log. It never edits anything: a
 * disagreement is fixed in Radarr/Sonarr, or in the title's TMDB config editor.
 *
 * Written for an admin who may not know what Radarr or Sonarr are, so every
 * label says what a thing means rather than what the processor calls it.
 *
 * States, in the order the processor can be in: unreachable, not connected to
 * any manager (`enabled: false`), no check yet (HTTP 202, e.g. right after a
 * restart), or a report.
 */

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  FingerPrintIcon,
  FolderMinusIcon,
  FolderOpenIcon,
  InformationCircleIcon,
  LinkIcon,
  QuestionMarkCircleIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { buildURL, fetcher } from '@src/utils'
import { MaterialCard, MaterialCardHeader, MaterialCardContent, MaterialButton, StatusBadge, MetricCard } from '../BaseComponents'
import { describeIdentitySource, providerLabel } from '@src/utils/admin/identitySource'

const REFRESH_INTERVAL_MS = 60_000
const reportKey = buildURL('/api/authenticated/admin/identity/report')
const statusKey = buildURL('/api/authenticated/admin/identity/status')

/**
 * The shared fetcher throws on any non-OK answer with only the status text, so
 * a processor build that predates the identity endpoints surfaces as "HTTP
 * 404". That is a deployment state, not a transient fault: name it, and do not
 * let SWR retry it in a loop.
 */
const isMissingEndpoint = (error) => /\b404\b/.test(error?.message || '')

/**
 * Two "not ready yet" states get short polls instead of the minute-long one:
 * a processor that has booted but not reconciled (202, `pending`), and one
 * that is not answering at all, which right after a boot or an image deploy
 * is a restart in progress. Both resolve on their own; the page should show
 * that happening rather than ask for a click.
 */
const INITIALIZING_POLL_MS = 10_000
const UNREACHABLE_POLL_MS = 15_000

export const swrOptions = {
  refreshInterval: (data) => (data?.pending ? INITIALIZING_POLL_MS : REFRESH_INTERVAL_MS),
  revalidateOnFocus: true,
  onErrorRetry: (error, _key, _config, revalidate, { retryCount }) => {
    if (isMissingEndpoint(error)) return
    setTimeout(() => revalidate({ retryCount }), UNREACHABLE_POLL_MS)
  },
}

/**
 * The report is only rebuilt at the top of a scan tick, and a tick can run
 * for many minutes when the scanner has real work (an artwork sweep after a
 * batch of repairs, a new season). An admin who has just fixed something in
 * Radarr or Sonarr comes back to a report that predates the fix and nothing
 * saying so. Past this age the page says how old the report is and refreshes
 * it from the managers itself: a reconcile takes a few seconds and shares one
 * run with any tick in progress, so it is safe to trigger from a page view.
 */
export const STALE_AFTER_MS = 5 * 60_000

/**
 * Newer processors keep the report fresh themselves (a reconcile job every
 * minute plus webhook-driven runs) and publish `checkedAt` (last time they
 * looked), `at` (last time the library changed) and `staleAfterMs` (their own
 * threshold). When those are present the page reports age off `checkedAt`,
 * judges staleness by the processor's threshold, and does NOT trigger its own
 * refresh: a report that is stale under the processor's own rule means its
 * job is not running, which is worth showing rather than papering over.
 * An older processor publishes neither, and the page keeps its fallback.
 */
export function selfRefreshing(report) {
  return Number.isFinite(report?.staleAfterMs) && report.staleAfterMs > 0
}

export function staleThresholdMs(report) {
  return selfRefreshing(report) ? report.staleAfterMs : STALE_AFTER_MS
}

export function reportAgeMs(report, now = Date.now()) {
  const at = Date.parse(report?.checkedAt || report?.at || '')
  return Number.isNaN(at) ? null : Math.max(0, now - at)
}

export function formatAge(ms) {
  if (ms == null) return ''
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return `${hours} h ${minutes % 60} min ago`
}

function formatWhen(iso) {
  if (!iso || Number.isNaN(Date.parse(iso))) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function splitPath(libraryRelativePath) {
  const slash = String(libraryRelativePath || '').indexOf('/')
  if (slash < 0) return { mediaType: 'movie', folder: libraryRelativePath || '' }
  const root = libraryRelativePath.slice(0, slash)
  return { mediaType: root === 'tv' ? 'tv' : 'movie', folder: libraryRelativePath.slice(slash + 1) }
}

/**
 * Folder names as a manager and the disk would spell the same title. Radarr and
 * Sonarr replace characters that are illegal on Windows ("The End?" becomes
 * "The End!"), and post-processing steps sometimes put the file back under the
 * real title, so the manager loses its file while the library keeps it.
 * Comparing names with punctuation and case stripped pairs the two halves.
 */
function folderKey(libraryRelativePath) {
  return String(libraryRelativePath || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Pair manager-only rows with unmanaged folders that are the same title.
 *
 * By TMDB id first: the proxy attaches the catalog's id for each unmanaged
 * folder (`unmanaged.catalog`), and a manager row carries the id it expects,
 * so a match there is certain. By spelling second, for a folder the catalog
 * has not indexed yet. Returns two maps keyed by libraryRelativePath; each
 * pairing records how it was made.
 */
function pairRenamed(providerOnly, unmanaged) {
  const catalog = unmanaged?.catalog || {}
  const byTmdbId = new Map()
  const byKey = new Map()
  for (const path of unmanaged?.items || []) {
    const tmdbId = catalog[path]?.tmdbId
    if (tmdbId && !byTmdbId.has(tmdbId)) byTmdbId.set(tmdbId, path)
    const key = folderKey(path)
    if (key && !byKey.has(key)) byKey.set(key, path)
  }
  const diskFor = new Map()
  const arrFor = new Map()
  for (const row of providerOnly?.items || []) {
    let onDisk = row.tmdbId ? byTmdbId.get(row.tmdbId) : undefined
    let by = 'tmdbId'
    if (!onDisk) {
      onDisk = byKey.get(folderKey(row.libraryRelativePath))
      by = 'name'
    }
    if (!onDisk || onDisk === row.libraryRelativePath) continue
    diskFor.set(row.libraryRelativePath, { path: onDisk, by })
    arrFor.set(onDisk, { row, by })
  }
  return { diskFor, arrFor }
}

/** "Radarr and Sonarr", or whatever is actually connected. */
function managerNames(status) {
  const names = (status?.providers || []).map((p) => providerLabel(p.name)).filter(Boolean)
  if (names.length === 0) return 'Radarr and Sonarr'
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Link into the admin media list, searched for the folder name. */
function FolderLink({ libraryRelativePath }) {
  const { mediaType, folder } = splitPath(libraryRelativePath)
  const list = mediaType === 'tv' ? 'tv' : 'movies'
  return (
    <Link href={`/admin/media/${list}?q=${encodeURIComponent(folder)}`} className="font-medium text-blue-600 hover:text-blue-700">
      {folder}
    </Link>
  )
}

function TmdbLink({ mediaType, id, children }) {
  if (!id) return <span>—</span>
  const kind = mediaType === 'tv' ? 'tv' : 'movie'
  return (
    <a
      href={`https://www.themoviedb.org/${kind}/${id}`}
      target="_blank"
      rel="noreferrer"
      className="underline decoration-dotted hover:text-blue-600"
    >
      {children ?? id}
    </a>
  )
}

function Spinner({ className = '' }) {
  return <div className={`h-5 w-5 animate-spin rounded-full border-b-2 border-blue-600 ${className}`} aria-hidden="true" />
}

function countLabel(list) {
  const shown = list?.items?.length ?? 0
  const total = list?.total ?? shown
  const more = list?.truncated ?? 0
  return more > 0 ? `${shown} of ${total}, and ${more} more` : String(total)
}

const cellClass = 'px-4 py-3 text-sm text-gray-700 align-top'
const headClass = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500'

function Table({ columns, rows, empty }) {
  if (!rows?.length) {
    return (
      <p className="flex items-center gap-2 text-sm text-gray-600">
        <CheckCircleIcon className="h-5 w-5 text-green-600" aria-hidden="true" />
        {empty}
      </p>
    )
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className={headClass}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">{rows}</tbody>
      </table>
    </div>
  )
}

function Section({ title, subtitle, icon, list, children }) {
  const count = list?.total ?? list?.items?.length ?? 0
  return (
    <MaterialCard elevation="low">
      <MaterialCardHeader
        title={
          <span className="flex items-center gap-2">
            {title}
            <span className="text-sm font-normal text-gray-500">{countLabel(list)}</span>
          </span>
        }
        subtitle={subtitle}
        icon={icon}
        action={
          count > 0 ? (
            <StatusBadge status={list?.__tone || 'neutral'} variant="soft" size="small">
              {count} {count === 1 ? 'item' : 'items'}
            </StatusBadge>
          ) : null
        }
      />
      <MaterialCardContent>{children}</MaterialCardContent>
    </MaterialCard>
  )
}

function ConflictsSection({ list, managers }) {
  const rows = (list?.items || []).map((c) => {
    const { mediaType } = splitPath(c.libraryRelativePath)
    const stored = describeIdentitySource(c.storedSource)
    return (
      <tr key={c.libraryRelativePath}>
        <td className={cellClass}>
          <FolderLink libraryRelativePath={c.libraryRelativePath} />
        </td>
        <td className={cellClass}>
          <TmdbLink mediaType={mediaType} id={c.storedId} />
          <div className="text-xs text-gray-500">{stored.label}</div>
        </td>
        <td className={cellClass}>
          <TmdbLink mediaType={mediaType} id={c.providerId}>
            {c.title ? `${c.title}${c.year ? ` (${c.year})` : ''}` : c.providerId}
          </TmdbLink>
          <div className="text-xs text-gray-500">
            {providerLabel(c.source)} · TMDB id {c.providerId}
          </div>
        </td>
        <td className={`${cellClass} text-gray-600`}>
          If {providerLabel(c.source)} is right, open the title and choose &ldquo;Hand back to provider&rdquo;. If the
          pin is right, fix the movie in {providerLabel(c.source)}.
        </td>
      </tr>
    )
  })
  return (
    <Section
      title="Needs your decision"
      subtitle={`A title was pinned by hand to one TMDB entry, but ${managers} say it is a different one. Only a person can settle it.`}
      icon={<ExclamationTriangleIcon className="h-6 w-6" />}
      list={{ ...list, __tone: 'error' }}
    >
      <Table
        columns={['Folder', 'Pinned on the media server', 'Manager says', 'What to do']}
        rows={rows}
        empty={`Every hand-pinned title agrees with ${managers}.`}
      />
    </Section>
  )
}

function WrittenSection({ list, managers }) {
  const rows = (list?.items || []).map((w) => {
    const { mediaType } = splitPath(w.libraryRelativePath)
    return (
      <tr key={w.libraryRelativePath}>
        <td className={cellClass}>
          <FolderLink libraryRelativePath={w.libraryRelativePath} />
        </td>
        <td className={cellClass}>
          {w.replacedId ? (
            <>
              <TmdbLink mediaType={mediaType} id={w.replacedId} />
              <span className="text-xs text-gray-500"> ({describeIdentitySource(w.replacedSource).label.toLowerCase()})</span>
            </>
          ) : (
            <span className="text-gray-400">no match yet</span>
          )}
        </td>
        <td className={cellClass}>
          <TmdbLink mediaType={mediaType} id={w.tmdbId} />
          <span className="text-xs text-gray-500"> (from {providerLabel(w.source)})</span>
        </td>
        <td className={cellClass}>{w.replacedId ? 'Corrected a wrong match' : 'Matched for the first time'}</td>
      </tr>
    )
  })
  return (
    <Section
      title="Corrected this pass"
      subtitle={`Matches the media server changed to agree with ${managers}. The title's name, poster and details update after the next library scan. Its "added" date does not change.`}
      icon={<WrenchScrewdriverIcon className="h-6 w-6" />}
      list={{ ...list, __tone: 'success' }}
    >
      <Table columns={['Folder', 'Was', 'Now', 'Kind']} rows={rows} empty="Nothing needed correcting." />
    </Section>
  )
}

/** Links for the ids a manager holds besides TMDB, so an operator can chase a missing mapping upstream. */
function ExternalIdLinks({ externalIds, mediaType }) {
  const ids = externalIds && typeof externalIds === 'object' ? externalIds : {}
  const parts = []
  if (ids.imdb) {
    parts.push(
      <a key="imdb" href={`https://www.imdb.com/title/${ids.imdb}/`} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-blue-600">
        IMDb {ids.imdb}
      </a>
    )
  }
  if (ids.tvdb) {
    const kind = mediaType === 'tv' ? 'series' : 'movie'
    parts.push(
      <a key="tvdb" href={`https://www.thetvdb.com/dereferrer/${kind}/${ids.tvdb}`} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-blue-600">
        TVDB {ids.tvdb}
      </a>
    )
  }
  if (!parts.length) return <span className="text-gray-400">no other ids</span>
  return parts.reduce((acc, el, i) => (i === 0 ? [el] : [...acc, ' · ', el]), [])
}

/**
 * Titles a manager tracks but cannot name on TMDB: Sonarr's source is TheTVDB
 * and its TVDB-to-TMDB mapping is sometimes missing for a new show. The
 * processor tries TMDB's own external-id lookup first; what is still
 * unresolved lands here. These folders are NOT unmanaged, and the local pin,
 * if any, came from the name search, so it carries the same risk as an
 * unmanaged folder's with a different explanation.
 */
function ManagedUnidentifiedSection({ list, managers }) {
  const items = list?.items || []
  if (!items.length) return null
  const rows = items.map((u) => {
    const { mediaType } = splitPath(u.libraryRelativePath)
    const manager = providerLabel(u.source)
    const pin = u.localPin
    const pinInfo = pin?.tmdbId ? describeIdentitySource(pin.source) : null
    return (
      <tr key={u.libraryRelativePath}>
        <td className={cellClass}>
          <FolderLink libraryRelativePath={u.libraryRelativePath} />
          {u.title ? <div className="text-xs text-gray-500">{u.title}{u.year ? ` (${u.year})` : ''}</div> : null}
        </td>
        <td className={cellClass}>
          <div>{manager}</div>
          <div className="text-xs text-gray-500">
            <ExternalIdLinks externalIds={u.externalIds} mediaType={mediaType} />
          </div>
        </td>
        <td className={cellClass}>
          {pin?.tmdbId ? (
            <>
              <TmdbLink mediaType={mediaType} id={pin.tmdbId} />
              <div className="text-xs text-gray-500">{pinInfo.label}</div>
            </>
          ) : (
            <span className="text-gray-400">no pin yet</span>
          )}
        </td>
        <td className={`${cellClass} text-orange-700`}>
          {pin?.tmdbId
            ? `Neither ${manager} nor TMDB can confirm this match. Check it, then pin it by hand if it is right.`
            : `Neither ${manager} nor TMDB has a TMDB entry for it. The title will be matched by name on the next scan.`}
        </td>
      </tr>
    )
  })
  return (
    <Section
      title="Managed, but no TMDB id"
      subtitle={`${managers} track these titles but have no TMDB entry for them, and TMDB's own id lookup found none either. The library's match cannot be checked against the manager, so it is worth a look.`}
      icon={<QuestionMarkCircleIcon className="h-6 w-6" />}
      list={{ ...list, __tone: 'warning' }}
    >
      <Table columns={['Folder', 'Manager · other ids', 'Library is using', 'What it means']} rows={rows} empty="" />
    </Section>
  )
}

function ProviderOnlySection({ list, diskFor, managers }) {
  const rows = (list?.items || []).map((p) => {
    const { mediaType } = splitPath(p.libraryRelativePath)
    const paired = diskFor?.get(p.libraryRelativePath)
    const manager = providerLabel(p.source)
    // Newer processors forward the manager's own availability on the row:
    // `released` (the manager considers it obtainable now), `monitored` (it is
    // actively looking) and `arrStatus` (its lifecycle word, for the tooltip).
    // Without them the row can only say the title has not been obtained.
    let state = `Not downloaded yet — ${manager} is watching for it`
    if (p.monitored === false) state = `Not monitored in ${manager}, so it will not be downloaded`
    else if (p.released === false) state = `Not released yet — ${manager} will download it when it is`
    else if (p.released === true) state = `Released, not downloaded yet — ${manager} is looking for it`
    let tone = 'text-gray-500'
    if (paired) {
      const certain = paired.by === 'tmdbId'
      state = (
        <>
          <span className="font-medium">
            {certain ? `${manager} lost track of it` : 'Probably renamed'}: on disk as{' '}
            <FolderLink libraryRelativePath={paired.path} />
            {certain ? ', same TMDB id' : ''}
          </span>
          <div className="text-xs opacity-80">
            It may download the file again. In {manager}, point the title at that folder and rescan.
          </div>
        </>
      )
      tone = 'text-orange-700'
    } else if (p.nested) {
      state = 'Folder is nested too deep for the media server to see'
      tone = 'text-orange-700'
    } else if (p.hasFile) {
      state = `${manager} has a file, but no folder by this name is in the library. Renamed?`
      tone = 'text-orange-700'
    }
    return (
      <tr key={`${p.source}:${p.providerPath || p.libraryRelativePath}`}>
        <td className={cellClass}>
          <div>{splitPath(p.libraryRelativePath).folder}</div>
          {p.providerPath ? <div className="text-xs text-gray-500">{p.providerPath}</div> : null}
        </td>
        <td className={cellClass}>
          {manager} ·{' '}
          {p.tmdbId ? (
            <TmdbLink mediaType={mediaType} id={p.tmdbId} />
          ) : (
            <span className="text-xs text-gray-500">
              no TMDB id · <ExternalIdLinks externalIds={p.externalIds} mediaType={mediaType} />
            </span>
          )}
        </td>
        <td className={`${cellClass} ${tone}`} title={p.arrStatus ? `${manager} status: ${p.arrStatus}` : undefined}>
          {state}
        </td>
      </tr>
    )
  })
  return (
    <Section
      title="Expected by a manager, not in the library"
      subtitle={`Titles ${managers} are tracking that have no folder here yet: not released, or released but not downloaded. That is normal. A lost or renamed one is flagged in orange.`}
      icon={<FolderMinusIcon className="h-6 w-6" />}
      list={list}
    >
      <Table
        columns={['Folder the manager will use', 'Manager · TMDB id', "Why it's not here"]}
        rows={rows}
        empty="Every tracked title has a folder."
      />
    </Section>
  )
}

function UnmanagedSection({ list, arrFor, managers }) {
  const items = list?.items || []
  return (
    <Section
      title={`Not managed by ${managers}`}
      subtitle="Folders that were added some other way. The media server matched them by searching the name, which can pick the wrong title when the folder name has no year. Worth a glance."
      icon={<FolderOpenIcon className="h-6 w-6" />}
      list={list}
    >
      {items.length ? (
        <ul className="columns-1 gap-x-8 text-sm text-gray-700 sm:columns-2 lg:columns-3">
          {items.map((path) => {
            const paired = arrFor?.get(path)
            return (
              <li key={path} className="break-inside-avoid py-1">
                <FolderLink libraryRelativePath={path} />
                {paired ? (
                  <span className="ml-1 text-xs text-orange-700">
                    — {providerLabel(paired.row.source)} knows it as {splitPath(paired.row.libraryRelativePath).folder}
                    {paired.by === 'tmdbId' ? ' (same TMDB id)' : ''}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-gray-600">
          <CheckCircleIcon className="h-5 w-5 text-green-600" aria-hidden="true" />
          Every folder in the library is managed by {managers}.
        </p>
      )}
    </Section>
  )
}

function ProviderConflictsSection({ list }) {
  const items = list?.items || []
  if (!items.length) return null
  const rows = items.map((c, i) => (
    <tr key={`${c.libraryRelativePath}-${i}`}>
      <td className={cellClass}>{c.libraryRelativePath}</td>
      <td className={cellClass}>{c.kept ? `${providerLabel(c.kept.source)} · ${c.kept.tmdbId}` : '—'}</td>
      <td className={cellClass}>{c.dropped ? `${providerLabel(c.dropped.source)} · ${c.dropped.tmdbId}` : '—'}</td>
    </tr>
  ))
  return (
    <Section
      title="Managers disagree with each other"
      subtitle="Two managers claim the same folder with different TMDB ids. The media server used the first one; check the other."
      icon={<QuestionMarkCircleIcon className="h-6 w-6" />}
      list={{ ...list, __tone: 'warning' }}
    >
      <Table columns={['Folder', 'Used', 'Ignored']} rows={rows} empty="" />
    </Section>
  )
}

function ErrorsSection({ list }) {
  const items = list?.items || []
  if (!items.length) return null
  const rows = items.map((e, i) => (
    <tr key={`${e.libraryRelativePath}-${i}`}>
      <td className={cellClass}>{e.libraryRelativePath}</td>
      <td className={`${cellClass} text-red-700`}>{e.error}</td>
    </tr>
  ))
  return (
    <Section
      title="Could not check these folders"
      subtitle="The media server hit an error on these. Details are in its log."
      icon={<ExclamationTriangleIcon className="h-6 w-6" />}
      list={{ ...list, __tone: 'error' }}
    >
      <Table columns={['Folder', 'Error']} rows={rows} empty="" />
    </Section>
  )
}

function ManagersPanel({ status }) {
  const providers = status?.providers || []
  const events = (status?.recentEvents || []).slice(-10).reverse()
  return (
    <MaterialCard elevation="low">
      <MaterialCardHeader
        title="Connected managers"
        subtitle="The download managers the media server asks about titles. Radarr manages movies; Sonarr manages TV."
        icon={<LinkIcon className="h-6 w-6" />}
      />
      <MaterialCardContent>
        {providers.length ? (
          <ul className="space-y-2 text-sm text-gray-700">
            {providers.map((p) => {
              const failed = Boolean(p.lastFetch?.error)
              return (
                <li key={p.name} className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={failed ? 'error' : 'success'} variant="soft" size="small">
                    {failed ? 'Not answering' : 'Connected'}
                  </StatusBadge>
                  <span className="font-medium">{providerLabel(p.name)}</span>
                  {p.url ? <span className="text-gray-500">{p.url}</span> : null}
                  <span className="text-gray-500">· last asked {formatWhen(p.lastFetch?.at || p.lastFetch)}</span>
                  {failed ? (
                    <span className="text-red-700">· {p.lastFetch.error}</span>
                  ) : p.lastFetch?.claims != null ? (
                    <span className="text-gray-500">
                      · knows {p.lastFetch.claims} titles
                      {p.lastFetch.unidentified ? `, ${p.lastFetch.unidentified} without a TMDB id` : ''}
                    </span>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-gray-600">No manager is connected.</p>
        )}
        {status?.configErrors?.length ? (
          <ul className="mt-3 text-sm text-red-700">
            {status.configErrors.map((e, i) => (
              <li key={i}>{typeof e === 'string' ? e : `${e.provider || ''} ${e.error || JSON.stringify(e)}`}</li>
            ))}
          </ul>
        ) : null}
        {status?.unsourcedPinTreatment === 'auto' ? (
          <p className="mt-3 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">
            The media server is in its one-time catch-up mode (IDENTITY_UNSOURCED_PINS=auto): older pins with no record
            of who set them may be corrected by the managers this pass. Turn it off once the pass has run.
          </p>
        ) : null}
        {events.length ? (
          <div className="mt-4">
            <h4 className="text-sm font-semibold text-gray-900">Recent notifications from the managers</h4>
            <ul className="mt-1 space-y-0.5 text-sm text-gray-600">
              {events.map((e, i) => (
                <li key={i}>
                  {formatWhen(e.at)} · {providerLabel(e.provider)} · {e.kind}
                  {e.libraryRelativePath ? ` · ${splitPath(e.libraryRelativePath).folder}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </MaterialCardContent>
    </MaterialCard>
  )
}

function HowThisWorks({ managers }) {
  return (
    <MaterialCard elevation="low" variant="filled">
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2 px-6 py-4 text-sm font-medium text-gray-900">
          <InformationCircleIcon className="h-5 w-5 text-blue-600" aria-hidden="true" />
          How title matching works
          <span className="ml-auto text-xs font-normal text-gray-500 group-open:hidden">Show</span>
          <span className="ml-auto hidden text-xs font-normal text-gray-500 group-open:inline">Hide</span>
        </summary>
        <div className="space-y-3 border-t border-gray-200 px-6 py-4 text-sm text-gray-700">
          <p>
            Every movie or show in the library is a folder on disk. To show the right name, poster, cast and details,
            the media server has to know which entry on TMDB (The Movie Database) that folder is. That link is called a{' '}
            <strong>pin</strong>.
          </p>
          <p>
            {managers} are the download managers that put most of those folders there. They already know each title&apos;s
            exact TMDB entry, so the media server asks them and pins what they say. Folders they do not manage are
            matched by searching the folder name instead, which is right most of the time and wrong when two titles
            share a name.
          </p>
          <p>
            A pin set by a person always wins. The managers can correct a pin the media server guessed, but they will
            never change one you set by hand; instead it shows up here under &ldquo;Needs your decision&rdquo;.
          </p>
          <p>
            This page is read-only. To change a match, open the title from the Media section and use its TMDB config
            editor, or fix the title in {managers}.
          </p>
        </div>
      </details>
    </MaterialCard>
  )
}

function PageHeader({ badge, managers, action, children }) {
  return (
    <div className="space-y-6 mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-blue-600 rounded-xl shadow-md">
              <FingerPrintIcon className="w-8 h-8 text-white" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Title matching</h1>
              <p className="text-gray-600 mt-1">Whether each folder is linked to the right movie or show, as {managers} know it</p>
            </div>
          </div>
          {badge}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export default function IdentityReport() {
  const [running, setRunning] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [autoRefreshed, setAutoRefreshed] = useState(null)
  const autoRanFor = useRef(null)
  const report = useSWR(reportKey, fetcher, swrOptions)
  const status = useSWR(statusKey, fetcher, swrOptions)
  const managers = managerNames(status.data)

  // Re-render every 30 s so the report's age keeps counting while nothing
  // else changes.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  async function runNow({ auto = false } = {}) {
    setRunning(true)
    try {
      const res = await fetch(buildURL('/api/authenticated/admin/identity/reconcile'), { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || `Reconcile failed (${res.status})`)
      if (auto) {
        setAutoRefreshed(body?.at || new Date().toISOString())
      } else {
        toast.success(
          `Reconciled ${body?.totals?.claimed ?? 0} claims: ${body?.totals?.write ?? 0} written, ${body?.totals?.conflict ?? 0} conflicts`
        )
      }
      await Promise.all([report.mutate(body, { revalidate: false }), status.mutate()])
      setNow(Date.now())
    } catch (err) {
      if (auto) setAutoRefreshed(null)
      toast.error(err.message)
    } finally {
      setRunning(false)
    }
  }

  // A stale report is refreshed from the managers once per distinct report:
  // the ref pins the `at` we already acted on, so a reconcile that comes back
  // still-stale (the processor's clock, a failed run) cannot loop.
  const ageMs = reportAgeMs(report.data, now)
  const isStale =
    ageMs != null && ageMs > staleThresholdMs(report.data) && !report.data?.pending && report.data?.enabled !== false
  const processorRefreshes = selfRefreshing(report.data)
  useEffect(() => {
    if (!isStale || processorRefreshes || running || autoRanFor.current === report.data.at) return
    autoRanFor.current = report.data.at
    runNow({ auto: true })
    // runNow is stable for the lifetime of this component; listing it would
    // re-arm the effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStale, processorRefreshes, running, report.data?.at])

  const runButton = (
    <MaterialButton
      variant="outlined"
      color="primary"
      onClick={() => runNow()}
      disabled={running}
      startIcon={<ArrowPathIcon className={`h-5 w-5 ${running ? 'animate-spin' : ''}`} aria-hidden="true" />}
    >
      {running ? 'Checking…' : `Check with ${managers} now`}
    </MaterialButton>
  )

  const page = (badge, body, action = null, freshness = null) => (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <PageHeader badge={badge} managers={managers} action={action}>
          {freshness}
        </PageHeader>
        <div className="space-y-6">{body}</div>
      </div>
    </div>
  )

  if (report.isLoading && !report.data) {
    return page(
      null,
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  if (report.error) {
    const missing = isMissingEndpoint(report.error)
    return page(
      <StatusBadge status="error" variant="soft">
        {missing ? 'Update needed' : 'Not answering'}
      </StatusBadge>,
      <>
        <MaterialCard elevation="low" className="border-red-200">
          <MaterialCardContent>
            <div className="flex gap-3">
              <ExclamationTriangleIcon className="h-6 w-6 shrink-0 text-red-500" aria-hidden="true" />
              <div>
                <h3 className="text-sm font-semibold text-gray-900">
                  {missing ? 'The media server needs an update before this page can work' : 'The media server is not answering'}
                </h3>
                <p className="mt-1 text-sm text-gray-700">
                  {missing
                    ? 'Its current version predates the identity-provider release. Once a build that includes it is deployed, this page fills in on the next scan.'
                    : 'It may be starting up or mid-restart. This page checks again every 15 seconds and fills in as soon as it answers.'}
                </p>
                {!missing ? <p className="mt-1 text-xs text-gray-500">{report.error.message}</p> : null}
                <div className="mt-3">
                  <MaterialButton variant="text" color="error" size="small" onClick={() => report.mutate()}>
                    Try again
                  </MaterialButton>
                </div>
              </div>
            </div>
          </MaterialCardContent>
        </MaterialCard>
        <HowThisWorks managers={managers} />
      </>
    )
  }

  const data = report.data || {}

  if (data.enabled === false) {
    return page(
      <StatusBadge status="neutral" variant="soft">
        Not connected
      </StatusBadge>,
      <>
        <MaterialCard elevation="low">
          <MaterialCardContent>
            <p className="text-sm font-semibold text-gray-900">The media server isn&apos;t connected to Radarr or Sonarr yet.</p>
            <p className="mt-1 text-sm text-gray-700">
              Until it is, every title is matched by searching its folder name. To connect a manager, set{' '}
              <code>RADARR_URL</code> and <code>RADARR_API_KEY</code> (movies) or <code>SONARR_URL</code> and{' '}
              <code>SONARR_API_KEY</code> (TV) in the media server&apos;s environment and restart it.
            </p>
          </MaterialCardContent>
        </MaterialCard>
        <HowThisWorks managers={managers} />
        <ManagersPanel status={status.data} />
      </>
    )
  }

  if (data.pending) {
    return page(
      <StatusBadge status="info" variant="soft" pulse>
        Initializing
      </StatusBadge>,
      <>
        <MaterialCard elevation="low" className="border-blue-200" role="status" aria-live="polite">
          <MaterialCardContent>
            <div className="flex items-start gap-3">
              <Spinner className="mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-gray-900">Initializing</p>
                <p className="mt-1 text-sm text-gray-700">
                  The media server has just started and is cataloging the library. Its first check with {managers} runs
                  at the top of the next scan, usually within three minutes. This page checks every 10 seconds and
                  fills in on its own.
                </p>
                <p className="mt-3 text-xs text-gray-500">In a hurry? Run the check now:</p>
                <div className="mt-1">{runButton}</div>
              </div>
            </div>
          </MaterialCardContent>
        </MaterialCard>
        <HowThisWorks managers={managers} />
        <ManagersPanel status={status.data} />
      </>
    )
  }

  const totals = data.totals || {}
  const skipped = data.skipped
  const renamed = pairRenamed(data.providerOnly, data.unmanaged)
  const lostCount = renamed.diskFor.size
  const unidentifiedCount = totals.managedUnidentified ?? data.managedUnidentified?.total ?? 0
  const attention = (totals.conflict ?? 0) + lostCount + unidentifiedCount
  const headline =
    attention > 0 ? (
      <StatusBadge status="warning" variant="soft" icon={<ExclamationTriangleIcon />}>
        {attention} {attention === 1 ? 'item needs' : 'items need'} attention
      </StatusBadge>
    ) : (
      <StatusBadge status="success" variant="soft" icon={<CheckCircleIcon />}>
        All titles matched
      </StatusBadge>
    )

  const reasonText = (reason) =>
    reason === 'manual'
      ? 'run by hand'
      : reason === 'scan-tick'
        ? 'during a library scan'
        : reason === 'identity-tick'
          ? 'by the regular check'
          : /webhook$/.test(reason || '')
            ? `after ${providerLabel(String(reason).replace(/-webhook$/, ''))} sent a notification`
            : reason || 'scan'
  const uncovered = Object.entries(data.perType || {})
    .filter(([, t]) => t && t.covered === false)
    .map(([mediaType]) => (mediaType === 'tv' ? 'TV shows' : 'movies'))

  const freshness = (
    <>
      <p className="text-sm text-gray-600" data-testid="report-age">
        Last checked {formatWhen(data.checkedAt || data.at)}
        {ageMs != null ? <span className={isStale ? ' font-medium text-orange-700' : ''}> ({formatAge(ageMs)})</span> : null}
        {' · '}
        {reasonText(data.checkedReason || data.reason)}
        {data.unchanged && data.at ? ` · nothing has changed since ${formatWhen(data.at)}` : ''}
        {!data.unchanged && data.durationMs != null ? ` · took ${data.durationMs} ms` : ''}
        {skipped ? ` · skipped: ${skipped}` : ''}
      </p>

      {uncovered.length ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          {uncovered.join(' and ')} were not checked this pass because their manager did not answer. The last good
          result for them is kept; see the connected managers below.
        </div>
      ) : null}

      {isStale || autoRefreshed ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900"
        >
          {running ? (
            <span className="inline-flex items-center gap-2">
              <Spinner /> This report is {formatAge(ageMs)}, so it is being refreshed from {managers} now.
            </span>
          ) : autoRefreshed && !isStale ? (
            <>
              Refreshed from {managers} {formatWhen(autoRefreshed)} because the last check was older than expected.
              Anything changed in the managers since then is reflected below.
            </>
          ) : processorRefreshes ? (
            <>
              The media server last checked with {managers} {formatAge(ageMs)}, but it normally checks every{' '}
              {Math.round(staleThresholdMs(data) / 3 / 1000)} seconds. Its regular check may have stopped; a change made
              in the managers since then is not reflected yet. Use the button above to check now, and look at the
              media server&apos;s log if this persists.
            </>
          ) : (
            <>
              This report is {formatAge(ageMs)}. The media server rebuilds it at the start of each library scan, and a
              scan can run long. A change made in {managers} since then is not reflected yet. Use the button above to
              check now.
            </>
          )}
        </div>
      ) : null}

      {skipped ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          {managers} did not answer on this pass, so nothing was checked and nothing changed. See the connected managers
          below.
        </div>
      ) : null}
    </>
  )

  const tiles = (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      <MetricCard
        title="Need your decision"
        value={totals.conflict ?? 0}
        status={totals.conflict ? 'error' : 'success'}
        subtitle="Hand pin vs manager"
        icon={<ExclamationTriangleIcon className="h-5 w-5" />}
      />
      <MetricCard
        title="Corrected this pass"
        value={totals.write ?? 0}
        status={totals.write ? 'success' : 'neutral'}
        subtitle="Wrong matches fixed"
        icon={<WrenchScrewdriverIcon className="h-5 w-5" />}
      />
      <MetricCard
        title="Already correct"
        value={(totals.keep ?? 0) + (totals.stamp ?? 0)}
        status="success"
        subtitle="Agree with the managers"
        icon={<CheckCircleIcon className="h-5 w-5" />}
      />
      <MetricCard
        title="Expected, not here"
        value={(totals.providerOnly ?? 0) + (totals.nested ?? 0)}
        status={lostCount ? 'warning' : 'neutral'}
        subtitle={lostCount ? `${lostCount} lost or renamed` : 'Tracked, not downloaded yet'}
        icon={<FolderMinusIcon className="h-5 w-5" />}
      />
      <MetricCard
        title="Not managed"
        value={totals.unmanaged ?? 0}
        status="neutral"
        subtitle="Matched by name only"
        icon={<FolderOpenIcon className="h-5 w-5" />}
      />
      <MetricCard
        title="Managed titles"
        value={totals.claimed ?? 0}
        status="info"
        subtitle={`Known to ${managers}`}
        icon={<LinkIcon className="h-5 w-5" />}
      />
    </div>
  )

  return page(
    headline,
    <>
      {tiles}
      <HowThisWorks managers={managers} />
      <ConflictsSection list={data.conflicts} managers={managers} />
      <ManagedUnidentifiedSection list={data.managedUnidentified} managers={managers} />
      <ProviderOnlySection list={data.providerOnly} diskFor={renamed.diskFor} managers={managers} />
      <WrittenSection list={data.written} managers={managers} />
      <UnmanagedSection list={data.unmanaged} arrFor={renamed.arrFor} managers={managers} />
      <ProviderConflictsSection list={data.providerConflicts} />
      <ErrorsSection list={data.errors} />
      <ManagersPanel status={status.data} />
    </>,
    runButton,
    freshness
  )
}
