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
    .map((g) => ({ ...g, lead: g.playheads[0] ?? g.audio[0] }))
    .sort((a, b) => Number(waiting(b)) - Number(waiting(a)) || oldest(b) - oldest(a))
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

/** The tone of a speed: under realtime is falling behind. */
export function speedTone(speed) {
  if (speed == null) return 'muted'
  if (speed < 1) return 'bad'
  if (speed < 1.2) return 'warn'
  return 'good'
}

/** What a playhead's buffer means to its viewer. */
export function bufferLabel(session) {
  if (session.head < 0) return { text: 'starting', tone: 'warn' }
  if (session.ahead < 0) return { text: `${-session.ahead} behind`, tone: 'bad' }
  return { text: `${session.ahead} ahead`, tone: session.ahead < 2 ? 'warn' : 'good' }
}
