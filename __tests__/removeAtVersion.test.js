/**
 * @jest-environment node
 *
 * Expiring migrations. A self-applying migration that only cleans up what an
 * older version left behind must not live forever: it carries, in its JSDoc,
 *
 *   @removeAtVersion <version> <one sentence: what removing it means>
 *
 * where <version> is the repo's next minor version when the migration was
 * written. Once package.json's `version` reaches it, this test fails and
 * lists every overdue marker as file:line. Then delete what the sentence names
 * (the function, its call, its tests) and the marker with it; do not move the
 * version on unless the owner says the cleanup must stay longer.
 *
 * Versions compare numerically, segment by segment (2026.09.01 < 2026.10.0),
 * not with npm's semver, which rejects the leading zeros of this repo's
 * calendar versions. A marker whose version does not parse fails too.
 * Scanned: src/ and scripts/ (.js, .jsx, .ts, .tsx, .mjs, .cjs).
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  parseVersion,
  compareVersions,
  findMarkers,
  checkMarkers,
  describeMarker,
} = require('./helpers/removeAtVersion')

const ROOT = path.join(__dirname, '..')

describe('the repository’s @removeAtVersion markers', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const markers = findMarkers([path.join(ROOT, 'src'), path.join(ROOT, 'scripts')], ROOT)

  it('reads a version from package.json', () => {
    expect(parseVersion(version)).not.toBeNull()
  })

  it('are all well formed', () => {
    expect(checkMarkers(markers, version).malformed.map(describeMarker)).toEqual([])
  })

  it(`are none of them due at version ${version}: delete what an overdue one names`, () => {
    expect(checkMarkers(markers, version).overdue.map(describeMarker)).toEqual([])
  })

  it('include the one-off cleanups due at 2026.10.0', () => {
    const due = (file, sentence) =>
      expect.objectContaining({ file, version: '2026.10.0', sentence: expect.stringContaining(sentence) })
    expect(markers).toEqual(
      expect.arrayContaining([
        due('src/utils/sync/run/dropTitleHashes.js', 'Title-hash cleanup'),
        due('src/utils/notifications/notificationDatabase.js', 'readAt backfill'),
        due('src/utils/notifications/notificationDatabase.js', 'Unused Notifications index drop'),
      ])
    )
  })

  it('leave the permanent mechanisms unmarked: the new-content baseline and the index reconcile', () => {
    const permanent = ['src/utils/sync/run/newContent.js', 'src/utils/sync/infrastructure/database/indexReconcile.ts']
    expect(markers.filter((marker) => permanent.includes(marker.file))).toEqual([])
  })
})

describe('compareVersions', () => {
  it.each([
    ['2026.09.01', '2026.10.0', -1],
    ['2026.10.0', '2026.10.0', 0],
    ['2026.10', '2026.10.0', 0],
    ['2026.10.1', '2026.10.0', 1],
    ['2026.9.30', '2026.10.0', -1],
    ['2027.01.01', '2026.10.0', 1],
    ['1.0.1', '1.1.0', -1],
  ])('%s against %s', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign)
  })

  it('refuses what is not a version', () => {
    expect(parseVersion('2026.10.x')).toBeNull()
    expect(parseVersion('v1.2.3')).toBeNull()
    expect(parseVersion('')).toBeNull()
    expect(() => compareVersions('next', '1.0.0')).toThrow('not a version: next')
  })
})

describe('the scan and the check', () => {
  let dir
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-at-version-'))
    fs.mkdirSync(path.join(dir, 'lib'))
    fs.mkdirSync(path.join(dir, 'node_modules'))
    fs.writeFileSync(
      path.join(dir, 'lib', 'cleanup.js'),
      [
        '/**',
        ' * Drops an old field.',
        ' *',
        ' * @removeAtVersion 2026.10.0 Old-field cleanup; delete this function',
        ' *   and its call when the version reaches 2026.10.0.',
        ' * @returns {Promise<void>}',
        ' */',
        'export async function dropOldField() {}',
        '',
        '// @removeAtVersion 2026.11 One line; the code after it is not part of the sentence.',
        'export const after = 1',
        '/** @removeAtVersion soon Not a version. */',
      ].join('\n')
    )
    fs.writeFileSync(path.join(dir, 'lib', 'notes.md'), '@removeAtVersion 1.0.0 not a scanned file type')
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep.js'), '// @removeAtVersion 0.0.1 a dependency')
  })
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('finds each marker with its file, line, version and sentence, outside node_modules and other file types', () => {
    expect(findMarkers([dir], dir)).toEqual([
      {
        file: 'lib/cleanup.js',
        line: 4,
        version: '2026.10.0',
        sentence: 'Old-field cleanup; delete this function and its call when the version reaches 2026.10.0.',
      },
      {
        file: 'lib/cleanup.js',
        line: 10,
        version: '2026.11',
        sentence: 'One line; the code after it is not part of the sentence.',
      },
      { file: 'lib/cleanup.js', line: 12, version: 'soon', sentence: 'Not a version.' },
    ])
  })

  it('passes below a marker’s version, and fails at it and above, naming file:line and the sentence', () => {
    const markers = findMarkers([dir], dir).filter((marker) => marker.version !== 'soon')

    expect(checkMarkers(markers, '2026.09.01').overdue).toEqual([])
    expect(checkMarkers(markers, '2026.10.0').overdue.map(describeMarker)).toEqual([
      'lib/cleanup.js:4 2026.10.0 Old-field cleanup; delete this function and its call when the version reaches 2026.10.0.',
    ])
    expect(checkMarkers(markers, '2026.12.01').overdue.map((marker) => marker.line)).toEqual([4, 10])
  })

  it('fails on a marker whose version does not parse', () => {
    const { malformed } = checkMarkers(findMarkers([dir], dir), '2026.09.01')
    expect(malformed.map(describeMarker)).toEqual(['lib/cleanup.js:12 soon Not a version.'])
  })
})
