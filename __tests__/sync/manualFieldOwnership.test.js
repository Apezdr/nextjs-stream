jest.mock('mongodb', () => ({}))

import {
  BaseRepository,
  getManualFieldUnsetPaths,
  removeConflictingUnsetPaths,
} from '@src/utils/sync/infrastructure/database/BaseRepository'

class TestRepository extends BaseRepository {
  static diff(existing, merged) {
    return this.computeDiff(existing, merged)
  }
}

const existing = {
  manualFields: {
    posterURL: true,
    videoURL: true,
    metadata: true,
    ignored: false,
  },
}

describe('getManualFieldUnsetPaths', () => {
  it('clears a marker when sync changes the primary field', () => {
    expect(getManualFieldUnsetPaths(existing, ['posterURL'])).toEqual([
      'manualFields.posterURL',
    ])
  })

  it('clears a marker when field-absence cleanup removes the primary field', () => {
    expect(getManualFieldUnsetPaths(existing, ['videoURL'])).toEqual([
      'manualFields.videoURL',
    ])
  })

  it('clears a marker when sync reclaims field provenance', () => {
    expect(getManualFieldUnsetPaths(existing, ['metadataSource', 'posterSource'])).toEqual([
      'manualFields.posterURL',
      'manualFields.metadata',
    ])
  })

  it('does not clear unrelated or false markers', () => {
    expect(getManualFieldUnsetPaths(existing, ['thumbnailSource'])).toEqual([])
  })
})

describe('removeConflictingUnsetPaths', () => {
  it('removes exact and parent/child conflicts while preserving safe unsets', () => {
    expect(removeConflictingUnsetPaths(
      ['thumbnail', 'metadata.overview'],
      ['thumbnail', 'thumbnailSource', 'metadata', 'manualFields.videoURL']
    )).toEqual(['thumbnailSource', 'manualFields.videoURL'])
  })
})

describe('repository ownership locks', () => {
  it('suppresses both a locked value and its source-marker change', () => {
    expect(TestRepository.diff(
      {
        thumbnail: 'manual.jpg',
        thumbnailSource: undefined,
        lockedFields: { thumbnail: true },
      },
      {
        thumbnail: 'server.jpg',
        thumbnailSource: 'server2',
        lockedFields: { thumbnail: true },
      }
    )).toEqual({})
  })

  it('suppresses shared video-info provenance when one affected value is locked', () => {
    expect(TestRepository.diff(
      {
        hdr: 'HDR10',
        videoInfoSource: 'default',
        lockedFields: { hdr: true },
      },
      {
        hdr: 'Dolby Vision',
        videoInfoSource: 'server2',
        lockedFields: { hdr: true },
      }
    )).toEqual({})
  })
})
