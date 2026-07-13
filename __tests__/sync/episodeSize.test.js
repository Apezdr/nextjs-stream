import {
  parseEpisodeNumberFromKey,
  resolveEpisodeSize,
} from '@src/utils/sync/episodeSize'

describe('resolveEpisodeSize', () => {
  it.each([
    [{ size: 1234 }, 1234, 'size'],
    [{ additionalMetadata: { size: 4321 } }, 4321, 'additionalMetadata.size'],
    [{ additionalMetadata: { size: { kb: 2 } } }, 2048, 'additionalMetadata.size.kb'],
    [{ additionalMetadata: { size: { mb: 1.5 } } }, 1572864, 'additionalMetadata.size.mb'],
    [{ additionalMetadata: { size: { gb: 2 } } }, 2147483648, 'additionalMetadata.size.gb'],
  ])('converts %p to bytes and preserves its availability path', (input, bytes, fieldSuffix) => {
    expect(resolveEpisodeSize(input)).toEqual({ bytes, fieldSuffix })
  })

  it('prefers the most precise largest reported unit deterministically', () => {
    expect(resolveEpisodeSize({
      additionalMetadata: { size: { gb: 1, mb: 900, kb: 100 } },
    })).toEqual({
      bytes: 1073741824,
      fieldSuffix: 'additionalMetadata.size.gb',
    })
  })

  it.each([
    {},
    { size: '1234' },
    { additionalMetadata: { size: {} } },
    { additionalMetadata: { size: { kb: Number.NaN } } },
  ])('fails closed for missing or ambiguous size data: %p', (input) => {
    expect(resolveEpisodeSize(input)).toBeNull()
  })
})

describe('parseEpisodeNumberFromKey', () => {
  it.each([
    ['S01E02', {}, 2],
    ['S02E05 - Episode.mkv', {}, 5],
    ['episode_12', {}, 12],
    ['07 - Episode.mkv', {}, 7],
    ['S01E02', { episodeNumber: 9 }, 9],
  ])('parses %p without confusing the season number', (key, data, expected) => {
    expect(parseEpisodeNumberFromKey(key, data)).toBe(expected)
  })
})
