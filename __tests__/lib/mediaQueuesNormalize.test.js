/**
 * @jest-environment node
 *
 * The media-queue normalizers, against payloads shaped like the live services
 * answered on 2026-10-11 (Radarr/Sonarr API v3, SABnzbd 5.1.3, Tdarr 3.00.00).
 * The old dashboard read `data.length`, `queue.jobs` and `data.fileArr` — none
 * of which these APIs return — so every card showed an empty queue.
 */

const {
  ITEM_LIMIT,
  InvalidResponseError,
  normalizeArrQueue,
  normalizeSabnzbdQueue,
  normalizeTdarr,
  parseClockDuration,
  parseTimeSpan,
} = require('@src/lib/mediaQueues/normalize')

// ── fixtures ────────────────────────────────────────────────────────────────

const arrRecord = (overrides = {}) => ({
  movieId: 1,
  languages: [{ id: 1, name: 'English' }],
  quality: { quality: { id: 7, name: 'Remux-1080p' } },
  customFormats: [],
  customFormatScore: 0,
  size: 20_000_000_000,
  title: 'Some.Movie.2025.1080p.BluRay.REMUX-GRP',
  estimatedCompletionTime: '2026-10-11T19:24:50Z',
  added: '2026-10-11T10:00:00Z',
  status: 'downloading',
  trackedDownloadStatus: 'ok',
  trackedDownloadState: 'downloading',
  statusMessages: [],
  errorMessage: '',
  downloadId: 'SABnzbd_nzo_1',
  protocol: 'usenet',
  downloadClient: 'SABnzbd',
  downloadClientHasPostImportCategory: false,
  indexer: 'NZBgeek',
  sizeleft: 10_000_000_000,
  timeleft: '00:12:30',
  id: 101,
  ...overrides,
})

const arrPage = (records, overrides = {}) => ({
  page: 1,
  pageSize: 20,
  sortKey: 'timeleft',
  sortDirection: 'descending',
  totalRecords: records.length,
  records,
  ...overrides,
})

const arrStatus = (overrides = {}) => ({
  totalCount: 0,
  count: 0,
  unknownCount: 0,
  errors: false,
  warnings: false,
  unknownErrors: false,
  unknownWarnings: false,
  ...overrides,
})

const sabSlot = (overrides = {}) => ({
  status: 'Downloading',
  index: 0,
  password: '',
  avg_age: '2d',
  script: 'None',
  direct_unpack: null,
  mb: '2048.00',
  mbleft: '1024.00',
  mbmissing: '0.00',
  size: '2.0 GB',
  sizeleft: '1.0 GB',
  filename: 'Some.Show.S01E01.1080p.WEB-DL',
  labels: [],
  priority: 'Normal',
  cat: 'tv',
  timeleft: '0:04:09',
  percentage: '50',
  nzo_id: 'SABnzbd_nzo_abc',
  unpackopts: '3',
  ...overrides,
})

// The idle queue exactly as SABnzbd 5.1.3 answered it (slots aside).
const sabQueue = (overrides = {}, slots = []) => ({
  queue: {
    version: '5.1.3',
    paused: false,
    pause_int: '0',
    paused_all: false,
    diskspace1: '3936.33',
    diskspace1_norm: '3.8 T',
    speedlimit: '0',
    have_warnings: '0',
    kbpersec: '0.00',
    speed: '0',
    mbleft: '0.00',
    mb: '0.00',
    sizeleft: '0 B',
    size: '0 B',
    noofslots_total: slots.length,
    noofslots: slots.length,
    start: 0,
    limit: 3,
    finish: 3,
    status: 'Idle',
    timeleft: '0:00:00',
    slots,
    ...overrides,
  },
})

const tdarrNode = (overrides = {}) => ({
  _id: 'node-a',
  nodeName: 'MyInternalNode',
  remoteAddress: '172.18.0.5',
  config: { nodeName: 'MyInternalNode', apiKey: 'node-secret-key', pathTranslators: [{ server: '/media', node: '/media' }] },
  workers: {},
  workerLimits: { healthcheckcpu: 1, healthcheckgpu: 1, transcodecpu: 1, transcodegpu: 1 },
  nodePaused: false,
  queueLengths: { healthcheckcpu: 0, healthcheckgpu: 0, transcodecpu: 0, transcodegpu: 0 },
  nodeEngine: 'rust',
  ...overrides,
})

