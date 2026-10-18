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
 * The check parses the source (the TypeScript parser, for .ts and .js
 * alike): each module's static imports, re-exports, require() and import()
 * calls are followed through `src/`. A type-only import is erased at compile
 * time and is not followed. Every module reached is also scanned for I/O it
 * reaches for itself: the global fetch (called, or reached through
 * globalThis/window/global/self), XMLHttpRequest, eval or new Function, and a
 * require() or import() of a computed module, which cannot be followed. So a
 * module that uses the global fetch (src/utils/conditionalFetch.js, or any
 * other) fails the check when a builder reaches it, without being listed.
 */

const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')

/** The modules the builders are made of. */
const BUILDER_MODULES = [
  'src/utils/sync/domain/movies/metadata.ts',
  'src/utils/sync/domain/movies/artwork.ts',
  'src/utils/sync/domain/movies/video.ts',
  'src/utils/sync/domain/movies/videoPayload.ts',
  'src/utils/sync/domain/movies/step.ts',
  'src/utils/sync/domain/tv/showPlan.ts',
  'src/utils/sync/domain/tv/seasonPlan.ts',
  'src/utils/sync/domain/tv/episodePlan.ts',
  'src/utils/sync/domain/tv/blurhashFile.ts',
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

const GLOBALS = ['globalThis', 'window', 'global', 'self']
const GLOBAL_IO = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'eval', 'Function']
const literal = (node) => node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
const allTypeOnly = (elements) => elements.length > 0 && elements.every((element) => element.isTypeOnly)

// A name that is not a reference: a property, a method or a declaration's name.
function isNamePosition(node) {
  const parent = node.parent
  if (!parent) return false
  if ((ts.isPropertyAccessExpression(parent) || ts.isQualifiedName(parent)) && (parent.name === node || parent.right === node)) return true
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isGetAccessor(parent) || ts.isSetAccessor(parent)) && parent.name === node) return true
  return (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) && parent.propertyName === node
}

/**
 * One module's value imports, and the I/O it reaches for itself (each with
 * its line). The global fetch counts unless the module declares a `fetch`
 * of its own.
 */
function scan(file) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JSX
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, kind)
  const imports = []
  const io = []
  const declared = new Set()
  const at = (node, what) => io.push(`${relative(file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1} ${what}`)
  const references = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      const typeOnly = clause && (clause.isTypeOnly ||
        (!clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) && allTypeOnly(clause.namedBindings.elements)))
      if (!typeOnly) imports.push(node.moduleSpecifier.text)
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const typeOnly = node.isTypeOnly || (node.exportClause && ts.isNamedExports(node.exportClause) && allTypeOnly(node.exportClause.elements))
      if (!typeOnly) imports.push(node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && !node.isTypeOnly) {
      imports.push(node.moduleReference.expression.text)
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isRequire = ts.isIdentifier(callee) && callee.text === 'require'
      if (isRequire || callee.kind === ts.SyntaxKind.ImportKeyword) {
        if (literal(node.arguments[0])) imports.push(node.arguments[0].text)
        else at(node, `${isRequire ? 'require' : 'import'}() of a computed module`)
      }
      if (ts.isIdentifier(callee) && (callee.text === 'eval' || callee.text === 'Function')) at(node, `${callee.text}()`)
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && GLOBAL_IO.includes(node.expression.text)) {
      at(node, `new ${node.expression.text}()`)
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && GLOBALS.includes(node.expression.text) && GLOBAL_IO.includes(node.name.text)) {
      at(node, `${node.expression.text}.${node.name.text}`)
    } else if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && GLOBALS.includes(node.expression.text) &&
      (literal(node.argumentExpression) ? GLOBAL_IO.includes(node.argumentExpression.text) : true)) {
      at(node, `${node.expression.text}[...]`)
    } else if (ts.isIdentifier(node) && ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].includes(node.text) && !isNamePosition(node)) {
      const parent = node.parent
      const declares = (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) ||
        ts.isBindingElement(parent) || ts.isImportSpecifier(parent) || ts.isImportClause(parent)) && parent.name === node
      if (declares) declared.add(node.text)
      else references.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  for (const node of references) if (!declared.has(node.text)) at(node, `the global ${node.text}`)
  return { imports, io }
}

function resolveSpecifier(specifier, fromFile) {
  if (specifier.startsWith('@src/')) return { file: resolveFile(path.join(SRC, specifier.slice('@src/'.length))) }
  if (specifier.startsWith('.')) return { file: resolveFile(path.resolve(path.dirname(fromFile), specifier)) }
  const parts = specifier.replace(/^node:/, '').split('/')
  return { pkg: specifier.startsWith('@') ? parts.slice(0, 2).join('/') : specifier.replace(/^node:/, '') }
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/')

/**
 * Every module reached from `entry` and the chain that reaches each, the
 * packages reached, and the I/O any reached module reaches for itself.
 */
function closure(entry) {
  const reached = new Map([[entry, [relative(entry)]]])
  const packages = new Map()
  const io = []
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()
    const { imports, io: uses } = scan(file)
    for (const use of uses) io.push([...reached.get(file).slice(0, -1), use].join(' -> '))
    for (const specifier of imports) {
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
  return { reached, packages, io }
}

/** What makes a module's closure do I/O: the I/O modules and packages it reaches, and the I/O any reached module uses itself. */
function ioReachedFrom(file) {
  const { reached, packages, io } = closure(file)
  const offending = [...io]
  for (const [reachedFile, chain] of reached) {
    const name = relative(reachedFile).replace(/\.(tsx?|jsx?|mjs)$/, '')
    if (IO_MODULES.some((module) => (module.endsWith('/') ? name.startsWith(module) : name === module))) offending.push(chain.join(' -> '))
  }
  for (const [pkg, chain] of packages) if (IO_PACKAGES.includes(pkg)) offending.push(chain.join(' -> '))
  return offending
}

describe('the builders do no I/O', () => {
  it.each(BUILDER_MODULES)('%s reaches no I/O', (module) => {
    expect(ioReachedFrom(path.join(ROOT, module))).toEqual([])
  })

  it('sees a module that uses the global fetch without a list naming it: src/utils/conditionalFetch.js', () => {
    expect(ioReachedFrom(path.join(ROOT, 'src/utils/conditionalFetch.js'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^src\/utils\/conditionalFetch\.js:\d+ the global fetch$/)])
    )
  })

  it.each([
    'src/utils/sync/domain/movies/MovieSyncService.ts',
    'src/utils/sync/domain/tv/TVShowSyncService.ts',
    'src/utils/sync/domain/tv/SeasonSyncService.ts',
    'src/utils/sync/domain/tv/EpisodeSyncService.ts',
  ])('would see an I/O import: %s, which runs builders, reaches the prefetch step and the file fetch', (service) => {
    const { reached } = closure(path.join(ROOT, service))
    const names = [...reached.keys()].map(relative)
    expect(names).toContain('src/utils/sync/infrastructure/fileSystem/prefetch.ts')
    expect(names).toContain('src/utils/sync/infrastructure/fileSystem/fetchFile.ts')
  })
})
