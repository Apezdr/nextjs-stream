/**
 * @jest-environment node
 *
 * Guards: the browser keeps no copy of a playback position in its storage.
 *
 * The web used to mirror positions into localStorage, keyed by title and by
 * no user: the next account on a shared browser saw the last one's bars and
 * resumed from them, and a fast clock beat newer positions from other
 * devices. The positions store (components/WatchProgress/playbackStore.js)
 * holds them in memory for the document's user now, and the player asks the
 * server where to start. These guards keep the mirror from coming back: not
 * its helpers, not its poll, and no localStorage in any file that touched it.
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(entry.name) ? [full] : []
  })
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/')
const files = sourceFiles(SRC).map((file) => ({ file: relative(file), source: fs.readFileSync(file, 'utf8') }))

/** The mirror's key helpers, its clearing, its poll and the route the poll read. */
const MIRROR_NAMES = ['getPlaybackStorageKey', 'readWithLegacyFallback', 'clearPlaybackMirror', 'SyncClientWithServerWatched', 'pullPlayback']

/** Every file that read or wrote the mirror, and the store that replaced it. */
const ONCE_TOUCHED_THE_MIRROR = [
  'src/components/built-in/WithPlaybackTracker.js',
  'src/components/Cast/CastPositionMirror.jsx',
  'src/components/WatchProgress/markWatched.js',
  'src/components/WatchProgress/useLiveProgress.js',
  'src/components/WatchProgress/useWatchPosition.js',
  'src/components/useWatchedWidth.js',
  'src/components/watched.js',
  'src/components/MediaPlayer/resumePosition.js',
  'src/components/MediaPlayer/useResumePosition.js',
  'src/components/WatchProgress/playbackStore.js',
]

it('scans the source tree', () => {
  expect(files.length).toBeGreaterThan(500)
})

it.each(MIRROR_NAMES)('nothing under src names %s, in code or in a comment', (name) => {
  expect(files.filter(({ source }) => source.includes(name)).map(({ file }) => file)).toEqual([])
})

it('the mirror’s files are gone', () => {
  for (const gone of [
    'src/components/SyncClientWithServerWatched.js',
    'src/utils/playbackStorageKey.js',
    'src/app/api/authenticated/sync/pullPlayback/route.js',
  ]) {
    expect([gone, fs.existsSync(path.join(ROOT, gone))]).toEqual([gone, false])
  }
})

it.each(ONCE_TOUCHED_THE_MIRROR)('%s does not mention localStorage', (file) => {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8')
  expect(source).not.toMatch(/localStorage/)
  // Nor any other storage the whole browser shares
  expect(source).not.toMatch(/sessionStorage|indexedDB|document\.cookie/)
})

it('the positions store listens for no storage event: nothing is put back into storage for another tab to hear', () => {
  const store = fs.readFileSync(path.join(SRC, 'components', 'WatchProgress', 'playbackStore.js'), 'utf8')
  expect(store).not.toMatch(/addEventListener\(\s*['"]storage['"]/)
  expect(store).not.toMatch(/setInterval|setTimeout/)
})
