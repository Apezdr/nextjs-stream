import {
  getDefaultVisibleColumns,
  getMediaColumnDefinitions,
  groupMediaByServer,
  groupMediaItems,
} from '@src/components/Admin/Media/mediaBrowserConfig'

test('Server Name is default only when more than one server is configured', () => {
  const single = getMediaColumnDefinitions('movie', false)
  const multiple = getMediaColumnDefinitions('movie', true)
  expect(single.map(column => column.id)).not.toContain('server')
  expect(getDefaultVisibleColumns(multiple)).toContain('server')
})

test('TV columns remain independently configurable', () => {
  expect(getMediaColumnDefinitions('tv', true).map(column => column.id)).toEqual([
    'poster', 'originalTitle', 'server', 'quality', 'years', 'seasons', 'episodes', 'video', 'hdr', 'flags',
  ])
})

test('multi-source shows get one explicit group instead of being duplicated', () => {
  const groups = groupMediaByServer([
    { id: 'one', serverIds: ['default'] },
    { id: 'two', serverIds: ['default', 'server2'] },
  ], [
    { id: 'default', displayName: 'Local' },
    { id: 'server2', displayName: 'Remote' },
  ], true)

  expect(groups).toEqual([
    { key: 'default', label: 'Local', items: [{ id: 'one', serverIds: ['default'] }] },
    { key: 'multiple', label: 'Multiple servers', items: [{ id: 'two', serverIds: ['default', 'server2'] }] },
  ])
})

test('groups multi-quality TV shows once under Mixed quality', () => {
  expect(groupMediaItems([
    { id: 'show', qualities: ['1080p', '4K'] },
  ], 'quality', [])).toEqual([
    { key: 'quality:Mixed quality', label: 'Mixed quality', items: [{ id: 'show', qualities: ['1080p', '4K'] }] },
  ])
})