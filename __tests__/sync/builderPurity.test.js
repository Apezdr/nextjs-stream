/**
 * @jest-environment node
 *
 * The builders do no I/O: no module a builder is made of imports, directly or
 * through another module, the file fetch, the prefetch step, the
 * repositories, the database, the cache or an HTTP client. The files a
 * builder reads are fetched by the prefetch step and handed to it
 * (core/resources); its writes go through the repositories, which the
 * services call.
 *
 * The check reads the source: each module's static imports, re-exports,
 * require() and import() calls are followed through `src/`. A type-only
 * import is erased at compile time and is not followed.
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')

/** The modules the builders are made of. */
const BUILDER_MODULES = [
  'src/utils/sync/domain/movies/metadata.ts',
  'src/utils/sync/domain/movies/artwork.ts',
  'src/utils/sync/domain/movies/video.ts',
  'src/utils/sync/domain/movies/videoPayload.ts',
  'src/utils/sync/domain/movies/step.ts',
]

/** I/O: modules under src (a path prefix), and packages. */
const IO_MODULES = [
  'src/utils/sync/infrastructure/fileSystem/fetchFile',
  'src/utils/sync/infrastructure/fileSystem/prefetch',
  'src/utils/sync/infrastructure/fileSystem/index',
  'src/utils/sync/infrastructure/index',
  'src/utils/sync/infrastructure/database/',
  'src/lib/httpHelper',
  'src/lib/cache',
  'src/lib/redisClient',
  'src/lib/mongodb',
  'src/utils/flatDatabaseUtils',
]
const IO_PACKAGES = ['mongodb', 'axios', 'got', 'node-fetch', 'undici', 'ioredis', 'redis', 'http', 'https', 'http2', 'net', 'fs', 'fs/promises', 'child_process']

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

function resolveFile(base) {
  for (const candidate of [base, ...EXTENSIONS.map((ext) => base + ext), ...EXTENSIONS.map((ext) => path.join(base, 'index' + ext))]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** The value imports of one module: [specifier, ...]. */
function importsOf(source) {
  const specifiers = []
  const statement = /(?:^|[\n;])\s*(import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g
  for (const match of source.matchAll(statement)) {
    if (match[2]) continue // import type / export type
    specifiers.push(match[4])
  }
  for (const match of source.matchAll(/(?:^|[\n;])\s*import\s+['"]([^'"]+)['"]/g)) specifiers.push(match[1])
  for (const match of source.matchAll(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1])
  return specifiers
}

function resolveSpecifier(specifier, fromFile) {
  if (specifier.startsWith('@src/')) return { file: resolveFile(path.join(SRC, specifier.slice('@src/'.length))) }
  if (specifier.startsWith('.')) return { file: resolveFile(path.resolve(path.dirname(fromFile), specifier)) }
  const parts = specifier.replace(/^node:/, '').split('/')
  return { pkg: specifier.startsWith('@') ? parts.slice(0, 2).join('/') : specifier.replace(/^node:/, '') }
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/')

/** Every module reached from `entry`, and the chain that reaches each. */
function closure(entry) {
  const reached = new Map([[entry, [relative(entry)]]])
  const packages = new Map()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()
    for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
      const { file: target, pkg } = resolveSpecifier(specifier, file)
      if (pkg) {
        if (!packages.has(pkg)) packages.set(pkg, [...reached.get(file), pkg])
        continue
      }
      if (!target) throw new Error(`Cannot resolve "${specifier}" from ${relative(file)}`)
      if (!reached.has(target)) {
        reached.set(target, [...reached.get(file), relative(target)])
        queue.push(target)
      }
    }
  }
  return { reached, packages }
}

describe('the builders do no I/O', () => {
  it.each(BUILDER_MODULES)('%s reaches no I/O module', (module) => {
    const { reached, packages } = closure(path.join(ROOT, module))
    const offending = []
    for (const [file, chain] of reached) {
      const name = relative(file).replace(/\.(tsx?|jsx?|mjs)$/, '')
      if (IO_MODULES.some((io) => (io.endsWith('/') ? name.startsWith(io) : name === io))) offending.push(chain.join(' -> '))
    }
    for (const [pkg, chain] of packages) if (IO_PACKAGES.includes(pkg)) offending.push(chain.join(' -> '))
    expect(offending).toEqual([])
  })

  it('would see an I/O import: the services that run the builders reach the prefetch step', () => {
    const { reached } = closure(path.join(ROOT, 'src/utils/sync/domain/movies/MovieSyncService.ts'))
    const names = [...reached.keys()].map(relative)
    expect(names).toContain('src/utils/sync/infrastructure/fileSystem/prefetch.ts')
    expect(names).toContain('src/utils/sync/infrastructure/fileSystem/fetchFile.ts')
  })
})
