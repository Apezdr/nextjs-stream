/**
 * A cast's live session names the cast device everywhere it shows: the
 * shared LiveSession label (admin overview, desktop widget, transcoder
 * viewers) and the admin device badge.
 */
import { render } from '@testing-library/react'
import { describeDevice } from '@src/utils/playbackPresence/session'
import { getDeviceTypeLabel } from '@src/utils/deviceDetection'
import DeviceBadge from '@components/Admin/DeviceBadge'

it('labels a cast session "Cast"', () => {
  expect(getDeviceTypeLabel('cast')).toBe('Cast')
  expect(describeDevice({ type: 'cast' })).toEqual({
    type: 'cast',
    label: 'Cast',
    platform: 'Cast',
    userAgent: null,
  })
})

it('draws a cast badge, with no browser or TV maker beside it', () => {
  const { container } = render(<DeviceBadge deviceType="cast" size="small" />)
  const badge = container.firstChild
  expect(badge).not.toBeNull()
  expect(badge.getAttribute('title')).toBe('Last watched on a Cast device')
  expect(container.querySelectorAll('svg')).toHaveLength(1)
  expect(container.querySelectorAll('img')).toHaveLength(0)
})
