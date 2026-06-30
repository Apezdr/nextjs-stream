'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftIcon, PlusIcon } from '@heroicons/react/24/outline'
import {
  createTVShowAction,
  saveTVShowAction,
  saveSeasonAction,
} from '@src/utils/admin/flatMediaActions'
import LockableField from './LockableField'
import ImagePreview from './ImagePreview'
import DeleteMediaButton from './DeleteMediaButton'
import TmdbConfigButton from './TmdbConfigButton'
import RawRecordButton from './RawRecordButton'
import SeasonEditor from './SeasonEditor'

const SCALAR_KEYS = ['title', 'originalTitle', 'posterURL', 'posterBlurhash', 'backdrop', 'backdropBlurhash', 'logo']

function initForm(record) {
  const f = {}
  for (const k of SCALAR_KEYS) f[k] = record?.[k] ?? ''
  return f
}

/** Inline "add season" control. */
function AddSeason({ showId, suggested }) {
  const [state, save, isSaving] = useActionState(saveSeasonAction, { status: 'idle' })
  const [num, setNum] = useState(String(suggested))
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save({ showId, seasonNumber: num })
      }}
      className="flex items-center gap-2"
    >
      <input
        type="number"
        value={num}
        onChange={(e) => setNum(e.target.value)}
        className="w-24 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder:text-gray-400"
        placeholder="Season #"
      />
      <button
        type="submit"
        disabled={isSaving}
        className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        <PlusIcon className="h-4 w-4" /> {isSaving ? 'Adding…' : 'Add season'}
      </button>
      {state.status === 'error' && <span className="text-sm text-red-600">{state.message}</span>}
    </form>
  )
}

/**
 * TV show editor — create (manual) or edit a FlatTVShows document, plus deep
 * editing of its seasons and episodes (when the show already exists).
 */
export default function TVShowEditor({ record = null, isNew = false, initialSeason = null, initialEpisode = null }) {
  const router = useRouter()
  const action = isNew ? createTVShowAction : saveTVShowAction
  const [state, save, isSaving] = useActionState(action, { status: 'idle' })

  const [form, setForm] = useState(() => initForm(record))
  const [tmdbId, setTmdbId] = useState(() => record?.metadata?.id ?? '')
  const [overview, setOverview] = useState(() => record?.metadata?.overview ?? '')
  const [locks, setLocks] = useState(() => ({ ...(record?.lockedFields ?? {}) }))

  useEffect(() => {
    if (state.status === 'success' && isNew && state.id) {
      router.replace(`/admin/media/tv/${state.id}`)
    }
  }, [state, isNew, router])

  const setField = (key) => (v) => setForm((p) => ({ ...p, [key]: v }))
  const isLocked = (key) => locks[key] === true
  const toggleLock = (key) =>
    setLocks((p) => {
      const next = { ...p }
      if (next[key] === true) delete next[key]
      else next[key] = true
      return next
    })

  const seasons = useMemo(() => record?.seasons ?? [], [record])
  const nextSeasonNumber = seasons.length
    ? Math.max(...seasons.map((s) => s.seasonNumber || 0)) + 1
    : 1

  const payload = useMemo(() => {
    const metadata = {}
    if (String(tmdbId).trim() !== '') {
      const n = Number(tmdbId)
      metadata.id = Number.isNaN(n) ? String(tmdbId).trim() : n
    }
    if (overview.trim() !== '') metadata.overview = overview.trim()
    return {
      ...(isNew ? {} : { id: record?._id }),
      ...form,
      ...(Object.keys(metadata).length ? { metadata } : {}),
      lockedFields: locks,
    }
  }, [form, tmdbId, overview, locks, isNew, record])

  const field = (key, label, opts = {}) => (
    <LockableField
      id={key}
      label={label}
      value={form[key]}
      onChange={setField(key)}
      locked={isLocked(key)}
      onToggleLock={() => toggleLock(key)}
      {...opts}
    />
  )

  return (
    <div className="w-full max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/admin/media/tv" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeftIcon className="h-4 w-4" /> TV Shows
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            {isNew ? 'Add TV Show' : form.title || 'Edit TV Show'}
          </h1>
        </div>
        {!isNew && record?._id && (
          <div className="flex items-center gap-3">
            <RawRecordButton record={record} title="TV show record" />
            {record?.originalTitle && (
              <TmdbConfigButton
                type="tv"
                originalTitle={record.originalTitle}
                recordTmdbId={record?.metadata?.id}
                title={record?.title}
                currentImages={{
                  poster: record?.metadata?.poster_path,
                  backdrop: record?.metadata?.backdrop_path,
                  logo: record?.metadata?.logo_path,
                }}
              />
            )}
            <DeleteMediaButton type="tv" id={record._id} label={form.title} redirectTo="/admin/media/tv" variant="button" />
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          save(payload)
        }}
        className="space-y-8"
      >
        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Identity</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('title', 'Title (display)')}
            {field('originalTitle', 'Original Title (filesystem key)', {
              helpText: 'Renaming the title cascades to all seasons/episodes.',
            })}
            <LockableField
              id="tmdb_id"
              label="TMDB ID"
              value={tmdbId}
              onChange={setTmdbId}
              locked={isLocked('metadata')}
              onToggleLock={() => toggleLock('metadata')}
              helpText="Locking applies to all metadata."
            />
            <LockableField id="overview" label="Overview" value={overview} onChange={setOverview} locked={isLocked('metadata')} onToggleLock={() => toggleLock('metadata')} textarea />
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Artwork</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="space-y-4">
              {field('posterURL', 'Poster URL')}
              {field('posterBlurhash', 'Poster Blurhash URL')}
              <ImagePreview url={form.posterURL} alt="Poster preview" className="h-48" />
            </div>
            <div className="space-y-4">
              {field('logo', 'Logo URL')}
              {field('backdrop', 'Backdrop URL')}
              {field('backdropBlurhash', 'Backdrop Blurhash URL')}
              <ImagePreview url={form.backdrop} alt="Backdrop preview" className="h-32 w-full" />
            </div>
          </div>
        </section>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? 'Saving…' : isNew ? 'Create Show' : 'Save Changes'}
          </button>
          {state.status === 'error' && <span className="text-sm text-red-600">{state.message}</span>}
          {state.status === 'success' && !isNew && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </form>

      {!isNew && record?._id && (
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Seasons &amp; Episodes</h2>
            <AddSeason key={`add-season-${seasons.length}`} showId={record._id} suggested={nextSeasonNumber} />
          </div>
          <div className="space-y-3">
            {seasons.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center text-sm text-gray-500">
                No seasons yet. Add one above.
              </p>
            ) : (
              seasons.map((season) => (
                <SeasonEditor
                  key={season._id || season.seasonNumber}
                  showId={record._id}
                  season={season}
                  defaultOpen={initialSeason != null && season.seasonNumber === initialSeason}
                  initialEpisode={initialSeason != null && season.seasonNumber === initialSeason ? initialEpisode : null}
                />
              ))
            )}
          </div>
        </section>
      )}
    </div>
  )
}
