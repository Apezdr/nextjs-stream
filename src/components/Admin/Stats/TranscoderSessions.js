'use client'

import useSWR from 'swr'
import { PlayIcon, PauseIcon } from '@heroicons/react/20/solid'
import { fetcher } from '@src/utils'
import { MaterialButton } from '../BaseComponents'
import GpuVendorMark from './GpuVendorMark'
import {
  gpuDisplayName,
  pipelineChips,
  groupSessions,
  titleLines,
  formatAge,
  speedTone,
  bufferLabel,
  vendorLabel,
  encoderLabel,
  shapeLabel,
} from './transcoderDisplay'

const URL = '/api/authenticated/admin/transcoder-sessions'
// A transcoder answer costs it a map walk and a few sysfs reads, and the app two indexed
// lookups, so 2 s is cheap; the GPU's busy and power figures then average over ~2 s.
const POLL_MS = 2000

/**
 * Reasons that will not fix themselves: polling stops until Retry, so a wrong key does not
 * become a refusal every five seconds in both services' logs.
 */
const CONFIG_REASONS = new Set([
  'unauthorized',
  'no-admin-key',
  'invalid-admin-key',
  'admin-disabled',
  'not-configured',
  'no-key',
  'no-admin-api',
  'unexpected-schema',
])

function halted(data) {
  const list = data?.transcoders
  return Array.isArray(list) && list.length > 0 && list.every((t) => !t.ok && CONFIG_REASONS.has(t.reason))
}

function hostOf(url) {
  try {
    return new globalThis.URL(url).host
  } catch {
    return url ?? ''
  }
}

const TONE_TEXT = {
  good: 'text-emerald-700',
  warn: 'text-amber-700',
  bad: 'text-red-700',
  muted: 'text-gray-400',
}

function StatusPill({ t }) {
  if (t.ok) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
        Connected · {t.ms} ms
      </span>
    )
  }
  const config = CONFIG_REASONS.has(t.reason)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium border ${
        config ? 'bg-red-50 border-red-200 text-red-800' : 'bg-amber-50 border-amber-200 text-amber-800'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config ? 'bg-red-500' : 'bg-amber-500'}`} aria-hidden="true" />
      {config ? 'Needs setup' : 'Unreachable'}
    </span>
  )
}

function Meter({ percent, tone = 'bg-indigo-500' }) {
  const p = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-200 overflow-hidden" aria-hidden="true">
      <div className={`h-full rounded-full ${tone} transition-all duration-500`} style={{ width: `${p}%` }} />
    </div>
  )
}

/** One segment per encoder slot, so "3 of 4" reads at a glance. */
function SlotMeter({ used, total }) {
  if (!total) return null
  const full = used >= total
  return (
    <div className="flex gap-1" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2.5 flex-1 rounded-sm ${i < used ? (full ? 'bg-red-500' : 'bg-indigo-500') : 'bg-gray-200'}`}
        />
      ))}
    </div>
  )
}

function Fact({ label, value, alert }) {
  const quiet = value === 0 || value === '0'
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <dt className="text-gray-500 truncate">{label}</dt>
      <dd className={`font-medium tabular-nums ${alert && !quiet ? 'text-amber-700' : quiet ? 'text-gray-400' : 'text-gray-900'}`}>
        {value}
      </dd>
    </div>
  )
}

function Panel({ title, aside, children }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 space-y-3 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{title}</h4>
        {aside && <span className="text-xs text-gray-400">{aside}</span>}
      </div>
      {children}
    </div>
  )
}

function EncodingPanel({ load, capacity }) {
  if (!load) return null
  const videoCap = (capacity?.cpu_encoders ?? 0) + (capacity?.nvenc_encoders ?? 0)
  return (
    <Panel title="Encoding">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-gray-700">Video encoders</span>
          <span className="font-semibold tabular-nums text-gray-900">
            {load.active_encoders}
            {videoCap ? <span className="font-normal text-gray-500"> of {videoCap}</span> : null}
          </span>
        </div>
        <SlotMeter used={load.active_encoders} total={videoCap} />
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        <Fact label="Waiting for a slot" value={load.queued} alert />
        <Fact label="Cold starts waiting" value={load.cold_start_waiting} alert />
        <Fact label="4K on the GPU" value={load.gpu_large_active} />
        <Fact label="≤1080p on the GPU" value={load.gpu_small_active} />
        <Fact label="Copy sessions" value={load.direct_sessions} />
        <Fact
          label="Audio encoders"
          value={capacity?.audio_encoders ? `${load.audio_encoders} of ${capacity.audio_encoders}` : load.audio_encoders}
        />
      </dl>
    </Panel>
  )
}

