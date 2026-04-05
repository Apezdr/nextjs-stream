/**
 * Script to replace console.log/warn/error with syncLogger calls
 * in the movie sync strategy files.
 * Run: node scripts/fix-strategy-logging.js
 */
const fs = require('fs')
const path = require('path')

const strategyDir = path.join(__dirname, '..', 'src', 'utils', 'sync', 'domain', 'movies', 'strategies')
const files = [
  'MovieMetadataStrategy.ts',
  'MovieAssetStrategy.ts',
  'MovieContentStrategy.ts'
]

const SYNC_LOGGER_IMPORT = `import { syncLogger } from '../../../core/logger'`

for (const filename of files) {
  const filePath = path.join(strategyDir, filename)
  let content = fs.readFileSync(filePath, 'utf8')
  const original = content

  // 1. Add syncLogger import if not already present
  if (!content.includes("from '../../../core/logger'")) {
    // Insert after the last import from '../../../core'
    content = content.replace(
      /} from '\.\.\/\.\.\/\.\.\/core'\n(?!\nimport { syncLogger)/,
      `} from '../../../core'\n\n${SYNC_LOGGER_IMPORT}\n`
    )
  }

  // 2. Replace console.log(...) with syncLogger.debug(...)
  //    but NOT inside DEBUG_SYNC-gated blocks (those become unconditional debug)
  content = content.replace(/console\.log\(/g, 'syncLogger.debug(')

  // 3. Replace console.warn(...) with syncLogger.warn(...)
  content = content.replace(/console\.warn\(/g, 'syncLogger.warn(')

  // 4. Replace console.error(...) with syncLogger.error(...)
  content = content.replace(/console\.error\(/g, 'syncLogger.error(')

  // 5. For MovieContentStrategy: remove DEBUG_SYNC gating around comparison logs
  //    The blocks look like:
  //      const debugEnabled = process.env.DEBUG_SYNC === 'true';
  //      if (debugEnabled) {
  //        syncLogger.debug(...)
  //      }
  //    We replace the whole debugEnabled-gated structure with plain syncLogger.debug calls
  //    Pattern: remove "const debugEnabled = ..." and "if (debugEnabled) {" and closing "}"
  if (filename === 'MovieContentStrategy.ts') {
    // Remove debugEnabled variable declarations
    content = content.replace(/\s*\/\/ Enable detailed logging with DEBUG_SYNC=true env var\s*\n\s*const debugEnabled = process\.env\.DEBUG_SYNC === 'true';\s*\n/g, '\n')
    
    // Replace "if (debugEnabled) {" with block contents dedented (simplistic approach: just remove the gate)
    // We'll do a multi-pass approach for each debugEnabled block
    let changed = true
    while (changed) {
      changed = false
      // Match: if (debugEnabled) {\n ... \n    }  (single-level block)
      const debugBlockRe = /if \(debugEnabled\) \{([\s\S]*?)\n( {4,})\}/g
      const newContent = content.replace(debugBlockRe, (match, innerBlock) => {
        changed = true
        // Dedent by removing 2 extra spaces from each line of innerBlock
        return innerBlock.replace(/\n  /g, '\n')
      })
      if (newContent !== content) {
        content = newContent
        changed = true
      }
    }
  }

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8')
    console.log(`Updated: ${filename}`)
  } else {
    console.log(`No changes needed: ${filename}`)
  }
}

console.log('Done!')
