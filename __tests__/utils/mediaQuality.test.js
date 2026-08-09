import { buildQualityFilter, getQualityLabel } from '@src/utils/mediaQuality'

test.each([
  ['3840x2160', '4K'],
  ['2560x1440', '1440p'],
  ['1920x800', '1080p'],
  ['1280x720', '720p'],
  ['720x480', 'SD'],
  [null, 'Unknown'],
])('classifies %p as %s', (dimensions, expected) => {
  expect(getQualityLabel(dimensions)).toBe(expected)
})

test('builds the quality filter against a requested field', () => {
  expect(buildQualityFilter('4K', 'episode.dimensions')).toEqual({
    'episode.dimensions': expect.any(RegExp),
  })
})