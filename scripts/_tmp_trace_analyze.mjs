// Temp analyzer for a SigNoz trace dump. Safe, read-only. Delete after use.
import fs from 'node:fs'

const p = process.argv[2]
const raw = JSON.parse(fs.readFileSync(p, 'utf8'))
const rows = raw?.data?.data?.results?.[0]?.rows ?? []
const spans = rows.map((r) => r.data).filter(Boolean)

const byId = new Map(spans.map((s) => [s.spanID, s]))
const roots = spans.filter((s) => !s.parentSpanID || !byId.has(s.parentSpanID))

const ns = (n) => (n / 1e6).toFixed(1) + 'ms'

// Aggregate by span name
const byName = {}
for (const s of spans) {
  const k = s.name || '(noname)'
  byName[k] ??= { count: 0, sum: 0, max: 0 }
  byName[k].count++
  byName[k].sum += s.durationNano || 0
  byName[k].max = Math.max(byName[k].max, s.durationNano || 0)
}
const nameRows = Object.entries(byName)
  .map(([k, v]) => ({ name: k, count: v.count, sumMs: +(v.sum / 1e6).toFixed(1), maxMs: +(v.max / 1e6).toFixed(1) }))
  .sort((a, b) => b.sumMs - a.sumMs)

// DB ops by operation+collection
const byDb = {}
for (const s of spans) {
  if (!s['db.system']) continue
  const k = `${s['db.operation'] || '?'} ${s['db.mongodb.collection'] || s['db.name'] || '?'}`
  byDb[k] ??= { count: 0, sum: 0, max: 0 }
  byDb[k].count++
  byDb[k].sum += s.durationNano || 0
  byDb[k].max = Math.max(byDb[k].max, s.durationNano || 0)
}
const dbRows = Object.entries(byDb)
  .map(([k, v]) => ({ op: k, count: v.count, sumMs: +(v.sum / 1e6).toFixed(1), maxMs: +(v.max / 1e6).toFixed(1) }))
  .sort((a, b) => b.count - a.count)

// span kinds
const kinds = {}
for (const s of spans) kinds[s.spanKind || s.kind] = (kinds[s.spanKind || s.kind] || 0) + 1

console.log('TOTAL_SPANS', spans.length)
console.log('ROOT_COUNT', roots.length)
const topRoots = [...roots].sort((a,b)=>b.durationNano-a.durationNano).slice(0,5)
console.log('TOP_ROOTS_BY_DUR', topRoots.map((r) => ({ name: r.name, durMs: +(r.durationNano / 1e6).toFixed(1) })))
console.log('SPAN_KINDS', kinds)
console.log('\n=== DB OPS BY COUNT (this trace) ===')
for (const r of dbRows) console.log(`cnt=${r.count}\tsum=${r.sumMs}ms\tmax=${r.maxMs}ms\t${r.op}`)
console.log('\n=== TOP SPAN NAMES BY CUMULATIVE TIME ===')
for (const r of nameRows.slice(0, 30)) console.log(`${r.sumMs}ms\tcnt=${r.count}\tmax=${r.maxMs}ms\t${r.name}`)
console.log('\n=== DB OPS BY COUNT ===')
for (const r of dbRows) console.log(`cnt=${r.count}\tsum=${r.sumMs}ms\tmax=${r.maxMs}ms\t${r.op}`)

// Root direct children (phases)
if (roots.length) {
  const rootId = roots[0].spanID
  const kids = spans.filter((s) => s.parentSpanID === rootId)
    .map((s) => ({ name: s.name, durMs: +(s.durationNano / 1e6).toFixed(1), ts: s.timestamp }))
    .sort((a, b) => b.durMs - a.durMs)
  console.log('\n=== ROOT DIRECT CHILDREN (phases) ===')
  for (const k of kids.slice(0, 30)) console.log(`${k.durMs}ms\t${k.name}`)
}
