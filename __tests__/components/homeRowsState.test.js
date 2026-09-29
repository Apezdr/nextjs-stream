/**
 * The home screen rows editor's state: adding, removing, moving and renaming
 * rows, and what saving sends.
 */
import {
  editorStateFrom,
  groupAvailable,
  hasChanges,
  homeRowsReducer,
  initialsOf,
  ownerLabel,
  rowsToSave,
} from '@src/components/Watchlist/homeRowsState'

const playlist = (id, name, relation, ownerName = 'Sam Rivera', extra = {}) => ({
  id,
  name,
  relation,
  ownerName,
  ownerId: `owner-${ownerName}`,
  itemCount: 3,
  privacy: relation === 'public' ? 'public' : 'private',
  ...extra,
})

const MINE = playlist('p1', 'My Watchlist', 'yours', 'Morgan Me')
const SHARED = playlist('p2', 'Movie Night', 'shared')
const PUBLIC = playlist('p3', 'Staff Picks', 'public', 'Priya Shah')
const OTHERS = ['Jordan Lee', 'Alex Chen', 'Maria Gomez', 'Chris Park'].map((name, index) =>
  playlist(`o${index}`, 'My Watchlist', 'others', name)
)

const loaded = () =>
  editorStateFrom({
    rows: [
      { playlistId: 'p1', appTitle: '', hideUnavailable: false, playlist: MINE },
      { playlistId: 'p3', appTitle: 'Picks', hideUnavailable: true, playlist: PUBLIC },
    ],
    available: [{ ...SHARED, hideUnavailable: true }, ...OTHERS],
  })

const order = (state) => state.rows.map((row) => row.playlistId)

it('starts unchanged', () => {
  expect(hasChanges(loaded())).toBe(false)
})

it('adds a playlist as the last row, keeping its library choice', () => {
  const state = homeRowsReducer(loaded(), { type: 'add', playlistId: 'p2' })

  expect(order(state)).toEqual(['p1', 'p3', 'p2'])
  expect(state.rows[2]).toMatchObject({ appTitle: '', hideUnavailable: true })
  expect(state.available.map((entry) => entry.id)).not.toContain('p2')
  expect(hasChanges(state)).toBe(true)
})

it('removes a row, putting the playlist back among the others in its group', () => {
  const state = homeRowsReducer(loaded(), { type: 'remove', playlistId: 'p3' })

  expect(order(state)).toEqual(['p1'])
  expect(state.available.map((entry) => entry.id)).toEqual(['p2', 'p3', 'o1', 'o3', 'o0', 'o2'])
  expect(state.available.find((entry) => entry.id === 'p3').hideUnavailable).toBe(true)
})

it('moves rows up and down, and not past either end', () => {
  const down = homeRowsReducer(loaded(), { type: 'move', playlistId: 'p1', offset: 1 })
  expect(order(down)).toEqual(['p3', 'p1'])
  expect(homeRowsReducer(down, { type: 'move', playlistId: 'p3', offset: -1 })).toBe(down)
})

it('moves a row into the place of the one it is dropped on', () => {
  const three = homeRowsReducer(loaded(), { type: 'add', playlistId: 'p2' })
  const state = homeRowsReducer(three, { type: 'moveTo', playlistId: 'p2', targetId: 'p1' })
  expect(order(state)).toEqual(['p2', 'p1', 'p3'])
})

it('counts moving back to the saved order as no change', () => {
  const moved = homeRowsReducer(loaded(), { type: 'move', playlistId: 'p1', offset: 1 })
  const back = homeRowsReducer(moved, { type: 'move', playlistId: 'p1', offset: -1 })
  expect(hasChanges(back)).toBe(false)
})

it('renames and switches library-only, then sends blank titles as null', () => {
  let state = homeRowsReducer(loaded(), { type: 'title', playlistId: 'p1', value: '  Tonight  ' })
  state = homeRowsReducer(state, { type: 'title', playlistId: 'p3', value: '   ' })
  state = homeRowsReducer(state, { type: 'library', playlistId: 'p1' })

  expect(rowsToSave(state)).toEqual([
    { playlistId: 'p1', appTitle: 'Tonight', hideUnavailable: true },
    { playlistId: 'p3', appTitle: null, hideUnavailable: true },
  ])
})

it('caps a row title at 100 characters', () => {
  const state = homeRowsReducer(loaded(), { type: 'title', playlistId: 'p1', value: 'x'.repeat(150) })
  expect(state.rows[0].appTitle).toHaveLength(100)
})

it('takes the rows as saved after a save', () => {
  const edited = homeRowsReducer(loaded(), { type: 'library', playlistId: 'p1' })
  expect(hasChanges(homeRowsReducer(edited, { type: 'saved' }))).toBe(false)
})

describe('groupAvailable', () => {
  const available = [SHARED, PUBLIC, ...OTHERS]

  it("groups by how you stand with each playlist, and shows three of other people's until expanded", () => {
    const groups = groupAvailable(available)

    expect(groups.map((group) => [group.label, group.items.length, group.hiddenCount])).toEqual([
      ['Shared with you', 1, 0],
      ['Public', 1, 0],
      ["Other people's", 3, 1],
    ])
    expect(groupAvailable(available, { expandOthers: true })[2].items).toHaveLength(4)
  })

  it('searches playlist and owner names, showing every match', () => {
    expect(groupAvailable(available, { query: 'maria' })).toEqual([
      expect.objectContaining({ relation: 'others', items: [OTHERS[2]], hiddenCount: 0 }),
    ])
    expect(groupAvailable(available, { query: 'staff' }).map((group) => group.relation)).toEqual(['public'])
  })

  it("speaks about the person when an admin edits someone else's rows", () => {
    expect(groupAvailable([MINE, SHARED], { perspective: 'person' }).map((group) => group.label)).toEqual([
      'Their playlists',
      'Shared with them',
    ])
  })
})

it('says who owns a playlist', () => {
  expect(ownerLabel(MINE)).toBe('by you')
  expect(ownerLabel(MINE, 'person')).toBe('by Morgan Me')
  expect(ownerLabel(SHARED)).toBe('by Sam Rivera')
})

it('makes initials from a name', () => {
  expect(initialsOf('Jordan Lee')).toBe('JL')
  expect(initialsOf('Cher')).toBe('C')
  expect(initialsOf('  ')).toBe('?')
  expect(initialsOf('Mary Anne Smith')).toBe('MS')
})
