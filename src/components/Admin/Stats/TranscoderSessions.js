'use client'

import { useReducer } from 'react'
import useSWR from 'swr'
import { PlayIcon, PauseIcon } from '@heroicons/react/20/solid'
import { fetcher } from '@src/utils'
import { MaterialButton } from '../BaseComponents'
import GpuVendorMark from './GpuVendorMark'
import TelemetrySparkline from './TelemetrySparkline'
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
  positionLabel,
  engineLabel,
  formatBytes,
  problemLabel,
  rungLabel,
  appendHistory,
  formatAgo,
} from './transcoderDisplay'

const URL = '/api/authenticated/admin/transcoder-sessions'
// A transcoder answer costs it a map walk, a few sysfs reads and a /proc fdinfo scan, and the app
// two indexed lookups, so 2 s is cheap; the GPU figures then average over ~2 s.
const POLL_MS = 2000
/** Problems older than this are history; the transcoder keeps the last 50 regardless. */
const PROBLEM_WINDOW_MS = 24 * 3600 * 1000

/**
 * Reasons that will not fix themselves: polling stops until Retry, so a wrong key does not
 * become a refusal every two seconds in both services' logs.
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

function Fact({ label, value, alert, hint }) {
  const quiet = value === 0 || value === '0'
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm" title={hint}>
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

function Trend({ values, maxValue, label, tone }) {
  const points = (values ?? []).filter(Number.isFinite)
  if (points.length < 2) return null
  const secs = Math.round((points.length * POLL_MS) / 1000)
  return (
    <TelemetrySparkline
      values={points}
      maxValue={maxValue}
      label={label}
      className={tone}
      caption={secs < 90 ? `Last ${secs} seconds` : `Last ${Math.round(secs / 60)} minutes`}
    />
  )
}

function EncodingPanel({ load, capacity, history }) {
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
      <Trend
        values={history?.map((h) => h.encoders)}
        maxValue={videoCap || undefined}
        label="Video encoders in use over the last minutes"
        tone="text-indigo-500"
      />
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

function MeterRow({ label, value, percent, tone, hint }) {
  return (
    <div className="space-y-1" title={hint}>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-gray-700">{label}</span>
        <span className="font-semibold tabular-nums text-gray-900">{value}</span>
      </div>
      <Meter percent={percent} tone={tone} />
    </div>
  )
}

function loadTone(p) {
  return p >= 90 ? 'bg-red-500' : p >= 70 ? 'bg-amber-500' : 'bg-indigo-500'
}

function GpuPanel({ gpu, history }) {
  const engines = gpu.engines ?? []
  const awakeHint =
    gpu.busy_kind === 'awake'
      ? 'How much of the window the GPU was out of its power-saving state. Any steady work keeps it near 100 %, so it is not load: the engine bars are.'
      : undefined
  return (
    <Panel title="GPU" aside={gpu.window_ms ? `last ${(gpu.window_ms / 1000).toFixed(1)} s` : 'measuring…'}>
      {engines.length > 0 ? (
        engines.map((e) => (
          <MeterRow
            key={e.name}
            label={
              <>
                {engineLabel(e.name, gpu.vendor)}
                {e.capacity > 1 ? <span className="text-gray-400"> · {e.capacity} engines</span> : null}
              </>
            }
            value={e.busy_percent == null ? '—' : `${e.busy_percent.toFixed(0)}%`}
            percent={e.busy_percent}
            tone={loadTone(e.busy_percent ?? 0)}
          />
        ))
      ) : (
        <p className="text-sm text-gray-500">No encode is using the GPU right now.</p>
      )}
      <Trend
        values={history?.map((h) => h.video)}
        maxValue={100}
        label="Video engine load over the last minutes"
        tone="text-indigo-500"
      />
      <MeterRow
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
      <MeterRow
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
        {gpu.memory && (
          <Fact
            label="Encoder memory"
            value={gpu.memory.clients ? `${formatBytes(gpu.memory.vram_bytes)} VRAM` : 'none'}
            hint={
              gpu.memory.clients
                ? `${gpu.memory.clients} process${gpu.memory.clients === 1 ? '' : 'es'} on the GPU; ${formatBytes(gpu.memory.system_bytes)} more in system memory`
                : undefined
            }
          />
        )}
        {gpu.busy_percent != null && (
          <Fact
            label={gpu.busy_kind === 'awake' ? 'Awake' : 'Busy'}
            value={`${gpu.busy_percent.toFixed(0)}%`}
            hint={awakeHint}
          />
        )}
        <Fact label="Temperature" value={gpu.temp_c == null ? '—' : `${gpu.temp_c.toFixed(0)} °C`} />
        <Fact label="Fan" value={gpu.fan_rpm == null ? '—' : `${gpu.fan_rpm} RPM`} />
      </dl>
    </Panel>
  )
}

function Viewers({ viewers }) {
  if (!viewers.length) return <span className="text-gray-400">no one watching</span>
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {viewers.map((v, i) => (
        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 text-indigo-800 px-2 py-0.5 text-xs">
          {v.state === 'paused' ? (
            <PauseIcon className="w-3 h-3 text-indigo-400" aria-hidden="true" />
          ) : (
            <PlayIcon className="w-3 h-3 text-indigo-500" aria-hidden="true" />
          )}
          {v.name}
          {v.device ? <span className="text-indigo-400">· {v.device}</span> : null}
          <span className="sr-only">{v.state === 'paused' ? ' (paused)' : ' (playing)'}</span>
        </span>
      ))}
    </span>
  )
}

/** Where the viewer is in the title, as a thin bar with the clock. */
function Position({ viewer, durationSec }) {
  const pos = positionLabel(viewer?.positionSec, durationSec)
  if (!pos) return null
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500">
      {pos.percent != null && (
        <div className="h-1 w-24 sm:w-40 rounded-full bg-gray-200 overflow-hidden" aria-hidden="true">
          <div className="h-full bg-indigo-400" style={{ width: `${pos.percent}%` }} />
        </div>
      )}
      <span className="tabular-nums">{pos.text}</span>
    </div>
  )
}