const tdarrStatistics = (overrides = {}) => ({
  _id: 'statistics',
  totalFileCount: 8981,
  table0Count: 0,
  table1Count: 937,
  table2Count: 8025,
  table3Count: 19,
  table4Count: 940,
  table5Count: 8041,
  table6Count: 0,
  processWarning: '',
  processWarningQueues: false,
  DBLoadStatus: 'Stable',
  ...overrides,
})

// ── duration parsing ────────────────────────────────────────────────────────

describe('duration parsing', () => {
  test('.NET TimeSpan, as Radarr/Sonarr send timeleft', () => {
    expect(parseTimeSpan('00:12:30')).toBe(750)
    expect(parseTimeSpan('1.02:03:04')).toBe(93_784)
    expect(parseTimeSpan('00:00:05.1234567')).toBe(5)
    expect(parseTimeSpan('soon')).toBeNull()
    expect(parseTimeSpan(undefined)).toBeNull()
  })

  test('clock durations, as SABnzbd and Tdarr send them', () => {
    expect(parseClockDuration('0:04:09')).toBe(249)
    expect(parseClockDuration('1:02:03:04')).toBe(93_784)
    expect(parseClockDuration('04:09')).toBe(249)
    expect(parseClockDuration('5m 3s')).toBeNull()
    expect(parseClockDuration(null)).toBeNull()
  })
})

// ── Radarr / Sonarr ─────────────────────────────────────────────────────────

describe('normalizeArrQueue', () => {
  test('reads the paged records object, not an array', () => {
    const records = [
      arrRecord({ id: 1, title: 'A' }),
      arrRecord({ id: 2, title: 'B' }),
      arrRecord({ id: 3, title: 'C' }),
      arrRecord({ id: 4, title: 'D' }),
    ]
    const result = normalizeArrQueue('radarr', arrPage(records), arrStatus({ totalCount: 4, count: 4 }))

    expect(result).toMatchObject({ service: 'radarr', state: 'ok', health: 'active', inProgress: 4, itemsTotal: 4 })
    expect(result.items).toHaveLength(ITEM_LIMIT)
    expect(result.counts).toEqual([{ label: 'In queue', value: 4, unit: 'count', tone: 'neutral' }])
    expect(result.notices).toEqual([])
  })

  test('a page shorter than the queue still counts the whole queue', () => {
    const records = Array.from({ length: 20 }, (_, i) => arrRecord({ id: i }))
    expect(normalizeArrQueue('sonarr', arrPage(records, { totalRecords: 57 }), arrStatus()).itemsTotal).toBe(57)
  })

  test('progress comes from size and sizeleft; the v3 queue has no progress field', () => {
    const [item] = normalizeArrQueue('radarr', arrPage([arrRecord()]), arrStatus()).items
    expect(item).toEqual({
      id: '101',
      title: 'Some.Movie.2025.1080p.BluRay.REMUX-GRP',
      status: 'Downloading',
      tone: 'active',
      progress: 50,
      sizeBytes: 20_000_000_000,
      timeLeftSeconds: 750,
      detail: null,
    })
  })

  test("an errorMessage on an 'ok' item is surfaced and ranked first", () => {
    // Live on 2026-10-11: four items at 100% "downloading" while SABnzbd sat
    // idle, one carrying "Corrupt RAR file".
    const records = [
      arrRecord({ id: 1, sizeleft: 0, timeleft: '00:00:00' }),
      arrRecord({ id: 2, sizeleft: 0, timeleft: '00:00:00' }),
      arrRecord({ id: 3, sizeleft: 0, timeleft: '00:00:00' }),
      arrRecord({ id: 4, sizeleft: 0, timeleft: '00:00:00', errorMessage: 'Corrupt RAR file' }),
    ]
    const result = normalizeArrQueue('radarr', arrPage(records), arrStatus({ totalCount: 4, count: 4 }))

    expect(result.health).toBe('warning')
    expect(result.items[0]).toMatchObject({ id: '4', tone: 'warning', detail: 'Corrupt RAR file', progress: 100 })
    expect(result.counts).toContainEqual({ label: 'Need attention', value: 1, unit: 'count', tone: 'warning' })
  })

  test('tracked-download states label the item and set its tone', () => {
    const records = [
      arrRecord({ id: 1, status: 'completed', trackedDownloadState: 'importPending' }),
      arrRecord({
        id: 2,
        status: 'completed',
        trackedDownloadStatus: 'warning',
        trackedDownloadState: 'importBlocked',
        statusMessages: [{ title: 'Some.Movie', messages: ['No files found are eligible for import'] }],
      }),
      arrRecord({ id: 3, status: 'failed', trackedDownloadStatus: 'error', trackedDownloadState: 'failedPending' }),
    ]
    const result = normalizeArrQueue('radarr', arrPage(records), arrStatus())

    expect(result.health).toBe('error')
    expect(result.items.map(({ id, status, tone, detail }) => ({ id, status, tone, detail }))).toEqual([
      { id: '3', status: 'Failed (pending)', tone: 'error', detail: null },
      { id: '2', status: 'Import blocked', tone: 'warning', detail: 'No files found are eligible for import' },
      { id: '1', status: 'Import pending', tone: 'neutral', detail: null },
    ])
  })

  test('whole-queue warnings from /queue/status count even when the page looks fine', () => {
    const result = normalizeArrQueue('sonarr', arrPage([arrRecord()]), arrStatus({ warnings: true }))
    expect(result.health).toBe('warning')
  })

  test('queued work with nothing moving is waiting, not idle', () => {
    const result = normalizeArrQueue('radarr', arrPage([arrRecord({ status: 'delay', trackedDownloadState: 'downloading' })]), arrStatus())
    expect(result).toMatchObject({ health: 'waiting', inProgress: 0 })
    expect(result.items[0].status).toBe('Delayed')
  })

  test('an empty queue is idle', () => {
    const result = normalizeArrQueue('radarr', arrPage([]), arrStatus())
    expect(result).toMatchObject({ health: 'idle', inProgress: 0, itemsTotal: 0, items: [] })
  })

  test('without /queue/status the queue still shows, with a notice', () => {
    const result = normalizeArrQueue('radarr', arrPage([arrRecord()]), null)
    expect(result.health).toBe('active')
    expect(result.notices).toEqual([expect.objectContaining({ tone: 'warning' })])
  })

  test('a bare array (what the old dashboard assumed) is not a v3 queue', () => {
    expect(() => normalizeArrQueue('radarr', [arrRecord()], arrStatus())).toThrow(InvalidResponseError)
  })
})

