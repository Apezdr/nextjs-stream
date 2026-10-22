'use client'

import useSWR from 'swr'
import { fetcher } from '@src/utils'
import { StatusBadge, MaterialButton } from '../BaseComponents'

const URL = '/api/authenticated/admin/transcoder-sessions'
const POLL_MS = 5000

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

function titleLabel(s) {
  const t = s.title
  if (t?.kind === 'episode') {
    const se = t.season != null && t.episode != null ? ` S${String(t.season).padStart(2, '0')}E${String(t.episode).padStart(2, '0')}` : ''
    return `${t.show ?? 'Unknown show'}${se}`
  }
  if (t?.kind === 'movie') return t.name ?? 'Unknown title'
  return s.file ?? 'Not in the library'
}

function age(ms) {
  if (!Number.isFinite(ms)) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function SpeedCell({ speed }) {
  if (speed == null) return <span className="text-gray-400">—</span>
  const tone = speed < 1 ? 'text-red-700 font-semibold' : speed < 1.2 ? 'text-amber-700' : 'text-emerald-700'
  return <span className={tone}>{speed.toFixed(2)}×</span>
}

function BufferCell({ ahead, head }) {
  if (head < 0) return <span className="text-amber-700">first segment</span>
  const tone = ahead < 0 ? 'text-red-700 font-semibold' : ahead < 2 ? 'text-amber-700' : 'text-gray-700'
  return <span className={tone}>{ahead < 0 ? `waiting ${-ahead}` : `${ahead} ahead`}</span>
}

function Stat({ label, value, sub, tone = 'text-gray-900' }) {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 min-w-0">
      <div className="text-xs text-gray-500 truncate">{label}</div>
      <div className={`text-base font-semibold ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 truncate">{sub}</div>}
    </div>
  )
}

function LoadStats({ load, capacity }) {
  if (!load) return null
  const videoCap = (capacity?.cpu_encoders ?? 0) + (capacity?.nvenc_encoders ?? 0)
  const full = videoCap > 0 && load.active_encoders >= videoCap
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <Stat
        label="Video encoders"
        value={videoCap ? `${load.active_encoders} / ${videoCap}` : load.active_encoders}
        tone={full ? 'text-red-700' : 'text-gray-900'}
        sub={full ? 'all slots in use' : null}
      />
      <Stat label="Waiting for a slot" value={load.queued} tone={load.queued > 0 ? 'text-red-700' : 'text-gray-900'} />
      <Stat label="Cold starts waiting" value={load.cold_start_waiting} tone={load.cold_start_waiting > 0 ? 'text-amber-700' : 'text-gray-900'} />
      <Stat label="GPU fan-outs" value={`${load.gpu_large_active} 4K · ${load.gpu_small_active} ≤1080p`} />
      <Stat label="Copy (direct) sessions" value={load.direct_sessions} />
      <Stat label="Audio encoders" value={capacity?.audio_encoders ? `${load.audio_encoders} / ${capacity.audio_encoders}` : load.audio_encoders} />
    </div>
  )
}

function GpuStats({ gpu }) {
  if (!gpu?.length) return null
  return (
    <div className="space-y-2">
      {gpu.map((g) => (
        <div key={g.card} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <Stat
            label={`GPU busy (${g.vendor}${g.pci ? ` ${g.pci}` : ''})`}
            value={g.busy_percent == null ? '—' : `${g.busy_percent.toFixed(0)}%`}
            sub={g.window_ms ? `over ${(g.window_ms / 1000).toFixed(1)} s` : 'measuring…'}
            tone={g.busy_percent >= 90 ? 'text-red-700' : 'text-gray-900'}
          />
          <Stat label="Clock" value={g.freq_mhz == null ? '—' : `${g.freq_mhz} MHz`} sub={g.max_freq_mhz ? `of ${g.max_freq_mhz} MHz` : null} />
          <Stat label="Power" value={g.power_w == null ? '—' : `${g.power_w.toFixed(1)} W`} sub={g.power_max_w ? `limit ${g.power_max_w.toFixed(0)} W` : null} />
          <Stat label="Temperature" value={g.temp_c == null ? '—' : `${g.temp_c.toFixed(0)} °C`} />
          <Stat label="Fan" value={g.fan_rpm == null ? '—' : `${g.fan_rpm} RPM`} />
        </div>
      ))}
    </div>
  )
}

function SessionsTable({ sessions }) {
  if (!sessions.length) {
    return <p className="text-sm text-gray-500 py-2">Nothing is playing through this transcoder.</p>
  }
  return (
    <div className="overflow-x-auto -mx-4 sm:mx-0">
      <table className="min-w-full text-sm">
        <caption className="sr-only">Live transcoder sessions</caption>
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
            <th scope="col" className="py-2 px-4 sm:pl-0 font-medium">Title</th>
            <th scope="col" className="py-2 px-2 font-medium">Watching</th>
            <th scope="col" className="py-2 px-2 font-medium">Work</th>
            <th scope="col" className="py-2 px-2 font-medium">State</th>
            <th scope="col" className="py-2 px-2 font-medium">Speed</th>
            <th scope="col" className="py-2 px-2 font-medium">Buffer</th>
            <th scope="col" className="py-2 px-2 font-medium">Started by</th>
            <th scope="col" className="py-2 px-2 font-medium">Age</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sessions.map((s) => (
            <tr key={s.id} className={s.kind === 'audio' ? 'text-gray-500' : 'text-gray-900'}>
              <td className="py-2 px-4 sm:pl-0 max-w-[16rem]">
                <div className="truncate" title={s.file ?? undefined}>{titleLabel(s)}</div>
                {s.kind === 'video' && s.source_width && (
                  <div className="text-xs text-gray-500">
                    {s.source_width}×{s.source_height}
                    {s.shape ? ` · ${s.shape}` : ''} · {s.outputs} rungs
                  </div>
                )}
              </td>
              <td className="py-2 px-2 whitespace-nowrap">
                {s.viewers.length === 0 ? (
                  <span className="text-gray-400">nobody</span>
                ) : (
                  s.viewers.map((v, i) => (
                    <div key={i}>
                      {v.name}
                      {v.state === 'paused' ? <span className="text-gray-400"> (paused)</span> : null}
                    </div>
                  ))
                )}
              </td>
              <td className="py-2 px-2 whitespace-nowrap">
                {s.kind === 'video' ? 'video' : s.kind === 'direct' ? 'copy' : 'audio'} · {s.encoder}
              </td>
              <td className="py-2 px-2 whitespace-nowrap">{s.state}</td>
              <td className="py-2 px-2 whitespace-nowrap"><SpeedCell speed={s.speed} /></td>
              <td className="py-2 px-2 whitespace-nowrap"><BufferCell ahead={s.ahead} head={s.head} /></td>
              <td className="py-2 px-2 whitespace-nowrap">{s.reason}</td>
              <td className="py-2 px-2 whitespace-nowrap">{age(s.age_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TranscoderPanel({ t }) {
  return (
    <section className="space-y-3" aria-label={`Transcoder for ${t.serverLabel}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-gray-900">{t.serverLabel}</h3>
        <span className="text-xs text-gray-500 break-all">{hostOf(t.endpoint)}</span>
        {t.internal && (
          <StatusBadge status="info" variant="soft" size="small">internal URL</StatusBadge>
        )}
        {t.ok ? (
          <>
            <StatusBadge status="success" variant="soft" size="small">connected</StatusBadge>
            <span className="text-xs text-gray-500">v{t.version} · {t.ms} ms</span>
          </>
        ) : (
          <StatusBadge status={CONFIG_REASONS.has(t.reason) ? 'error' : 'warning'} variant="soft" size="small">
            {t.reason}
          </StatusBadge>
        )}
      </div>
      {t.ok ? (
        <>
          <LoadStats load={t.load} capacity={t.capacity} />
          <GpuStats gpu={t.gpu} />
          <SessionsTable sessions={t.sessions} />
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
    return <div className="p-4 space-y-2 animate-pulse"><div className="h-4 bg-gray-200 rounded w-1/3" /><div className="h-16 bg-gray-100 rounded" /></div>
  }
  const list = data.transcoders ?? []
  return (
    <div className="p-4 space-y-6">
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
