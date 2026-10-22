/**
 * Pure formatting for the admin Transcoder card (no React), so the wording is unit-tested.
 */

const VENDOR_LABELS = { intel: 'Intel', amd: 'AMD', nvidia: 'NVIDIA' }

export function vendorLabel(vendor) {
  return VENDOR_LABELS[vendor] ?? 'GPU'
}

/**
 * A driver's device name, without trademark marks or the trailing codename:
 * "Intel(R) Arc(tm) A380 Graphics (DG2)" → "Intel Arc A380 Graphics",
 * "AMD Radeon RX 7600 (RADV NAVI33)" → "AMD Radeon RX 7600".
 * Without a name: the vendor and PCI device id ("Intel GPU 0x56a5").
 */
export function gpuDisplayName(gpu) {
  const raw = typeof gpu?.name === 'string' ? gpu.name : ''
  const cleaned = raw
    .replace(/\((?:r|tm)\)|[®™]/gi, '')
    .replace(/\s*\([^()]*\)\s*$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  if (cleaned) return cleaned
  const vendor = VENDOR_LABELS[gpu?.vendor]
  return [vendor ? `${vendor} GPU` : 'GPU', gpu?.device_id].filter(Boolean).join(' ')
}

const DECODE = { qsv: 'Quick Sync', cuda: 'NVDEC', d3d11va: 'D3D11VA', software: 'CPU' }
const ENCODE = { qsv: 'Quick Sync', nvenc: 'NVENC', software: 'CPU (x264/x265)' }

/** The pipeline chips: `[{ label, value }]`, empty without a hardware report. */
export function pipelineChips(hardware) {
  if (!hardware) return []
  const tonemap = hardware.gpu_tonemap
    ? 'GPU'
    : hardware.tonemap === 'libplacebo'
      ? 'libplacebo'
      : 'CPU'
  return [
    { label: 'Decode', value: DECODE[hardware.decode] ?? hardware.decode },
    { label: 'Encode', value: ENCODE[hardware.encode] ?? hardware.encode },
    { label: 'HDR tone-map', value: tonemap },
  ]
}

const ENCODER_PARTS = {
  qsv: 'Quick Sync',
  nvenc: 'NVENC',
  software: 'CPU',
  copy: 'copy',
  aac: 'AAC',
  eac3: 'E-AC-3',
  ac3: 'AC-3',
}

/** A session's encoder in the chips' words: "qsv+software" → "Quick Sync + CPU". */
export function encoderLabel(encoder) {
  if (typeof encoder !== 'string' || !encoder) return '—'
  return encoder
    .split('+')
    .map((part) => ENCODER_PARTS[part] ?? part)
    .join(' + ')
}

/** The fan-out shape as the source's range: the shapes are pipeline names. */
export function shapeLabel(shape) {
  return { sysmem: 'SDR', 'gpu-sdr': 'SDR', hdr: 'HDR', 'dv-reshape': 'Dolby Vision' }[shape] ?? null
}

/** "S01E02" when both numbers are known. */
function episodeCode(t) {
  if (t?.season == null || t?.episode == null) return ''
  return `S${String(t.season).padStart(2, '0')}E${String(t.episode).padStart(2, '0')}`
}

/** `{ title, subtitle }` for a session group. */
export function titleLines(session) {
  const t = session.title
  if (t?.kind === 'episode') {
    return {
      title: t.show ?? 'Unknown show',
      subtitle: [episodeCode(t), t.name].filter(Boolean).join(' · ') || null,
    }
  }
  if (t?.kind === 'movie') return { title: t.name ?? 'Unknown title', subtitle: null }
  return { title: session.file ?? 'Not in the library', subtitle: 'not matched to a library title' }
}

/**
 * Sessions grouped per title: `[{ key, lead, playheads, audio, viewers }]`.
 * `playheads` are the video and copy sessions (one per playhead), `audio` the audio renditions
 * encoding alongside. Groups with a waiting viewer come first, then the oldest.
 */
export function groupSessions(sessions) {
  const groups = new Map()
  for (const s of sessions ?? []) {
    const key = s.videoId ?? s.path_key
    if (!groups.has(key)) groups.set(key, { key, lead: s, playheads: [], audio: [], viewers: s.viewers ?? [] })
    const g = groups.get(key)
    if (s.kind === 'audio') g.audio.push(s)
    else g.playheads.push(s)
  }
  const waiting = (g) => g.playheads.some((p) => p.ahead < 0 || p.head < 0)
  const oldest = (g) => Math.max(0, ...[...g.playheads, ...g.audio].map((s) => s.age_ms ?? 0))
  return [...groups.values()]
    .map((g) => ({ ...g, lead: g.playheads[0] ?? g.audio[0], playheads: withRoles(g.playheads, g.viewers) }))
    .sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || oldest(b) - oldest(a))
}

/**
 * Which playhead the viewer is on. The player keeps fetching from the one it is playing, so the
 * most recently served (lowest `idle_ms`) is current; the others are slots the transcoder kept
 * after a seek, so a jump back does not start cold. Role: `watching` (someone is on it),
 * `current` (no viewer known), `parked`.
 */