// ── SABnzbd ─────────────────────────────────────────────────────────────────

describe('normalizeSabnzbdQueue', () => {
  test('the live idle queue, with its warnings surfaced', () => {
    const result = normalizeSabnzbdQueue(sabQueue({ have_warnings: '3' }))
    expect(result).toEqual({
      service: 'sabnzbd',
      state: 'ok',
      health: 'idle',
      inProgress: 0,
      itemsTotal: 0,
      items: [],
      counts: [{ label: 'In queue', value: 0, unit: 'count', tone: 'neutral' }],
      notices: [{ tone: 'warning', message: 'SABnzbd is reporting 3 warnings.' }],
    })
  })

  test('reads slots, not jobs', () => {
    const result = normalizeSabnzbdQueue(
      sabQueue({ status: 'Downloading', kbpersec: '10240.00', timeleft: '0:04:09', noofslots_total: 5 }, [
        sabSlot(),
        sabSlot({ nzo_id: 'n2', status: 'Queued', percentage: '0', cat: '*' }),
      ])
    )

    expect(result).toMatchObject({ health: 'active', inProgress: 1, itemsTotal: 5 })
    expect(result.items[0]).toEqual({
      id: 'SABnzbd_nzo_abc',
      title: 'Some.Show.S01E01.1080p.WEB-DL',
      status: 'Downloading',
      tone: 'active',
      progress: 50,
      sizeBytes: 2048 * 1024 * 1024,
      timeLeftSeconds: 249,
      detail: 'Category: tv',
    })
    expect(result.items[1]).toMatchObject({ status: 'Queued', tone: 'neutral', detail: null })
    expect(result.counts).toEqual([
      { label: 'In queue', value: 5, unit: 'count', tone: 'neutral' },
      { label: 'Speed', value: 10240 * 1024, unit: 'bytesPerSecond', tone: 'active' },
      { label: 'Time left', value: 249, unit: 'seconds', tone: 'neutral' },
    ])
  })

  test('a paused queue reads as paused with nothing in progress', () => {
    const result = normalizeSabnzbdQueue(sabQueue({ paused: true, status: 'Paused' }, [sabSlot()]))
    expect(result).toMatchObject({ health: 'paused', inProgress: 0 })
  })

  test('problem labels warn; propagation does not', () => {
    const result = normalizeSabnzbdQueue(
      sabQueue({ status: 'Downloading' }, [
        sabSlot({ nzo_id: 'n1', labels: ['ENCRYPTED'] }),
        sabSlot({ nzo_id: 'n2', status: 'Propagating', labels: ['PROPAGATING 12 min'] }),
      ])
    )
    expect(result.items.map(({ tone, detail }) => ({ tone, detail }))).toEqual([
      { tone: 'warning', detail: 'ENCRYPTED' },
      { tone: 'neutral', detail: 'PROPAGATING 12 min' },
    ])
  })

  test('a queue without slots (the old `jobs` shape) is rejected', () => {
    expect(() => normalizeSabnzbdQueue({ queue: { status: 'Idle', jobs: [] } })).toThrow(InvalidResponseError)
    expect(() => normalizeSabnzbdQueue('{\'queue\': {}}')).toThrow(InvalidResponseError)
  })
})

