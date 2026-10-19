/**
 * An in-memory MongoDB with just enough of the driver for a whole sync run:
 * the repositories, pre-tag, the tick skip check, title selection, post-sync
 * cleanup and the record of applied passes. Like MongoDB it stores a field set
 * to `undefined` as `null`, and hands out copies. Deletes are logged
 * (`collection.deleted`), so a test can compare what two runs deleted.
 */

const isEqual = require('lodash/isEqual')

const DATE_FIELDS = [
  'createdAt', 'updatedAt', 'lastSynced', 'initialDiscoveryDate', 'mediaLastModified',
  'airDate', 'firstAirDate', 'lastAirDate', 'startedAt', 'recordedAt', 'timestamp',
]

const stored = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)))

function clone(doc) {
  const copy = JSON.parse(JSON.stringify(doc))
  for (const field of DATE_FIELDS) {
    if (typeof copy[field] === 'string') copy[field] = new Date(copy[field])
  }
  return copy
}

const read = (doc, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc)

/** A value as stored, comparable with a query operand (dates and ObjectIds as stored). */
function comparable(value, operand) {
  if (operand instanceof Date) return value == null ? value : new Date(value)
  return value
}
const idText = (value) => (value && typeof value.toHexString === 'function' ? value.toHexString() : value)
const same = (value, operand) => {
  const a = idText(value)
  const b = idText(operand)
  if (b instanceof Date) return a != null && new Date(a).getTime() === b.getTime()
  return isEqual(a, b)
}

function matchesOperators(value, condition) {
  return Object.entries(condition).every(([op, operand]) => {
    const v = comparable(value, operand)
    switch (op) {
      case '$in': return operand.some((candidate) => (candidate === null ? value == null : same(value, candidate)))
      case '$nin': return !operand.some((candidate) => (candidate === null ? value == null : same(value, candidate)))
      case '$ne': return operand === null ? value != null : !same(value, operand)
      case '$eq': return operand === null ? value == null : same(value, operand)
      case '$exists': return (value !== undefined) === Boolean(operand)
      case '$lt': return v != null && v < operand
      case '$lte': return v != null && v <= operand
      case '$gt': return v != null && v > operand
      case '$gte': return v != null && v >= operand
      case '$type': return operand === 'string' ? typeof value === 'string' : operand === 'object' ? value !== null && typeof value === 'object' : false
      default: throw new Error(`memoryMongo: unsupported operator ${op}`)
    }
  })
}

function matches(doc, filter = {}) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((branch) => matches(doc, branch))
    if (key === '$and') return condition.every((branch) => matches(doc, branch))
    if (key === '$nor') return !condition.some((branch) => matches(doc, branch))
    const value = read(doc, key)
    if (condition instanceof RegExp) return typeof value === 'string' && condition.test(value)
    if (condition === null) return value == null
    if (condition instanceof Date || typeof condition !== 'object' || typeof condition.toHexString === 'function') {
      return same(value, condition)
    }
    if (!Object.keys(condition).some((k) => k.startsWith('$'))) return isEqual(value, condition)
    return matchesOperators(value, condition)
  })
}

function setPath(doc, path, value) {
  const keys = path.split('.')
  let target = doc
  for (const key of keys.slice(0, -1)) {
    if (target[key] == null || typeof target[key] !== 'object') target[key] = {}
    target = target[key]
  }
  target[keys[keys.length - 1]] = value
}

function unsetPath(doc, path) {
  const keys = path.split('.')
  const parent = keys.slice(0, -1).reduce((value, key) => (value == null ? undefined : value[key]), doc)
  if (parent && typeof parent === 'object') delete parent[keys[keys.length - 1]]
}

function applyUpdate(doc, update) {
  const setKeys = Object.keys(update.$set || {})
  const unsetKeys = Object.keys(update.$unset || {})
  const conflict = setKeys.filter((k) => unsetKeys.includes(k))
  if (conflict.length > 0) throw new Error(`conflicting $set/$unset on ${conflict.join(', ')}`)
  for (const [path, value] of Object.entries(stored(update.$set || {}))) setPath(doc, path, value)
  for (const path of unsetKeys) unsetPath(doc, path)
  for (const [path, by] of Object.entries(update.$inc || {})) setPath(doc, path, (read(doc, path) || 0) + by)
}

/** The plain equality fields of a filter (what an upsert inserts). */
const equalityFields = (filter) =>
  Object.fromEntries(
    Object.entries(filter).filter(([key, condition]) =>
      !key.startsWith('$') && !key.includes('.') &&
      (condition === null || typeof condition !== 'object' || condition instanceof Date || typeof condition.toHexString === 'function'))
  )

