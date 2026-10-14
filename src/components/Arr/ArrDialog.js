'use client'

import { useEffect, useMemo, useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'
import { folderNameProblem } from '@src/lib/arr/folders'
import { addArrTitle, arrServiceName, fetchArrTitle, searchArrTitle, updateArrTitle } from './arrApi'
import EpisodePicker, { bySeasonOrder, seasonLabel } from './EpisodePicker'
import ReleaseStep from './ReleaseStep'

const REASON_TEXT = {
  timeout: 'it timed out',
  unauthorized: 'its API key was refused',
  refused: 'the connection was refused',
  network: 'a network error',
  bad_url: 'check its URL',
  http_error: 'it returned an error',
  invalid_response: 'an unexpected answer',
  not_found: 'not found',
  rejected: 'it refused the request',
}

const AVAILABILITY_OPTIONS = [
  { value: 'released', label: 'Released' },
  { value: 'inCinemas', label: 'In cinemas' },
  { value: 'announced', label: 'Announced' },
]

const inputClass =
  'block w-full rounded-md border-0 bg-gray-900 px-3 py-2 text-sm text-white ring-1 ring-inset ring-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const checkboxClass = 'h-4 w-4 rounded border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500'
const radioClass = 'h-4 w-4 border-gray-600 bg-gray-700 text-indigo-600 focus:ring-indigo-500'
const primaryButton =
  'rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryButton = 'rounded-md px-4 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white'

// The last quality profile picked, per service: a per-viewer convenience only.
const lastProfileKey = (service) => `arr.lastQualityProfile.${service}`

function readLastProfile(service) {
  try {
    const id = Number(window.localStorage.getItem(lastProfileKey(service)))
    return Number.isSafeInteger(id) && id > 0 ? id : null
  } catch {
    return null
  }
}

function rememberProfile(service, id) {
  try {
    window.localStorage.setItem(lastProfileKey(service), String(id))
  } catch {
    // Private mode or blocked storage: the default comes from the library next time.
  }
}

/** The admin's last pick, else the profile most of the library uses, else the first. */
function initialProfileId(options, service) {
  const ids = options.qualityProfiles.map((profile) => profile.id)
  const last = readLastProfile(service)
  if (last && ids.includes(last)) return last
  if (ids.includes(options.defaultQualityProfileId)) return options.defaultQualityProfileId
  return ids[0] ?? null
}

function formatDuration(seconds) {
  if (seconds < 90) return 'a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`
}

function formatFreeSpace(bytes) {
  if (typeof bytes !== 'number') return null
  const tb = bytes / 1024 ** 4
  return tb >= 1 ? `${tb.toFixed(1)} TB free` : `${Math.round(bytes / 1024 ** 3)} GB free`
}

function Field({ label, htmlFor, children }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-sm font-medium text-gray-200">
        {label}
      </label>
      {children}
    </div>
  )
}

function Note({ children, tone = 'info' }) {
  return (
    <p
      className={classNames(
        'rounded-md px-3 py-2 text-sm',
        tone === 'info' && 'bg-blue-500/10 text-blue-200',
        tone === 'warning' && 'bg-amber-500/10 text-amber-200'
      )}
    >
      {children}
    </p>
  )
}

function Problem({ children, onRetry }) {
  return (
    <div className="space-y-3 py-2">
      <p className="text-sm text-gray-200" role="alert">
        {children}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="rounded-md bg-gray-700 px-3 py-1.5 text-sm font-medium text-gray-100 hover:bg-gray-600">
          Try again
        </button>
      )}
    </div>
  )
}

function SeasonChecklist({ seasons, selected, onToggle }) {
  const ordered = [...seasons].sort((a, b) => bySeasonOrder(a.seasonNumber, b.seasonNumber))
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {ordered.map((season) => (
        <label
          key={season.seasonNumber}
          className="flex cursor-pointer items-center gap-2 rounded-md bg-gray-900/60 px-2 py-1.5 text-sm text-gray-100"
        >
          <input
            type="checkbox"
            checked={selected.has(season.seasonNumber)}
            onChange={() => onToggle(season.seasonNumber)}
            className={checkboxClass}
          />
          <span className="flex-1 truncate">{seasonLabel(season.seasonNumber)}</span>
          {season.episodeCount !== null && (
            <span className="text-xs tabular-nums text-gray-400" title="Episodes on disk / monitored episodes">
              {season.episodeFileCount ?? 0}/{season.episodeCount}
            </span>
          )}
        </label>
      ))}
    </div>
  )
}

