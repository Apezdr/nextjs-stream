import {
  gpuDisplayName,
  pipelineChips,
  groupSessions,
  titleLines,
  formatAge,
  speedTone,
  bufferLabel,
  encoderLabel,
  shapeLabel,
  formatClock,
  positionLabel,
  formatBytes,
  engineLabel,
  rungLabel,
  problemLabel,
  appendHistory,
  formatAgo,
} from '@src/components/Admin/Stats/transcoderDisplay'

describe('gpuDisplayName', () => {
  test('drops trademark marks and the trailing codename', () => {
    expect(gpuDisplayName({ name: 'Intel(R) Arc(tm) A380 Graphics (DG2)' })).toBe('Intel Arc A380 Graphics')
    expect(gpuDisplayName({ name: 'AMD Radeon RX 7600 (RADV NAVI33)' })).toBe('AMD Radeon RX 7600')
    expect(gpuDisplayName({ name: 'NVIDIA GeForce RTX 3060' })).toBe('NVIDIA GeForce RTX 3060')
    expect(gpuDisplayName({ name: 'Intel® Arc™ B580' })).toBe('Intel Arc B580')
  })

  test('without a name: the vendor and PCI device id', () => {
    expect(gpuDisplayName({ vendor: 'intel', device_id: '0x56a5' })).toBe('Intel GPU 0x56a5')
    expect(gpuDisplayName({ vendor: '0x1234' })).toBe('GPU')
    expect(gpuDisplayName(null)).toBe('GPU')
  })
})

test('pipelineChips names the backends in plain words', () => {
  expect(pipelineChips({ decode: 'qsv', encode: 'qsv', tonemap: 'cpu', gpu_tonemap: true })).toEqual([
    { label: 'Decode', value: 'Quick Sync' },
    { label: 'Encode', value: 'Quick Sync' },
    { label: 'HDR tone-map', value: 'GPU' },
  ])
  expect(pipelineChips({ decode: 'cuda', encode: 'nvenc', tonemap: 'libplacebo', gpu_tonemap: false })[2].value).toBe(
    'libplacebo'
  )
  expect(pipelineChips({ decode: 'software', encode: 'software', tonemap: 'cpu' }).map((c) => c.value)).toEqual([
    'CPU',
    'CPU (x264/x265)',
    'CPU',
  ])
  expect(pipelineChips(null)).toEqual([])
})

describe('groupSessions', () => {
  const s = (id, kind, videoId, extra = {}) => ({ id, kind, videoId, path_key: `k${videoId}`, head: 10, ahead: 5, age_ms: 1000, viewers: [], ...extra })

  test("one group per title, playheads and audio apart, and a waiting viewer's title first", () => {
    const groups = groupSessions([
      s(1, 'video', 'a', { age_ms: 90_000 }),
      s(2, 'audio', 'a'),
      s(3, 'audio', 'a'),
      s(4, 'video', 'b', { ahead: -2 }),
      s(5, 'direct', 'a'),
    ])
    expect(groups.map((g) => g.key)).toEqual(['b', 'a'])
    const a = groups[1]
    expect(a.playheads.map((p) => p.id)).toEqual([1, 5])
    expect(a.audio.map((p) => p.id)).toEqual([2, 3])
    expect(a.lead.id).toBe(1)
  })

  test('an audio-only title still has a lead', () => {
    expect(groupSessions([s(9, 'audio', 'c')])[0].lead.id).toBe(9)
    expect(groupSessions(undefined)).toEqual([])
  })
})

test('titleLines reads movies, episodes and unmatched files', () => {
  expect(titleLines({ title: { kind: 'movie', name: 'A Film' } })).toEqual({ title: 'A Film', subtitle: null })
  expect(
    titleLines({ title: { kind: 'episode', show: 'A Show', season: 1, episode: 2, name: 'Pilot' } })
  ).toEqual({ title: 'A Show', subtitle: 'S01E02 · Pilot' })
  expect(titleLines({ title: null, file: 'x.mkv' })).toEqual({ title: 'x.mkv', subtitle: 'not matched to a library title' })
})

test('encoder and shape labels use the same words as the pipeline chips', () => {
  expect(encoderLabel('qsv+software')).toBe('Quick Sync + CPU')
  expect(encoderLabel('eac3')).toBe('E-AC-3')
  expect(encoderLabel('mystery')).toBe('mystery')
  expect(encoderLabel(undefined)).toBe('—')
  expect(['sysmem', 'gpu-sdr', 'hdr', 'dv-reshape', undefined].map(shapeLabel)).toEqual([
    'SDR',
    'SDR',
    'HDR',
    'Dolby Vision',
    null,
  ])
})

