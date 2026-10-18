/**
 * @jest-environment node
 *
 * The display title and its source. See the module header; each case here is
 * one step of it. originalTitle (the folder name) is an input only: the rule
 * never changes it.
 */

const mockServers = { A: { id: 'A', priority: 1 }, B: { id: 'B', priority: 2 }, C: { id: 'C', priority: 2 } }
jest.mock('@src/utils/config', () => ({
  getServer: (id) => {
    if (!mockServers[id]) throw new Error(`No server found with ID: ${id}`)
    return mockServers[id]
  },
  multiServerHandler: {},
}))

const { resolveTitle } = require('@src/utils/sync/core/title')

const FOLDER = 'The Film (1999)'
/** Every server in `servers` has the folder (with a video in it). */
const availability = (...servers) => ({ movies: { [FOLDER]: { 'urls.mp4': servers } }, tv: {} })
const server = (id) => ({ id, priority: mockServers[id].priority })
const input = (overrides) => ({
  originalTitle: FOLDER,
  metadata: { metadata: { title: 'The Film' }, metadataSource: 'A' },
  fieldAvailability: availability('A', 'B'),
  mediaType: 'movies',
  serverConfig: server('B'),
  stored: null,
  locks: { title: false },
  ...overrides,
})

describe('resolveTitle: the title', () => {
  it('is the metadata\'s title, trimmed', () => {
    expect(resolveTitle(input({ metadata: { metadata: { title: '  The Film  ' }, metadataSource: 'A' } })).title).toBe('The Film')
  })

  it('is the folder name when the metadata has no title', () => {
    for (const metadata of [{}, { title: '' }, { title: '   ' }, { title: 42 }, null, undefined]) {
      expect(resolveTitle(input({ metadata: { metadata, metadataSource: 'A' } })).title).toBe(FOLDER)
    }
  })

  it('is the folder name for the stub written after a failed first fetch', () => {
    const stub = { title: 'Not a metadata title', hasExternalMetadata: false }
    expect(resolveTitle(input({ metadata: { metadata: stub, metadataSource: 'B' } })).title).toBe(FOLDER)
  })
})

describe('resolveTitle: a show', () => {
  const SHOW = 'The Show (2001)'
  const showAvailability = (...servers) => ({ movies: {}, tv: { [SHOW]: { 'seasons.Season 1.episodes.S01E01.videoURL': servers } } })
  const showInput = (overrides) => input({
    originalTitle: SHOW,
    mediaType: 'tv',
    fieldAvailability: showAvailability('A', 'B'),
    ...overrides,
  })

  it('reads the metadata\'s `name`, trimmed, credited to the metadata\'s source', () => {
    const outcome = resolveTitle(showInput({ metadata: { metadata: { name: '  The Show  ' }, metadataSource: 'B' } }))
    expect(outcome).toMatchObject({ title: 'The Show', titleSource: 'B' })
  })

  it('does not read a movie\'s `title` field, and a movie does not read `name`', () => {
    const copy = { metadata: { title: 'A Movie Field', name: 'A Show Field' }, metadataSource: 'A' }
    expect(resolveTitle(showInput({ metadata: copy })).title).toBe('A Show Field')
    expect(resolveTitle(input({ metadata: copy })).title).toBe('A Movie Field')
    expect(resolveTitle(showInput({ metadata: { metadata: { title: 'A Movie Field' }, metadataSource: 'A' } })).title).toBe(SHOW)
    expect(resolveTitle(input({ metadata: { metadata: { name: 'A Show Field' }, metadataSource: 'A' } })).title).toBe(FOLDER)
  })

  it('is the folder name when the metadata has no name, credited to the best server with the folder', () => {
    for (const metadata of [{}, { name: '' }, { name: '   ' }, { name: 7 }, null, undefined]) {
      const outcome = resolveTitle(showInput({ metadata: { metadata, metadataSource: 'B' }, serverConfig: server('A') }))
      expect(outcome).toMatchObject({ title: SHOW, titleSource: 'A' })
    }
    // B's pass names no source while A has the folder; with A gone, B is credited.
    expect(resolveTitle(showInput({ metadata: { metadata: {} } })).titleSource).toBeUndefined()
    expect(resolveTitle(showInput({ metadata: { metadata: {} }, fieldAvailability: showAvailability('B') })).titleSource).toBe('B')
  })

  it('keys the availability on the show\'s folder under `tv`, never under `movies`', () => {
    const elsewhere = { movies: { [SHOW]: { 'urls.mp4': ['A'] } }, tv: {} }
    const outcome = resolveTitle(showInput({ metadata: { metadata: {} }, fieldAvailability: elsewhere, serverConfig: server('A') }))
    expect(outcome.titleSource).toBeUndefined()
  })
})

