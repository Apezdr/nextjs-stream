/**
 * The `@removeAtVersion` markers and the version comparison the guard test
 * (__tests__/removeAtVersion.test.js) runs. See that file for the rule.
 */

const fs = require('fs')
const path = require('path')

/** The file types scanned. */
const SCANNED = /\.(js|jsx|ts|tsx|mjs|cjs)$/

/** A marker: the tag, a version, and the sentence after it. */
const MARKER = /@removeAtVersion(?:\s+(\S+))?(.*)$/

/**
 * A version's numeric segments ("2026.09.01" → [2026, 9, 1]), or null when it
 * is not dot-separated digits. npm's semver is not used: it rejects the
 * leading zeros this repo's calendar versions have.
 *
 * @param {string} version
 * @returns {number[]|null}
 */
function parseVersion(version) {
  if (typeof version !== 'string' || !/^\d+(\.\d+)*$/.test(version)) return null
  return version.split('.').map(Number)
}

/**
 * Compare two versions segment by segment, a missing segment counting as 0.
 *
 * @returns {number} Negative when a < b, 0 when equal, positive when a > b
 */
function compareVersions(a, b) {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) throw new Error(`not a version: ${!x ? a : b}`)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/** Every scanned file under `dir`, node_modules left out. */
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...filesUnder(full))
    else if (SCANNED.test(entry.name)) out.push(full)
  }
  return out
}

/**
 * Every marker in the files under `dirs`. A marker's sentence is the rest of
 * its line and the comment lines after it, up to a blank comment line, the
 * next tag or the comment's end.
 *
 * @param {string[]} dirs - Absolute directories to scan
 * @param {string} root - What file names are reported relative to
 * @returns {Array<{file: string, line: number, version: string|null, sentence: string}>}
 */
function findMarkers(dirs, root) {
  const markers = []
  for (const file of dirs.flatMap(filesUnder)) {
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
    lines.forEach((text, i) => {
      const match = MARKER.exec(text)
      if (!match) return
      const parts = [match[2].replace(/\*\/\s*$/, '').trim()]
      // Continued only on the JSDoc lines that follow (` * ...`)
      for (let j = i + 1; j < lines.length && !/\*\//.test(lines[j - 1]); j++) {
        if (!/^\s*\*(?!\/)/.test(lines[j])) break
        const next = lines[j].replace(/^\s*\*\s?/, '').replace(/\*\/\s*$/, '').trim()
        if (!next || next.startsWith('@')) break
        parts.push(next)
      }
      markers.push({
        file: path.relative(root, file).split(path.sep).join('/'),
        line: i + 1,
        version: match[1] ?? null,
        sentence: parts.filter(Boolean).join(' '),
      })
    })
  }
  return markers
}

/**
 * What the guard reports: the markers whose version the current one has
 * reached, and the markers whose version does not parse.
 *
 * @param {Array<{version: string|null}>} markers
 * @param {string} currentVersion
 * @returns {{ overdue: Array<Object>, malformed: Array<Object> }}
 */
function checkMarkers(markers, currentVersion) {
  const malformed = markers.filter((marker) => !parseVersion(marker.version))
  const overdue = markers.filter(
    (marker) => parseVersion(marker.version) && compareVersions(currentVersion, marker.version) >= 0
  )
  return { overdue, malformed }
}

/** One line per marker, as `file:line version sentence`. */
const describeMarker = (marker) => `${marker.file}:${marker.line} ${marker.version ?? '(no version)'} ${marker.sentence}`

module.exports = { parseVersion, compareVersions, findMarkers, checkMarkers, describeMarker }