function withRoles(playheads, viewers) {
  if (playheads.length === 0) return playheads
  const current = playheads.reduce((best, p) => ((p.idle_ms ?? Infinity) < (best.idle_ms ?? Infinity) ? p : best))
  const lead = viewers?.length ? 'watching' : 'current'
  return playheads
    .map((p) => ({ ...p, role: p === current ? lead : 'parked' }))
    .sort((a, b) => Number(a.role === 'parked') - Number(b.role === 'parked') || a.id - b.id)
}

/** "0:45", "12:34", "1:02:03". */
export function formatClock(totalSec) {
  if (!Number.isFinite(totalSec) || totalSec < 0) return '—'
  const s = Math.floor(totalSec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** A viewer's place in the title: `{ text, percent }`, `null` without a position. */
export function positionLabel(positionSec, durationSec) {
  if (!Number.isFinite(positionSec)) return null
  if (!Number.isFinite(durationSec) || durationSec <= 0) return { text: formatClock(positionSec), percent: null }
  return {
    text: `${formatClock(positionSec)} of ${formatClock(durationSec)}`,
    percent: Math.min(100, Math.max(0, (100 * positionSec) / durationSec)),
  }
}

const ENGINE_LABELS = {
  'video-enhance': 'Video processing',
  render: 'Render',
  compute: 'Compute',
  copy: 'Copy',
  enc: 'Encode',
  dec: 'Decode',
  gfx: 'Graphics',
}

/** An engine class in plain words; Intel's video engine is what Quick Sync runs on. */
export function engineLabel(name, vendor) {
  if (name === 'video') return vendor === 'intel' ? 'Quick Sync (video)' : 'Video'
  return ENGINE_LABELS[name] ?? name
}

/** "365 MiB", "1.2 GiB". */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GiB`
  return `${Math.round(bytes / (1 << 20))} MiB`
}

const PROBLEM_LABELS = {
  failed: 'Encode failed',
  signaled: 'Killed by the system (driver or memory)',
  stalled: 'Stalled, restarted',
  direct_poisoned: 'Direct play turned off for this title',
  reattach_exhausted: 'Gave up waiting for a segment',
}

export function problemLabel(event) {
  return PROBLEM_LABELS[event] ?? event
}

/** "2160p HEVC PQ · Quick Sync", "1080p H.264 · trick-play". */
export function rungLabel(rung) {
  const codec = { hevc: 'HEVC', h264: 'H.264' }[rung.codec] ?? rung.codec
  const range = rung.range === 'pq' ? ' PQ' : ''
  const role = rung.trick_play ? ' · trick-play' : ''
  return `${rung.height}p ${codec}${range} · ${encoderLabel(rung.encoder)}${role}`
}

/** Seconds as "24 s" / "1m 12s". */
function seconds(sec) {
  const s = Math.round(sec)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/**
 * The history the card's sparklines draw, appended per answer: per transcoder, the last
 * `max` samples of encoders in use, the video engine's load and the GT awake share.
 */
export function appendHistory(state, data, max = 90) {
  const next = { ...state }
  for (const t of data?.transcoders ?? []) {
    if (!t.ok) continue
    const key = `${t.serverId} ${t.endpoint}`
    const gpu = t.gpu?.[0]
    const video = gpu?.engines?.find((e) => e.name === 'video' || e.name === 'enc')
    const sample = {
      at: data.generatedAt,
      encoders: t.load?.active_encoders ?? null,
      video: video?.busy_percent ?? null,
    }
    const prev = next[key] ?? []
    if (prev.length && prev[prev.length - 1].at === sample.at) continue
    next[key] = [...prev, sample].slice(-max)
  }
  return next
}

/** "1m 05s", "2h 03m". */
export function formatAge(ms) {
  if (!Number.isFinite(ms)) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** When something happened, coarsely: "45 s ago", "10 min ago", "3 h ago". */
export function formatAgo(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)} h ago`
}

/** The tone of a speed: under realtime is falling behind. */
export function speedTone(speed) {
  if (speed == null) return 'muted'
  if (speed < 1) return 'bad'
  if (speed < 1.2) return 'warn'
  return 'good'
}

/**
 * What a playhead's buffer means to its viewer, in time when the segment length is known
 * (`ahead` × `segment_secs`); under 12 s buffered is worth a look.
 */
export function bufferLabel(session) {
  if (session.head < 0) return { text: 'starting', tone: 'warn' }
  const secs = Number.isFinite(session.segment_secs) && session.segment_secs > 0 ? session.segment_secs : null
  const span = (n) => (secs ? seconds(n * secs) : `${n} segments`)
  if (session.ahead < 0) return { text: `${span(-session.ahead)} behind`, tone: 'bad' }
  const thin = secs ? session.ahead * secs < 12 : session.ahead < 2
  return { text: `${span(session.ahead)} ahead`, tone: thin ? 'warn' : 'good' }
}
