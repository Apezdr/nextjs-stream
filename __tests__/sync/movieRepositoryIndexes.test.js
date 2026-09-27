/**
 * @jest-environment node
 *
 * The /list banner sorts FlatMovies by metadata.release_date and takes 8. The
 * index for that was declared only in flatSync/initializeDatabase.js, which
 * the new sync architecture never runs, so production scanned and sorted
 * every movie on each banner query (16.5 ms of a 40 ms request). The new-arch
 * repository has to create it, under the same name, so a copy that already
 * exists is accepted rather than a conflict.
 */

const { MovieRepository } = require('@src/utils/sync/infrastructure/database/MovieRepository')

const repositoryWith = (createIndex) =>
  new MovieRepository({ db: () => ({ collection: () => ({ createIndex }) }) })

it('creates the release-date index the banner sorts on', async () => {
  const createIndex = jest.fn(async () => 'ok')
  await expect(repositoryWith(createIndex).createIndexes()).resolves.toBe(true)

  expect(createIndex).toHaveBeenCalledWith({ 'metadata.release_date': -1 }, { name: 'release_date_index' })
})

it('accepts the index when it already exists', async () => {
  const createIndex = jest.fn(async (spec) => {
    if (spec['metadata.release_date']) {
      throw Object.assign(new Error('Index already exists with a different name'), { code: 85 })
    }
    return 'ok'
  })

  await expect(repositoryWith(createIndex).createIndexes()).resolves.toBe(true)
})