function toggleIn(set, value) {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

/** Which episodes of a show: the whole show, chosen seasons, or chosen episodes. */
function ScopeChoice({ name, scopeType, onScopeType, seasons, selectedSeasons, onToggleSeason, episodesHint }) {
  const option = (value, label, hint) => (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="radio"
        name={name}
        value={value}
        checked={scopeType === value}
        onChange={() => onScopeType(value)}
        className={classNames(radioClass, 'mt-0.5')}
      />
      <span>
        <span className="font-medium text-gray-100">{label}</span>
        {hint && <span className="block text-xs text-gray-400">{hint}</span>}
      </span>
    </label>
  )
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium text-gray-200">Episodes</legend>
      {option('all', 'All episodes', 'Every season, and new ones as they air.')}
      {option('seasons', 'Choose seasons')}
      {scopeType === 'seasons' && (
        <div className="ml-6">
          {seasons.length > 0 ? (
            <SeasonChecklist seasons={seasons} selected={selectedSeasons} onToggle={onToggleSeason} />
          ) : (
            <p className="text-xs text-gray-400">Sonarr doesn’t list any seasons yet.</p>
          )}
        </div>
      )}
      {option('episodes', 'Choose episodes', episodesHint)}
    </fieldset>
  )
}

function AddForm({ data, item, onAdded, onCancel }) {
  const { service, candidate, options, catalog } = data
  const name = arrServiceName(item.mediaType)
  const [profileId, setProfileId] = useState(() => initialProfileId(options, service))
  const [rootFolderPath, setRootFolderPath] = useState(data.rootFolderPath ?? '')
  const [folder, setFolder] = useState(candidate.folder ?? '')
  const [availability, setAvailability] = useState('released')
  const [scopeType, setScopeType] = useState('all')
  const [seasons, setSeasons] = useState(() => new Set())
  const [after, setAfter] = useState('auto')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Empty is only allowed when this app can't predict the name: the service then picks it.
  const folderProblem = folder ? folderNameProblem(folder) : candidate.folder ? 'Enter a folder name.' : null
  const folderTaken =
    folder === candidate.folder && catalog.folderTakenBy
      ? `“${catalog.folderTakenBy.title}” already lives in this folder. Choose a different name, such as “${candidate.folder}${candidate.year ? ` (${candidate.year})` : ' (2)'}”.`
      : null
  const canSubmit =
    profileId !== null && !folderProblem && !folderTaken && (scopeType !== 'seasons' || seasons.size > 0) && !submitting
  // Episodes are picked before anything is searched for them.
  const searchNow = after === 'auto' && scopeType !== 'episodes'
  const freeSpace = formatFreeSpace(options.rootFolders.find((root) => root.path === rootFolderPath)?.freeSpaceBytes)

  const submit = async (event) => {
    event.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    const body = {
      qualityProfileId: profileId,
      rootFolderPath: rootFolderPath || null,
      folder: folder || null,
      search: searchNow,
    }
    if (service === 'radarr') body.minimumAvailability = availability
    else {
      body.scope =
        scopeType === 'seasons'
          ? { type: 'seasons', seasons: [...seasons].sort((a, b) => a - b) }
          : { type: scopeType }
    }
    try {
      const result = await addArrTitle(item, body)
      rememberProfile(service, profileId)
      onAdded(result, {
        after,
        search: searchNow,
        defaultSeason: scopeType === 'seasons' && seasons.size > 0 ? Math.min(...seasons) : undefined,
      })
    } catch (failure) {
      setError(failure.message)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {catalog.inLibrary && (
        <Note>
          Already in your library. Adding it hands its folder to {name}, which will manage the file from now on (and
          may upgrade it).
        </Note>
      )}
      {candidate.released === false && <Note>Not released yet. {name} will get it once it is.</Note>}

      <Field label="Quality profile" htmlFor="arr-profile">
        <select
          id="arr-profile"
          value={profileId ?? ''}
          onChange={(event) => setProfileId(Number(event.target.value))}
          className={inputClass}
        >
          {options.qualityProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
      </Field>

      {options.rootFolders.length > 1 && (
        <Field label="Root folder" htmlFor="arr-root">
          <select
            id="arr-root"
            value={rootFolderPath}
            onChange={(event) => setRootFolderPath(event.target.value)}
            className={inputClass}
          >
            {options.rootFolders.map((root) => (
              <option key={root.path} value={root.path} disabled={!root.accessible}>
                {root.path}
                {root.accessible ? '' : ' (unavailable)'}
              </option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Folder" htmlFor="arr-folder">
        <div className="flex items-center rounded-md bg-gray-900 ring-1 ring-inset ring-gray-600 focus-within:ring-2 focus-within:ring-indigo-500">
          <span className="max-w-[45%] truncate pl-3 text-sm text-gray-500" title={rootFolderPath}>
            {rootFolderPath}/
          </span>
          <input
            id="arr-folder"
            value={folder}
            onChange={(event) => setFolder(event.target.value)}
            placeholder={candidate.folder ? '' : `${name} picks the name`}
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(folderProblem || folderTaken)}
            aria-describedby="arr-folder-hint"
            className="min-w-0 flex-1 border-0 bg-transparent px-1 py-2 text-sm text-white focus:outline-none focus:ring-0"
          />
        </div>
        {(folderProblem || folderTaken) && <p className="mt-1 text-xs text-red-400">{folderProblem || folderTaken}</p>}
        <p id="arr-folder-hint" className="mt-1 text-xs text-gray-400">
          The folder name becomes the title’s permanent key, in links and on disk.
          {freeSpace ? ` ${freeSpace}.` : ''}
        </p>
      </Field>

      {service === 'radarr' ? (
        <Field label="Download once it’s" htmlFor="arr-availability">
          <select
            id="arr-availability"
            value={availability}
            onChange={(event) => setAvailability(event.target.value)}
            className={inputClass}
          >
            {AVAILABILITY_OPTIONS.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <ScopeChoice
          name="arr-add-scope"
          scopeType={scopeType}
          onScopeType={setScopeType}
          seasons={candidate.seasons}
          selectedSeasons={seasons}
          onToggleSeason={(seasonNumber) => setSeasons((previous) => toggleIn(previous, seasonNumber))}
          episodesHint="Sonarr adds the show with nothing monitored, then lists its episodes here to pick from."
        />
      )}

      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium text-gray-200">After adding</legend>
        {[
          {
            value: 'auto',
            label: 'Search automatically',
            hint:
              scopeType === 'episodes'
                ? 'Pick the episodes next; Sonarr then grabs the best release for each.'
                : `${name} grabs the best release its quality profile allows.`,
          },
          {
            value: 'manual',
            label: 'Pick a release myself',
            hint: `Search ${name}’s indexers now and choose from what they find.`,
          },
          { value: 'later', label: 'Don’t search yet', hint: `${name} waits for new releases to turn up.` },
        ].map((choice) => (
          <label key={choice.value} className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="radio"
              name="arr-after"
              value={choice.value}
              checked={after === choice.value}
              onChange={() => setAfter(choice.value)}
              className={classNames(radioClass, 'mt-0.5')}
            />
            <span>
              <span className="font-medium text-gray-100">{choice.label}</span>
              <span className="block text-xs text-gray-400">{choice.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {!catalog.inLibrary && (
        <p className="text-xs text-gray-400">Everyone with this on a watchlist will see it as Coming Soon.</p>
      )}

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className={secondaryButton}>
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit} className={primaryButton}>
          {submitting
            ? 'Adding…'
            : after === 'manual'
              ? 'Add, then pick a release'
              : after === 'auto' && scopeType === 'episodes'
                ? 'Add, then pick episodes'
                : `Add to ${name}`}
        </button>
      </div>
    </form>
  )
}

function entrySummary(entry, download, service) {
  if (download) {
    if (download.progress === null) return 'In the download queue.'
    const left = download.timeLeftSeconds ? `, about ${formatDuration(download.timeLeftSeconds)} left` : ''
    return download.progress >= 100 ? 'Downloaded; importing now.' : `Downloading: ${download.progress}%${left}.`
  }
  if (service === 'radarr') {
    if (entry.hasFile) return 'Downloaded.'
    if (!entry.monitored) return 'Not monitored: Radarr isn’t looking for it.'
    return entry.released === false ? 'Monitored, waiting for release.' : 'Monitored: Radarr is looking for a download.'
  }
  const onDisk = `${entry.episodeFileCount} of ${entry.episodeCount} monitored episodes on disk`
  return entry.monitored ? `${onDisk}.` : `Not monitored. ${onDisk}.`
}

const pickButton =
  'rounded-md px-4 py-2 text-sm font-medium text-indigo-200 ring-1 ring-inset ring-indigo-400/50 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:opacity-50'

function ManagePanel({ data, item, onChanged, onClose, onPickRelease }) {
  const { service, entry, options, download } = data
  const name = arrServiceName(item.mediaType)
  const [savedProfileId, setSavedProfileId] = useState(entry.qualityProfileId)
  const [profileId, setProfileId] = useState(entry.qualityProfileId)
  const [scopeType, setScopeType] = useState('all')
  const [seasons, setSeasons] = useState(() => new Set())
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const profileKnown = options.qualityProfiles.some((profile) => profile.id === savedProfileId)

  const saveProfile = async () => {
    setBusy('profile')
    setError(null)
    try {
      await updateArrTitle(item, { qualityProfileId: profileId })
      rememberProfile(service, profileId)
      setSavedProfileId(profileId)
      toast.success(`Quality profile saved. ${name} upgrades to it as releases allow.`)
      onChanged()
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(null)
    }
  }

  const search = async (scope) => {
    setBusy('search')
    setError(null)
    try {
      const result = await searchArrTitle(item, scope)
      toast.success(
        result.episodes === null
          ? `${name} is searching for it now.`
          : `${name} is searching for ${result.episodes} episode${result.episodes === 1 ? '' : 's'} now.`
      )
      onChanged()
      onClose()
    } catch (failure) {
      setError(failure.message)
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-1 text-sm">
        <p className="text-gray-100">{entrySummary(entry, download, service)}</p>
        {entry.path && (
          <p className="truncate text-xs text-gray-400" title={entry.path}>
            {entry.path}
          </p>
        )}
      </section>

      <Field label="Quality profile" htmlFor="arr-manage-profile">
        <div className="flex gap-2">
          <select
            id="arr-manage-profile"
            value={profileId}
            onChange={(event) => setProfileId(Number(event.target.value))}
            className={inputClass}
          >
            {!profileKnown && <option value={savedProfileId}>Unknown profile</option>}
            {options.qualityProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          {profileId !== savedProfileId && (
            <button type="button" onClick={saveProfile} disabled={busy !== null} className={primaryButton}>
              {busy === 'profile' ? 'Saving…' : 'Save'}
            </button>
          )}
        </div>
      </Field>

      {service === 'radarr' ? (
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>
            Close
          </button>
          <button type="button" onClick={() => onPickRelease()} disabled={busy !== null} className={pickButton}>
            Pick a release…
          </button>
          <button type="button" onClick={() => search({ type: 'all' })} disabled={busy !== null} className={primaryButton}>
            {busy === 'search' ? 'Starting search…' : entry.hasFile ? 'Search for an upgrade' : 'Search now'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <ScopeChoice
            name="arr-manage-scope"
            scopeType={scopeType}
            onScopeType={setScopeType}
            seasons={entry.seasons}
            selectedSeasons={seasons}
            onToggleSeason={(seasonNumber) => setSeasons((previous) => toggleIn(previous, seasonNumber))}
            episodesHint="Pick from the episodes Sonarr lists for this show."
          />
          {scopeType === 'episodes' ? (
            <EpisodePicker
              item={item}
              submitting={busy === 'search'}
              onSubmit={(episodeIds) => search({ type: 'episodes', episodeIds })}
            />
          ) : (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onClose} className={secondaryButton}>
                Close
              </button>
              <button
                type="button"
                onClick={() => onPickRelease(scopeType === 'seasons' && seasons.size > 0 ? Math.min(...seasons) : undefined)}
                disabled={busy !== null}
                className={pickButton}
              >
                Pick a release…
              </button>
              <button
                type="button"
                onClick={() =>
                  search(
                    scopeType === 'seasons'
                      ? { type: 'seasons', seasons: [...seasons].sort((a, b) => a - b) }
                      : { type: 'all' }
                  )
                }
                disabled={busy !== null || (scopeType === 'seasons' && seasons.size === 0)}
                className={primaryButton}
              >
                {busy === 'search' ? 'Starting search…' : 'Monitor and search'}
              </button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/**
 * Admin dialog for one watchlist title in Radarr (movies) or Sonarr (shows):
 * add it with a quality profile and folder, and for a show, which episodes;
 * or, when it is already there, change its profile and search for it now.
 * Mounted only while open (the card renders it on demand).
 */
export default function ArrDialog({ item, onClose, onChanged }) {
  // Primitive deps: the card's item object is replaced on every list refresh.
  const ref = useMemo(
    () => ({ mediaType: item.mediaType, tmdbId: item.tmdbId, title: item.title }),
    [item.mediaType, item.tmdbId, item.title]
  )
  const name = arrServiceName(ref.mediaType)
  const [title, setTitle] = useState({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // null, { kind: 'episodes' } after a show's episodes-only add, or
  // { kind: 'releases', defaultSeason } to pick a release by hand.
  const [step, setStep] = useState(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchArrTitle(ref).then(
      (data) => !cancelled && setTitle({ status: 'loaded', data }),
      (error) => !cancelled && setTitle({ status: 'error', message: error.message })
    )
    return () => {
      cancelled = true
    }
  }, [ref, attempt])

  const retry = () => {
    setTitle({ status: 'loading' })
    setAttempt((count) => count + 1)
  }

  const changed = () => onChanged?.()

  const handleAdded = (result, { after, search, defaultSeason }) => {
    // The one change an add makes outside Radarr/Sonarr.
    onChanged?.({ comingSoon: result.comingSoon === true })
    if (after === 'manual') {
      setStep({ kind: 'releases', defaultSeason })
      return
    }
    if (after === 'auto' && result.next === 'choose_episodes') {
      setStep({ kind: 'episodes' })
      return
    }
    toast.success(search ? `Added to ${name}. Searching now.` : `Added to ${name}.`)
    onClose()
  }

  const searchEpisodes = async (episodeIds) => {
    setSearching(true)
    try {
      const result = await searchArrTitle(ref, { type: 'episodes', episodeIds })
      toast.success(`Sonarr is searching for ${result.episodes} episode${result.episodes === 1 ? '' : 's'} now.`)
      changed()
      onClose()
    } catch (failure) {
      toast.error(failure.message)
      setSearching(false)
    }
  }

  const data = title.status === 'loaded' ? title.data : null
  const year = data?.state === 'absent' ? data.candidate.year : null

  let body
  if (step?.kind === 'releases') {
    body = <ReleaseStep item={ref} defaultSeason={step.defaultSeason} onGrabbed={changed} onDone={onClose} />
  } else if (step?.kind === 'episodes') {
    body = (
      <div className="space-y-3">
        <p className="text-sm text-gray-300">Added to Sonarr with nothing monitored. Pick the episodes to get.</p>
        <EpisodePicker item={ref} submitting={searching} onSubmit={searchEpisodes} />
      </div>
    )
  } else if (title.status === 'loading') {
    body = (
      <div className="space-y-3 py-2" role="status" aria-label={`Checking ${name}`}>
        <div className="h-4 w-2/3 animate-pulse rounded bg-gray-700" />
        <div className="h-9 animate-pulse rounded bg-gray-700" />
        <div className="h-9 animate-pulse rounded bg-gray-700" />
      </div>
    )
  } else if (title.status === 'error') {
    body = <Problem onRetry={retry}>{title.message}</Problem>
  } else if (data.state === 'not_configured') {
    body = (
      <Problem>
        {name} isn’t set up on this server. Set {data.missing.join(' and ')} in the app’s environment.
      </Problem>
    )
  } else if (data.state === 'unreachable') {
    body = (
      <Problem onRetry={retry}>
        Couldn’t reach {name}: {REASON_TEXT[data.reason] ?? data.reason}.
      </Problem>
    )
  } else if (data.state === 'not_found') {
    body = (
      <Problem>
        {ref.mediaType === 'tv'
          ? 'Sonarr can’t match this show by its TMDB id: its metadata may not link the two yet. Add it in Sonarr directly.'
          : 'Radarr can’t find this movie by its TMDB id.'}
      </Problem>
    )
  } else if (data.state === 'absent') {
    body = <AddForm data={data} item={ref} onAdded={handleAdded} onCancel={onClose} />
  } else {
    body = (
      <ManagePanel
        data={data}
        item={ref}
        onChanged={changed}
        onClose={onClose}
        onPickRelease={(defaultSeason) => setStep({ kind: 'releases', defaultSeason })}
      />
    )
  }
  const picking = step?.kind === 'releases'

  return (
    <Dialog open onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-black/60 transition-opacity duration-200 ease-out data-[closed]:opacity-0"
      />
      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-end justify-center sm:items-center sm:p-4">
          <DialogPanel
            transition
            className={classNames(
              'w-full rounded-t-2xl bg-gray-800 text-gray-100 shadow-2xl ring-1 ring-white/10 sm:rounded-xl',
              // Release titles are long: the picker gets the room.
              picking ? 'max-w-3xl' : 'max-w-lg',
              'pb-[max(0.5rem,env(safe-area-inset-bottom))]',
              'transition duration-200 ease-out data-[closed]:translate-y-6 data-[closed]:opacity-0'
            )}
          >
            <div className="flex items-start gap-3 border-b border-gray-700 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-base font-semibold text-white">{item.title}</DialogTitle>
                <p className="text-sm text-gray-400">
                  {picking ? `Pick a release · ${name}` : data?.state === 'present' ? `In ${name}` : `Send to ${name}`}
                  {year ? ` · ${year}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md p-1 text-gray-400 hover:bg-gray-700 hover:text-white"
                aria-label="Close"
              >
                <XMarkIcon className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="px-4 py-4 sm:px-5">{body}</div>
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  )
}