test('formatting helpers', () => {
  expect(formatAge(5_400)).toBe('5s')
  expect(formatAge(65_000)).toBe('1m 05s')
  expect(formatAge(7_380_000)).toBe('2h 03m')
  expect(formatAge(undefined)).toBe('—')
  expect([0.8, 1.1, 2, null].map(speedTone)).toEqual(['bad', 'warn', 'good', 'muted'])
  expect(bufferLabel({ head: -1, ahead: -1 })).toEqual({ text: 'starting', tone: 'warn' })
  // An older transcoder without segment_secs: segments.
  expect(bufferLabel({ head: 4, ahead: -3 })).toEqual({ text: '3 segments behind', tone: 'bad' })
  expect(bufferLabel({ head: 10, ahead: 6 })).toEqual({ text: '6 segments ahead', tone: 'good' })
  // With it: time, and under 12 s buffered is thin.
  expect(bufferLabel({ head: 10, ahead: 4, segment_secs: 6.006 })).toEqual({ text: '24 s ahead', tone: 'good' })
  expect(bufferLabel({ head: 10, ahead: 1, segment_secs: 6 })).toEqual({ text: '6 s ahead', tone: 'warn' })
  expect(bufferLabel({ head: 10, ahead: 12, segment_secs: 6 })).toEqual({ text: '1m 12s ahead', tone: 'good' })
  expect(bufferLabel({ head: 3, ahead: -2, segment_secs: 6 })).toEqual({ text: '12 s behind', tone: 'bad' })
})

test('the most recently served playhead is the one being watched; the others are parked', () => {
  const p = (id, idle_ms) => ({ id, kind: 'video', videoId: 'a', path_key: 'ka', head: 10, ahead: 3, idle_ms, age_ms: 1, viewers: [{ name: 'Sam' }] })
  const [g] = groupSessions([p(1, 66_000), p(2, 400)])
  expect(g.playheads.map((x) => [x.id, x.role])).toEqual([[2, 'watching'], [1, 'parked']])
  const [solo] = groupSessions([{ ...p(3, 10), viewers: [] }])
  expect(solo.playheads[0].role).toBe('current')
})

test('position, clock, bytes, engines, rungs and problems read in plain words', () => {
  expect(formatClock(45)).toBe('0:45')
  expect(formatClock(754)).toBe('12:34')
  expect(formatClock(3723)).toBe('1:02:03')
  expect(positionLabel(754, 3130)).toEqual({ text: '12:34 of 52:10', percent: (100 * 754) / 3130 })
  expect(positionLabel(754, null)).toEqual({ text: '12:34', percent: null })
  expect(positionLabel(null, 100)).toBeNull()
  expect(formatBytes(373_424 * 1024)).toBe('365 MiB')
  expect(formatBytes(1.5 * 2 ** 30)).toBe('1.5 GiB')
  expect(engineLabel('video', 'intel')).toBe('Quick Sync (video)')
  expect(engineLabel('video', 'amd')).toBe('Video')
  expect(engineLabel('video-enhance', 'intel')).toBe('Video processing')
  expect(engineLabel('weird', 'intel')).toBe('weird')
  expect(rungLabel({ height: 2160, codec: 'hevc', encoder: 'qsv', range: 'pq', trick_play: false })).toBe('2160p HEVC PQ · Quick Sync')
  expect(rungLabel({ height: 144, codec: 'h264', encoder: 'software', range: 'sdr', trick_play: false })).toBe('144p H.264 · CPU')
  expect(rungLabel({ height: 360, codec: 'h264', encoder: 'qsv', range: 'sdr', trick_play: true })).toBe('360p H.264 · Quick Sync · trick-play')
  expect(problemLabel('signaled')).toMatch(/Killed by the system/)
  expect(problemLabel('new-thing')).toBe('new-thing')
  expect([45_000, 600_000, 3_600_000, -1].map(formatAgo)).toEqual(['45 s ago', '10 min ago', '1 h ago', '—'])
})

test('history keeps the last samples per transcoder and skips a repeated answer', () => {
  const answer = (at, encoders, video) => ({
    generatedAt: at,
    transcoders: [
      { ok: true, serverId: 'default', endpoint: 'http://t', load: { active_encoders: encoders }, gpu: [{ engines: [{ name: 'video', busy_percent: video }] }] },
      { ok: false, serverId: 'server2', endpoint: 'http://u' },
    ],
  })
  let h = appendHistory({}, answer('t1', 1, 10))
  h = appendHistory(h, answer('t1', 1, 10))
  h = appendHistory(h, answer('t2', 2, 30))
  expect(h['default http://t']).toEqual([
    { at: 't1', encoders: 1, video: 10 },
    { at: 't2', encoders: 2, video: 30 },
  ])
  expect(h['server2 http://u']).toBeUndefined()
  for (let i = 0; i < 100; i++) h = appendHistory(h, answer(`x${i}`, 0, 0), 90)
  expect(h['default http://t']).toHaveLength(90)
})