function GpuMeterRow({ label, value, percent, tone }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-gray-700">{label}</span>
        <span className="font-semibold tabular-nums text-gray-900">{value}</span>
      </div>
      <Meter percent={percent} tone={tone} />
    </div>
  )
}

function GpuPanel({ gpu }) {
  return (
    <Panel title="GPU" aside={gpu.window_ms ? `last ${(gpu.window_ms / 1000).toFixed(1)} s` : 'measuring…'}>
      <GpuMeterRow
        label="Busy"
        value={gpu.busy_percent == null ? '—' : `${gpu.busy_percent.toFixed(0)}%`}
        percent={gpu.busy_percent}
        tone={gpu.busy_percent >= 90 ? 'bg-red-500' : 'bg-indigo-500'}
      />
      <GpuMeterRow
        label="Clock"
        value={
          gpu.freq_mhz == null ? '—' : (
            <>
              {gpu.freq_mhz}
              {gpu.max_freq_mhz ? <span className="font-normal text-gray-500"> / {gpu.max_freq_mhz}</span> : null} MHz
            </>
          )
        }
        percent={gpu.max_freq_mhz ? (100 * (gpu.freq_mhz ?? 0)) / gpu.max_freq_mhz : 0}
        tone="bg-sky-500"
      />
      <GpuMeterRow
        label="Power"
        value={
          gpu.power_w == null ? '—' : (
            <>
              {gpu.power_w.toFixed(0)}
              {gpu.power_max_w ? <span className="font-normal text-gray-500"> / {gpu.power_max_w.toFixed(0)}</span> : null} W
            </>
          )
        }
        percent={gpu.power_max_w && gpu.power_w != null ? (100 * gpu.power_w) / gpu.power_max_w : 0}
        tone="bg-amber-500"
      />
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 pt-1">
        <Fact label="Temperature" value={gpu.temp_c == null ? '—' : `${gpu.temp_c.toFixed(0)} °C`} />
        <Fact label="Fan" value={gpu.fan_rpm == null ? '—' : `${gpu.fan_rpm} RPM`} />
      </dl>
    </Panel>
  )
}

function Viewers({ viewers }) {
  if (!viewers.length) return <span className="text-gray-400">no one watching</span>
  return (
    <span className="flex flex-wrap gap-1">
      {viewers.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-800 px-2 py-0.5 text-xs">
          {v.state === 'paused' ? (
            <PauseIcon className="w-3 h-3 text-indigo-400" aria-hidden="true" />
          ) : (
            <PlayIcon className="w-3 h-3 text-indigo-500" aria-hidden="true" />
          )}
          {v.name}
          <span className="sr-only">{v.state === 'paused' ? ' (paused)' : ' (playing)'}</span>
        </span>
      ))}
    </span>
  )
}

function PlayheadLine({ p }) {
  const buffer = bufferLabel(p)
  const work =
    p.kind === 'direct' ? 'Copy (original stream)' : `Transcode · ${encoderLabel(p.encoder)} · ${p.outputs} rungs`
  const range = shapeLabel(p.shape)
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-xs text-gray-600">
      <span>{work}</span>
      {p.kind === 'video' && p.source_width ? (
        <span className="text-gray-400">
          from {p.source_width}×{p.source_height}
          {range ? ` ${range}` : ''}
        </span>
      ) : null}
      <span className={`font-medium tabular-nums ${TONE_TEXT[speedTone(p.speed)]}`}>
        {p.speed == null ? p.state : `${p.speed.toFixed(2)}× realtime`}
      </span>
      <span className={`tabular-nums ${TONE_TEXT[buffer.tone]}`}>{buffer.text}</span>
      <span className="text-gray-400">
        {p.reason} · {formatAge(p.age_ms)}
      </span>
    </div>
  )
}

