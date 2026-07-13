jest.mock('@src/utils/config', () => ({
  getServer: jest.fn((serverId) => ({
    id: serverId,
    priority: serverId === 'default' ? 1 : 2,
  })),
  multiServerHandler: { getHandler: jest.fn() },
}))

jest.mock('@src/utils/sync/captions', () => ({
  sortSubtitleEntries: jest.fn(),
}))

import {
  filterLockedFields,
  isCurrentServerHighestPriorityForReportedField,
  isCurrentServerHighestPriorityForReportedFieldGroup,
} from '@src/utils/sync/utils'

describe('filterLockedFields ownership units', () => {
  it('filters a source update when its primary value is locked', () => {
    expect(filterLockedFields(
      { lockedFields: { thumbnail: true } },
      { thumbnail: 'new.jpg', thumbnailSource: 'server2', title: 'Episode' }
    )).toEqual({ title: 'Episode' })
  })
})

const fieldPath = 'seasons.Season 1.episodes.S01E01.additionalMetadata.size.gb'
const server = (id, priority) => ({ id, priority })

function availability(serverIds) {
  return {
    movies: {},
    tv: {
      'Filesystem Show': {
        [fieldPath]: serverIds,
      },
    },
  }
}

describe('isCurrentServerHighestPriorityForReportedField', () => {
  it('fails closed when the exact field path is missing', () => {
    expect(isCurrentServerHighestPriorityForReportedField(
      { movies: {}, tv: { 'Filesystem Show': {} } },
      'tv',
      'Filesystem Show',
      fieldPath,
      server('default', 1)
    )).toBe(false)
  })

  it('fails closed when the current server is absent from the reported path', () => {
    expect(isCurrentServerHighestPriorityForReportedField(
      availability(['default']),
      'tv',
      'Filesystem Show',
      fieldPath,
      server('server2', 2)
    )).toBe(false)
  })

  it('accepts the highest-priority server that reported the exact path', () => {
    expect(isCurrentServerHighestPriorityForReportedField(
      availability(['default', 'server2']),
      'tv',
      'Filesystem Show',
      fieldPath,
      server('default', 1)
    )).toBe(true)
  })

  it('rejects a lower-priority server even when it also reported the path', () => {
    expect(isCurrentServerHighestPriorityForReportedField(
      availability(['default', 'server2']),
      'tv',
      'Filesystem Show',
      fieldPath,
      server('server2', 2)
    )).toBe(false)
  })
})

describe('isCurrentServerHighestPriorityForReportedFieldGroup', () => {
  const kbPath = 'seasons.Season 1.episodes.S01E01.additionalMetadata.size.kb'
  const gbPath = 'seasons.Season 1.episodes.S01E01.additionalMetadata.size.gb'
  const groupedAvailability = {
    movies: {},
    tv: {
      'Filesystem Show': {
        [kbPath]: ['default'],
        [gbPath]: ['server2'],
      },
    },
  }

  it('accepts the highest-priority server across equivalent unit paths', () => {
    expect(isCurrentServerHighestPriorityForReportedFieldGroup(
      groupedAvailability,
      'tv',
      'Filesystem Show',
      [kbPath, gbPath],
      server('default', 1)
    )).toBe(true)
  })

  it('rejects a lower-priority server reporting a different unit path', () => {
    expect(isCurrentServerHighestPriorityForReportedFieldGroup(
      groupedAvailability,
      'tv',
      'Filesystem Show',
      [kbPath, gbPath],
      server('server2', 2)
    )).toBe(false)
  })
})