describe('resolveTitle: the source', () => {
  it('is the metadata\'s source when the title is the metadata\'s, whichever server is syncing', () => {
    expect(resolveTitle(input({ serverConfig: server('B') })).titleSource).toBe('A')
    expect(resolveTitle(input({ serverConfig: server('A') })).titleSource).toBe('A')
  })

  it('is the highest-priority server that has the folder when the title is the folder name', () => {
    const noTitle = { metadata: {}, metadataSource: 'B' }
    expect(resolveTitle(input({ metadata: noTitle, serverConfig: server('A') })).titleSource).toBe('A')
    // Another server's pass leaves it.
    expect(resolveTitle(input({ metadata: noTitle, serverConfig: server('B') })).titleSource).toBeUndefined()
  })

  it('fails closed: a server that does not have the folder is never credited', () => {
    const noTitle = { metadata: {} }
    // A outranks B but has no folder this run: B is credited.
    expect(resolveTitle(input({ metadata: noTitle, fieldAvailability: availability('B'), serverConfig: server('B') })).titleSource).toBe('B')
    expect(resolveTitle(input({ metadata: noTitle, fieldAvailability: availability('B'), serverConfig: server('A') })).titleSource).toBeUndefined()
    // Nobody has it.
    expect(resolveTitle(input({ metadata: noTitle, fieldAvailability: { movies: {}, tv: {} }, serverConfig: server('A') })).titleSource).toBeUndefined()
  })

  it('breaks equal priorities on server id', () => {
    const noTitle = { metadata: {} }
    const tie = availability('B', 'C')
    expect(resolveTitle(input({ metadata: noTitle, fieldAvailability: tie, serverConfig: server('B') })).titleSource).toBe('B')
    expect(resolveTitle(input({ metadata: noTitle, fieldAvailability: tie, serverConfig: server('C') })).titleSource).toBeUndefined()
  })

  it('is undefined for a metadata title whose copy names no source', () => {
    expect(resolveTitle(input({ metadata: { metadata: { title: 'The Film' } } })).titleSource).toBeUndefined()
  })
})

describe('resolveTitle: what to write', () => {
  it('writes both on a new document', () => {
    expect(resolveTitle(input())).toEqual({ title: 'The Film', titleSource: 'A', writeTitle: true, writeTitleSource: true })
  })

  it('writes nothing when the document already holds both', () => {
    const outcome = resolveTitle(input({ stored: { title: 'The Film', titleSource: 'A' } }))
    expect(outcome).toMatchObject({ writeTitle: false, writeTitleSource: false })
  })

  it('writes only what differs', () => {
    expect(resolveTitle(input({ stored: { title: FOLDER, titleSource: 'A' } }))).toMatchObject({ writeTitle: true, writeTitleSource: false })
    expect(resolveTitle(input({ stored: { title: 'The Film', titleSource: 'B' } }))).toMatchObject({ writeTitle: false, writeTitleSource: true })
  })

  it('keeps a locked title\'s source (the title itself is dropped at the write chokepoint)', () => {
    const outcome = resolveTitle(input({ stored: { title: 'Admin Title', titleSource: 'B' }, locks: { title: true } }))
    expect(outcome).toMatchObject({ title: 'The Film', writeTitle: true, writeTitleSource: false })
  })

  it('writes no source when this pass does not say one', () => {
    const outcome = resolveTitle(input({ metadata: { metadata: {} }, serverConfig: server('B'), stored: { title: FOLDER, titleSource: 'A' } }))
    expect(outcome).toMatchObject({ title: FOLDER, titleSource: undefined, writeTitle: false, writeTitleSource: false })
  })
})