function SessionGroup({ g }) {
  const { title, subtitle } = titleLines(g.lead)
  const audio = [...new Set(g.audio.map((a) => encoderLabel(a.encoder)))].join(', ')
  return (
    <li className="py-3 space-y-1.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate" title={g.lead.file ?? undefined}>
            {title}
          </div>
          {subtitle && <div className="text-xs text-gray-500 truncate">{subtitle}</div>}
        </div>
        <div className="text-xs">
          <Viewers viewers={g.viewers} />
        </div>
      </div>
      {g.playheads.map((p) => (
        <PlayheadLine key={p.id} p={p} />
      ))}
      {g.audio.length > 0 && (
        <div className="text-xs text-gray-400">
          Audio · {audio} · {g.audio.length === 1 ? '1 rendition' : `${g.audio.length} renditions`}
        </div>
      )}
    </li>
  )
}

function NowPlaying({ sessions }) {
  const groups = groupSessions(sessions)
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Now playing{groups.length ? ` · ${groups.length}` : ''}
      </h4>
      {groups.length === 0 ? (
        <p className="text-sm text-gray-500 py-3">Idle: nothing is playing through this transcoder.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {groups.map((g) => (
            <SessionGroup key={g.key} g={g} />
          ))}
        </ul>
      )}
    </div>
  )
}

export function TranscoderPanel({ t }) {
  const gpu = t.ok ? t.gpu?.[0] ?? null : null
  const heading = gpu ? gpuDisplayName(gpu) : 'Transcoder'
  const chips = t.ok ? pipelineChips(t.hardware) : []
  return (
    <section className="space-y-4" aria-label={`Transcoder for ${t.serverLabel}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <GpuVendorMark vendor={gpu?.vendor} />
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900 truncate" title={gpu?.name ?? undefined}>
              {heading}
            </h3>
            <p className="text-xs text-gray-500 truncate">
              {t.serverLabel} · {hostOf(t.endpoint)}
              {t.internal ? ' (internal)' : ''}
              {t.ok && t.version ? ` · v${t.version}` : ''}
            </p>
          </div>
        </div>
        <StatusPill t={t} />
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <span key={c.label} className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600">
              <span className="text-gray-400">{c.label}</span>
              <span className="font-medium text-gray-800">{c.value}</span>
            </span>
          ))}
        </div>
      )}

      {t.ok ? (
        <>
          <div className={`grid grid-cols-1 gap-4 ${gpu ? 'lg:grid-cols-2' : ''}`}>
            <EncodingPanel load={t.load} capacity={t.capacity} />
            {gpu && <GpuPanel gpu={gpu} />}
          </div>
          {t.gpu?.length > 1 && (
            <p className="text-xs text-gray-500">
              Also on this host: {t.gpu.slice(1).map((g) => `${gpuDisplayName(g)} (${vendorLabel(g.vendor)})`).join(', ')}
            </p>
          )}
          <NowPlaying sessions={t.sessions} />
        </>
      ) : (
        <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-words">
          {t.detail}
        </p>
      )}
    </section>
  )
}

export default function TranscoderSessions() {
  const { data, error, mutate, isValidating } = useSWR(URL, fetcher, {
    // SWR does not poll a hidden tab, so a backgrounded dashboard costs nothing.
    refreshInterval: (latest) => (halted(latest) ? 0 : POLL_MS),
  })

  if (error) {
    return <p className="p-4 text-sm text-red-700">Could not load transcoder status: {error.message}</p>
  }
  if (!data) {
    return (
      <div className="p-4 space-y-3 animate-pulse" aria-hidden="true">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gray-200" />
          <div className="h-4 bg-gray-200 rounded w-48" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-36 bg-gray-100 rounded-xl" />
          <div className="h-36 bg-gray-100 rounded-xl" />
        </div>
      </div>
    )
  }
  const list = data.transcoders ?? []
  return (
    <div className="p-4 sm:p-6 space-y-8">
      {halted(data) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <p className="text-sm text-red-800">Paused: fix the configuration below, then retry.</p>
          <MaterialButton size="small" variant="outlined" onClick={() => mutate()} disabled={isValidating}>
            {isValidating ? 'Checking…' : 'Retry'}
          </MaterialButton>
        </div>
      )}
      {list.length === 0 ? (
        <p className="text-sm text-gray-500">No file servers are configured.</p>
      ) : (
        list.map((t) => <TranscoderPanel key={`${t.serverId} ${t.endpoint}`} t={t} />)
      )}
    </div>
  )
}
