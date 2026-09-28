/**
 * The home screen rows editor, rendered with its real reducer: adding a
 * playlist makes it the last row, the arrows move rows, and removing puts the
 * playlist back in the list. jsdom applies no CSS, so the desktop and phone
 * versions of each row are both in the document; these tests use the desktop
 * controls, which come first.
 */
import { useEffect, useReducer } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import HomeRowsEditor from '@src/components/Watchlist/HomeRowsEditor'
import { editorStateFrom, homeRowsReducer, rowsToSave } from '@src/components/Watchlist/homeRowsState'

const playlist = (id, name, relation, ownerName) => ({
  id,
  name,
  relation,
  ownerName,
  ownerId: `owner-${id}`,
  itemCount: 2,
  privacy: 'private',
})

const DATA = {
  rows: [{ playlistId: 'p1', appTitle: '', hideUnavailable: false, playlist: playlist('p1', 'My Watchlist', 'yours', 'Morgan Me') }],
  available: [
    { ...playlist('p2', 'Movie Night', 'shared', 'Sam Rivera'), hideUnavailable: false },
    { ...playlist('p3', 'My Watchlist', 'others', 'Jordan Lee'), hideUnavailable: false },
  ],
}

// The editor's current state, reported after each render
let latest
const track = (state) => {
  latest = state
}

function Harness() {
  const [state, dispatch] = useReducer(homeRowsReducer, DATA, editorStateFrom)
  useEffect(() => track(state), [state])
  return <HomeRowsEditor state={state} dispatch={dispatch} />
}

const click = (element) => act(() => fireEvent.click(element))

it('shows who owns each playlist it offers', () => {
  render(<Harness />)
  const shared = screen.getByRole('region', { name: 'Shared with you' })
  expect(within(shared).getByText('by Sam Rivera · 2 items')).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: "Other people's" })).getByText('by Jordan Lee · 2 items')).toBeInTheDocument()
})

it('adds, moves and removes rows', () => {
  render(<Harness />)

  click(screen.getByRole('button', { name: 'Add Movie Night by Sam Rivera' }))
  expect(rowsToSave(latest).map((row) => row.playlistId)).toEqual(['p1', 'p2'])
  expect(screen.queryByRole('button', { name: 'Add Movie Night by Sam Rivera' })).not.toBeInTheDocument()

  click(screen.getAllByRole('button', { name: 'Move Movie Night by Sam Rivera up' })[0])
  expect(rowsToSave(latest).map((row) => row.playlistId)).toEqual(['p2', 'p1'])
  expect(screen.getAllByRole('button', { name: 'Move Movie Night by Sam Rivera up' })[0]).toBeDisabled()

  click(screen.getAllByRole('button', { name: 'Remove Movie Night by Sam Rivera from the home screen' })[0])
  expect(rowsToSave(latest).map((row) => row.playlistId)).toEqual(['p1'])
  expect(screen.getByRole('button', { name: 'Add Movie Night by Sam Rivera' })).toBeInTheDocument()
})

it('renames a row and switches it to library only', () => {
  render(<Harness />)

  const [title] = screen.getAllByRole('textbox', { name: 'Row title for My Watchlist by you' })
  act(() => fireEvent.change(title, { target: { value: 'Tonight' } }))
  click(screen.getAllByRole('switch', { name: "Only what's in the library" })[0])

  expect(rowsToSave(latest)).toEqual([{ playlistId: 'p1', appTitle: 'Tonight', hideUnavailable: true }])
})

it('says so when there are no rows', () => {
  render(<Harness />)
  click(screen.getAllByRole('button', { name: 'Remove My Watchlist by you from the home screen' })[0])
  expect(screen.getByText('No rows on your home screen')).toBeInTheDocument()
})