const ROLE_BADGE = {
  watching: 'bg-indigo-100 text-indigo-800',
  current: 'bg-gray-100 text-gray-700',
  parked: 'bg-gray-100 text-gray-500',
}
const ROLE_TEXT = { watching: 'Watching', current: 'Current', parked: 'Parked' }

function PlayheadLine({ p, single }) {
  const buffer = bufferLabel(p)
  const parked = p.role === 'parked'
  const work =
    p.kind === 'direct' ? 'Copy (original stream)' : `Transcode · ${encoderLabel(p.encoder)} · ${p.outputs} rungs`
  const range = shapeLabel(p.shape)
  const cpuRungs = (p.rungs ?? []).filter((r) => r.encoder === 'software').length
  return (
    <div className={`text-xs ${parked ? 'text-gray-400' : 'text-gray-600'}`}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
        {!single && <span className={`rounded px-1.5 py-px text-[11px] font-medium ${ROLE_BADGE[p.role]}`}>{ROLE_TEXT[p.role]}</span>}
        <span>{work}</span>
        {p.kind === 'video' && p.source_width ? (
          <span className="text-gray-400">
            from {p.source_width}×{p.source_height}
            {range ? ` ${range}` : ''}
          </span>
        ) : null}
        {parked ? (
          <span>kept for a seek back</span>
        ) : (
          <>
            <span className={`font-medium tabular-nums ${TONE_TEXT[speedTone(p.speed)]}`}>
              {p.speed == null ? p.state : `${p.speed.toFixed(2)}× realtime`}
            </span>
            <span className={`tabular-nums ${TONE_TEXT[buffer.tone]}`}>{buffer.text}</span>
          </>
        )}
        <span className="text-gray-400">
          {p.reason} · {formatAge(p.age_ms)}
        </span>
      </div>
      {p.rungs?.length > 0 && !parked && (
        <details className="mt-1 group">
          <summary className="cursor-pointer select-none text-gray-400 hover:text-gray-600 w-fit">
            Rungs{cpuRungs ? ` · ${cpuRungs} on the CPU` : ''}
          </summary>
          <ul className="mt-1 ml-3 flex flex-wrap gap-1.5">
            {p.rungs.map((r, i) => (
              <li
                key={i}
                className={`rounded px-1.5 py-0.5 ${r.encoder === 'software' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'}`}
              >
                {rungLabel(r)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function SessionGroup({ g }) {
  const { title, subtitle } = titleLines(g.lead)
  const audio = [...new Set(g.audio.map((a) => encoderLabel(a.encoder)))].join(', ')
  const watcher = g.viewers.find((v) => v.state === 'playing') ?? g.viewers[0]
  return (
    <li className="py-3 space-y-1.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm font-medium text-gray-900 truncate" title={g.lead.file ?? undefined}>
            {title}
          </div>
          {subtitle && <div className="text-xs text-gray-500 truncate">{subtitle}</div>}
          <Position viewer={watcher} durationSec={g.lead.title?.durationSec} />
        </div>
        <div className="text-xs">
          <Viewers viewers={g.viewers} />
        </div>
      </div>
      {g.playheads.map((p) => (
        <PlayheadLine key={p.id} p={p} single={g.playheads.length === 1} />
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

function Problems({ problems }) {
  const recent = (problems ?? []).filter((p) => p.age_ms <= PROBLEM_WINDOW_MS)
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Recent problems{recent.length ? ` · ${recent.length}` : ''}
      </h4>
      {recent.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">None in the last 24 hours.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {recent.slice(0, 10).map((p, i) => {
            const { title, subtitle } = titleLines(p)
            const hostIssue = p.event === 'signaled'
            return (
              <li key={`${p.at_unix_ms} ${i}`} className="py-2 text-sm flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0">{formatAgo(p.age_ms)}</span>
                <span className={`font-medium ${hostIssue ? 'text-red-700' : 'text-amber-800'}`}>{problemLabel(p.event)}</span>
                <span className="text-gray-700 truncate">
                  {title}
                  {subtitle ? <span className="text-gray-400"> · {subtitle}</span> : null}
                </span>
                <span className="text-xs text-gray-400">{p.kind}</span>
                {p.detail && (
                  <span className="basis-full text-xs text-gray-500 break-words pl-0 sm:pl-[5.75rem]" title={p.detail}>
                    {p.detail}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function TranscoderPanel({ t, history }) {
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
            <EncodingPanel load={t.load} capacity={t.capacity} history={history} />
            {gpu && <GpuPanel gpu={gpu} history={history} />}
          </div>
          {t.gpu?.length > 1 && (
            <p className="text-xs text-gray-500">
              Also on this host: {t.gpu.slice(1).map((g) => `${gpuDisplayName(g)} (${vendorLabel(g.vendor)})`).join(', ')}
            </p>
          )}
          <NowPlaying sessions={t.sessions} />
          <Problems problems={t.problems} />
        </>
      ) : (
        <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 break-words">
          {t.detail}
        </p>
      )}
    </section>
  )
}

export { TranscoderPanel }

export default function TranscoderSessions() {
  // The sparklines' samples, appended once per answer (kept in the browser; nothing extra is
  // fetched).
  const [history, pushHistory] = useReducer(appendHistory, {})
  const { data, error, mutate, isValidating } = useSWR(URL, fetcher, {
    // SWR does not poll a hidden tab, so a backgrounded dashboard costs nothing.
    refreshInterval: (latest) => (halted(latest) ? 0 : POLL_MS),
    onSuccess: pushHistory,
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
        list.map((t) => (
          <TranscoderPanel key={`${t.serverId} ${t.endpoint}`} t={t} history={history[`${t.serverId} ${t.endpoint}`]} />
        ))
      )}
    </div>
  )
}
