'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { createMovieAction, saveMovieAction } from '@src/utils/admin/flatMediaActions'
import LockableField from './LockableField'
import ImagePreview from './ImagePreview'
import CaptionsEditor from './CaptionsEditor'
import DeleteMediaButton from './DeleteMediaButton'
import TmdbConfigButton from './TmdbConfigButton'
import RawRecordButton from './RawRecordButton'

const SCALAR_KEYS = [
  'title', 'originalTitle', 'videoURL', 'posterURL', 'posterBlurhash',
  'backdrop', 'backdropBlurhash', 'logo', 'chapterURL', 'hdr', 'duration',
]

function initForm(record) {
  const f = {}
  for (const k of SCALAR_KEYS) f[k] = record?.[k] ?? ''
  if (f.duration !== '' && f.duration != null) f.duration = String(f.duration)
  return f
}

/**
 * Movie editor — create (manual entry) or edit a FlatMovies document.
 * Per-field lock toggles persist into `lockedFields`; manual creates are
 * flagged `manualEntry` server-side so they survive sync cleanup.
 */
export default function MovieEditor({ record = null, isNew = false, ownership = null }) {
  const router = useRouter()
  const action = isNew ? createMovieAction : saveMovieAction
  const [state, save, isSaving] = useActionState(action, { status: 'idle' })

  const [form, setForm] = useState(() => initForm(record))
  const [tmdbId, setTmdbId] = useState(() => record?.metadata?.id ?? '')
  const [overview, setOverview] = useState(() => record?.metadata?.overview ?? '')
  const [captionURLs, setCaptionURLs] = useState(() => record?.captionURLs ?? {})
  const [locks, setLocks] = useState(() => ({ ...(record?.lockedFields ?? {}) }))

  // After a successful create, move to the persistent editor for the new id.
  useEffect(() => {
    if (state.status === 'success' && isNew && state.id) {
      router.replace(`/admin/media/movies/${state.id}`)
    }
  }, [state, isNew, router])

  const setField = (key) => (v) => setForm((prev) => ({ ...prev, [key]: v }))
  const isLocked = (key) => locks[key] === true
  const toggleLock = (key) =>
    setLocks((prev) => {
      const next = { ...prev }
      if (next[key] === true) delete next[key]
      else next[key] = true
      return next
    })

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
      captionURLs,
      ...(Object.keys(metadata).length ? { metadata } : {}),
      lockedFields: locks,
    }
  }, [form, tmdbId, overview, captionURLs, locks, isNew, record])

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
          <Link href="/admin/media/movies" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeftIcon className="h-4 w-4" /> Movies
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">
            {isNew ? 'Add Movie' : form.title || 'Edit Movie'}
          </h1>
        </div>
        {!isNew && record?._id && (
          <div className="flex items-center gap-3">
            <RawRecordButton record={record} title="Movie record" />
            {record?.originalTitle && (
              <TmdbConfigButton
                type="movie"
                originalTitle={record.originalTitle}
                recordTmdbId={record?.metadata?.id}
                title={record?.title}
                ownership={ownership}
                currentImages={{
                  poster: record?.metadata?.poster_path,
                  backdrop: record?.metadata?.backdrop_path,
                  logo: record?.metadata?.logo_path,
                }}
              />
            )}
            <DeleteMediaButton type="movie" id={record._id} label={form.title} redirectTo="/admin/media/movies" variant="button" />
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
              helpText: 'Used for sync/filesystem lookups. Defaults to Title on create.',
            })}
            {field('videoURL', 'Video URL')}
            <LockableField
              id="tmdb_id"
              label="TMDB ID"
              value={tmdbId}
              onChange={setTmdbId}
              locked={isLocked('metadata')}
              onToggleLock={() => toggleLock('metadata')}
              helpText="Locking applies to all metadata."
            />
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

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-gray-500">Details</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('chapterURL', 'Chapter URL')}
            {field('hdr', 'HDR', { placeholder: 'e.g. HDR10, Dolby Vision' })}
            {field('duration', 'Duration (ms)', { type: 'number' })}
            <LockableField
              id="overview"
              label="Overview"
              value={overview}
              onChange={setOverview}
              locked={isLocked('metadata')}
              onToggleLock={() => toggleLock('metadata')}
              textarea
            />
          </div>
        </section>

        <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <CaptionsEditor captionURLs={captionURLs} onChange={setCaptionURLs} />
        </section>

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
          >
            {isSaving ? 'Saving…' : isNew ? 'Create Movie' : 'Save Changes'}
          </button>
          {state.status === 'error' && <span className="text-sm text-red-600">{state.message}</span>}
          {state.status === 'success' && !isNew && <span className="text-sm text-green-600">Saved.</span>}
        </div>
      </form>
    </div>
  )
}