// ── Tdarr ───────────────────────────────────────────────────────────────────

describe('normalizeTdarr', () => {
  const nodes = (...list) => Object.fromEntries(list.map((node) => [node._id, node]))

  test('the live state: two idle nodes and a library queue', () => {
    const result = normalizeTdarr(
      nodes(tdarrNode(), tdarrNode({ _id: 'node-b', nodeName: 'MyExternalNode' })),
      tdarrStatistics()
    )

    expect(result).toEqual({
      service: 'tdarr',
      state: 'ok',
      health: 'waiting',
      inProgress: 0,
      itemsTotal: 0,
      items: [],
      counts: [
        { label: 'Workers running', value: 0, unit: 'count', tone: 'neutral' },
        { label: 'Transcode queue', value: 937, unit: 'count', tone: 'neutral' },
        { label: 'Health-check queue', value: 940, unit: 'count', tone: 'neutral' },
        { label: 'Transcode errors', value: 19, unit: 'count', tone: 'warning' },
      ],
      notices: [],
    })
  })

  test("nothing of a node's config (its API key, path translators) survives normalization", () => {
    const serialized = JSON.stringify(normalizeTdarr(nodes(tdarrNode()), tdarrStatistics()))
    expect(serialized).not.toContain('node-secret-key')
    expect(serialized).not.toContain('pathTranslators')
    expect(serialized).not.toContain('172.18.0.5')
  })

  test('running workers become items', () => {
    const worker = {
      _id: 'w1',
      file: '/media/movies/Some Movie (2025)/Some Movie (2025).mkv',
      workerType: 'transcodegpu',
      status: 'Processing',
      percentage: 42.7,
      fps: 118.4,
      ETA: '0:12:05',
    }
    const result = normalizeTdarr(nodes(tdarrNode({ workers: { w1: worker } })), tdarrStatistics())

    expect(result).toMatchObject({ health: 'active', inProgress: 1, itemsTotal: 1 })
    expect(result.counts[0]).toEqual({ label: 'Workers running', value: 1, unit: 'count', tone: 'active' })
    expect(result.items[0]).toEqual({
      id: 'w1',
      title: 'Some Movie (2025).mkv',
      status: 'Transcode (GPU)',
      tone: 'active',
      progress: 42.7,
      sizeBytes: null,
      timeLeftSeconds: 725,
      detail: 'MyInternalNode · Processing · 118 fps',
    })
  })

  test('every node paused reads as paused', () => {
    const result = normalizeTdarr(nodes(tdarrNode({ nodePaused: true })), tdarrStatistics())
    expect(result.health).toBe('paused')
    expect(result.notices).toEqual([{ tone: 'warning', message: '1 of 1 nodes paused.' }])
  })

  test('no connected nodes is a warning', () => {
    const result = normalizeTdarr({}, tdarrStatistics())
    expect(result.health).toBe('warning')
    expect(result.notices).toContainEqual({ tone: 'warning', message: 'No Tdarr nodes are connected.' })
  })

  test('without statistics the workers still show, with a notice', () => {
    const result = normalizeTdarr(nodes(tdarrNode()), null)
    expect(result.health).toBe('idle')
    expect(result.counts).toEqual([{ label: 'Workers running', value: 0, unit: 'count', tone: 'neutral' }])
    expect(result.notices).toEqual([{ tone: 'warning', message: 'Library queue counts unavailable.' }])
  })

  test("Tdarr's own process warning is passed on", () => {
    const result = normalizeTdarr(nodes(tdarrNode()), tdarrStatistics({ processWarning: 'Cache folder is full' }))
    expect(result.notices).toContainEqual({ tone: 'warning', message: 'Cache folder is full' })
  })

  test('a non-object get-nodes answer is rejected', () => {
    expect(() => normalizeTdarr([], tdarrStatistics())).toThrow(InvalidResponseError)
  })
})
