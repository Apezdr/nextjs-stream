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
  expect(bufferLabel({ head: 4, ahead: -3 })).toEqual({ text: '3 behind', tone: 'bad' })
  expect(bufferLabel({ head: 10, ahead: 6 })).toEqual({ text: '6 ahead', tone: 'good' })
})