function createMemoryMongo() {
  const databases = {}
  let nextId = 1

  function collection(dbName, name) {
    databases[dbName] = databases[dbName] || {}
    if (databases[dbName][name]) return databases[dbName][name]
    const c = {
      docs: [],
      deleted: [],
      async createIndex() { return 'index' },
      async createIndexes() { return [] },
      async indexes() { return [] },
      async findOne(filter = {}) {
        const doc = c.docs.find((d) => matches(d, filter))
        return doc ? clone(doc) : null
      },
      find(filter = {}) {
        let found = c.docs.filter((d) => matches(d, filter))
        const cursor = {
          sort(spec) {
            const entries = Object.entries(spec)
            found = [...found].sort((a, b) => {
              for (const [field, direction] of entries) {
                const x = read(a, field)
                const y = read(b, field)
                if (x === y) continue
                return (x < y ? -1 : 1) * direction
              }
              return 0
            })
            return cursor
          },
          limit(n) {
            found = found.slice(0, n)
            return cursor
          },
          project() { return cursor },
          async toArray() { return found.map(clone) },
        }
        return cursor
      },
      async countDocuments(filter = {}) { return c.docs.filter((d) => matches(d, filter)).length },
      async estimatedDocumentCount() { return c.docs.length },
      async distinct(field, filter = {}) {
        return [...new Set(c.docs.filter((d) => matches(d, filter)).map((d) => read(d, field)))]
      },
      async updateOne(filter, update, options = {}) {
        const doc = c.docs.find((d) => matches(d, filter))
        if (!doc) {
          if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 }
          const created = { _id: `id${nextId++}`, ...stored(equalityFields(filter)), ...stored(update.$setOnInsert || {}) }
          applyUpdate(created, update)
          c.docs.push(created)
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: created._id }
        }
        const before = JSON.stringify(doc)
        applyUpdate(doc, update)
        return { matchedCount: 1, modifiedCount: JSON.stringify(doc) === before ? 0 : 1 }
      },
      async updateMany(filter, update) {
        let modifiedCount = 0
        for (const doc of c.docs.filter((d) => matches(d, filter))) {
          const before = JSON.stringify(doc)
          applyUpdate(doc, update)
          if (JSON.stringify(doc) !== before) modifiedCount++
        }
        return { modifiedCount }
      },
      async replaceOne(filter, replacement, options = {}) {
        const index = c.docs.findIndex((d) => matches(d, filter))
        if (index >= 0) {
          c.docs[index] = { _id: c.docs[index]._id, ...stored(replacement) }
          return { matchedCount: 1 }
        }
        if (options.upsert) c.docs.push({ _id: `id${nextId++}`, ...stored(replacement) })
        return { matchedCount: 0 }
      },
      async insertOne(doc) {
        const copy = { _id: `id${nextId++}`, ...stored(doc) }
        c.docs.push(copy)
        return { insertedId: copy._id }
      },
      async insertMany(docs) {
        for (const doc of docs) await c.insertOne(doc)
        return { insertedCount: docs.length }
      },
      async deleteOne(filter) {
        const index = c.docs.findIndex((d) => matches(d, filter))
        if (index < 0) return { deletedCount: 0 }
        c.deleted.push(...c.docs.splice(index, 1))
        return { deletedCount: 1 }
      },
      async deleteMany(filter = {}) {
        const gone = c.docs.filter((d) => matches(d, filter))
        c.docs = c.docs.filter((d) => !matches(d, filter))
        c.deleted.push(...gone)
        return { deletedCount: gone.length }
      },
      async bulkWrite(operations) {
        let modifiedCount = 0
        for (const op of operations) {
          if (op.updateOne) modifiedCount += (await c.updateOne(op.updateOne.filter, op.updateOne.update, { upsert: op.updateOne.upsert })).modifiedCount || 0
          else if (op.updateMany) modifiedCount += (await c.updateMany(op.updateMany.filter, op.updateMany.update)).modifiedCount
          else if (op.insertOne) await c.insertOne(op.insertOne.document)
          else if (op.deleteOne) await c.deleteOne(op.deleteOne.filter)
          else if (op.deleteMany) await c.deleteMany(op.deleteMany.filter)
          else if (op.replaceOne) await c.replaceOne(op.replaceOne.filter, op.replaceOne.replacement, { upsert: op.replaceOne.upsert })
          else throw new Error(`memoryMongo: unsupported bulk operation ${Object.keys(op)}`)
        }
        return { modifiedCount }
      },
      aggregate(pipeline) {
        let rows = c.docs.map(clone)
        for (const stage of pipeline) {
          if (stage.$match) rows = rows.filter((d) => matches(d, stage.$match))
          else if (stage.$group) {
            const { _id: by, ...accumulators } = stage.$group
            if (typeof by !== 'string' || !by.startsWith('$')) throw new Error('memoryMongo: $group by a field only')
            const groups = new Map()
            for (const row of rows) {
              const value = read(row, by.slice(1))
              const groupKey = JSON.stringify(value ?? null)
              if (!groups.has(groupKey)) groups.set(groupKey, { _id: value ?? null })
              const group = groups.get(groupKey)
              for (const [field, spec] of Object.entries(accumulators)) {
                if (!isEqual(spec, { $sum: 1 })) throw new Error('memoryMongo: only {$sum: 1}')
                group[field] = (group[field] || 0) + 1
              }
            }
            rows = [...groups.values()]
          } else {
            throw new Error(`memoryMongo: unsupported stage ${Object.keys(stage)}`)
          }
        }
        return { toArray: async () => rows }
      },
    }
    databases[dbName][name] = c
    return c
  }

  const client = { db: (dbName) => ({ collection: (name) => collection(dbName, name) }) }
  return { client, collection, databases }
}

module.exports = { createMemoryMongo, matches, stored }
