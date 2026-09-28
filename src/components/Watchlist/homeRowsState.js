/**
 * State for the home screen rows editor: `rows` in home-screen order and
 * `available`, the playlists that could become rows. Kept out of the
 * components so the editor's moves can be tested on their own.
 */
import { moveItemToPosition } from './reorder'

export const MAX_ROW_TITLE_LENGTH = 100

// Group order in the "Add a row" list
const RELATION_ORDER = ['yours', 'shared', 'public', 'others']

function draftRow(row) {
  return {
    id: row.playlistId, // moveItemToPosition finds rows by `id`
    playlistId: row.playlistId,
    appTitle: row.appTitle || '',
    hideUnavailable: !!row.hideUnavailable,
    playlist: row.playlist,
  }
}

// What saving would send, flattened, to tell edited rows from saved ones
function signature(rows) {
  return JSON.stringify(rows.map((row) => [row.playlistId, row.appTitle.trim(), row.hideUnavailable]))
}

export function sortAvailable(playlists) {
  return [...playlists].sort(
    (a, b) =>
      RELATION_ORDER.indexOf(a.relation) - RELATION_ORDER.indexOf(b.relation) ||
      a.name.localeCompare(b.name) ||
      a.ownerName.localeCompare(b.ownerName)
  )
}

/** Editor state from GET /api/authenticated/home-rows. */
export function editorStateFrom(data) {
  const rows = (data?.rows || []).map(draftRow)
  return { rows, available: sortAvailable(data?.available || []), saved: signature(rows) }
}

export const emptyEditorState = { rows: [], available: [], saved: signature([]) }

export function homeRowsReducer(state, action) {
  switch (action.type) {
    case 'load':
      return editorStateFrom(action.data)
    case 'saved':
      // The rows as they stand are now the saved ones
      return { ...state, saved: signature(state.rows) }
    case 'add': {
      const playlist = state.available.find((candidate) => candidate.id === action.playlistId)
      if (!playlist) return state
      return {
        ...state,
        rows: [...state.rows, draftRow({ playlistId: playlist.id, hideUnavailable: playlist.hideUnavailable, playlist })],
        available: state.available.filter((candidate) => candidate.id !== playlist.id),
      }
    }
    case 'remove': {
      const row = state.rows.find((candidate) => candidate.id === action.playlistId)
      if (!row) return state
      return {
        ...state,
        rows: state.rows.filter((candidate) => candidate.id !== row.id),
        // Its library choice goes with it, as the server keeps it
        available: sortAvailable([...state.available, { ...row.playlist, hideUnavailable: row.hideUnavailable }]),
      }
    }
    case 'move': {
      const from = state.rows.findIndex((row) => row.id === action.playlistId)
      const to = from + action.offset
      if (from === -1 || to < 0 || to >= state.rows.length) return state
      return { ...state, rows: moveItemToPosition(state.rows, action.playlistId, state.rows[to].id) }
    }
    case 'moveTo': {
      const rows = moveItemToPosition(state.rows, action.playlistId, action.targetId)
      return rows ? { ...state, rows } : state
    }
    case 'title':
      return {
        ...state,
        rows: state.rows.map((row) =>
          row.id === action.playlistId ? { ...row, appTitle: action.value.slice(0, MAX_ROW_TITLE_LENGTH) } : row
        ),
      }
    case 'library':
      return {
        ...state,
        rows: state.rows.map((row) => (row.id === action.playlistId ? { ...row, hideUnavailable: !row.hideUnavailable } : row)),
      }
    default:
      return state
  }
}

export function hasChanges(state) {
  return signature(state.rows) !== state.saved
}

/** The body PUT /api/authenticated/home-rows takes. */
export function rowsToSave(state) {
  return state.rows.map((row) => ({
    playlistId: row.playlistId,
    appTitle: row.appTitle.trim() || null,
    hideUnavailable: row.hideUnavailable,
  }))
}

const GROUP_LABELS = {
  self: { yours: 'Your playlists', shared: 'Shared with you', public: 'Public', others: "Other people's" },
  person: { yours: 'Their playlists', shared: 'Shared with them', public: 'Public', others: "Other people's" },
}

/**
 * The available playlists in groups, filtered by `query` (playlist or owner
 * name). "Other people's", which only admins have, shows `previewCount` until
 * expanded, unless a search is narrowing it.
 */
export function groupAvailable(available, { query = '', perspective = 'self', expandOthers = false, previewCount = 3 } = {}) {
  const needle = query.trim().toLowerCase()
  const matches = (playlist) =>
    !needle || playlist.name.toLowerCase().includes(needle) || playlist.ownerName.toLowerCase().includes(needle)
  const labels = GROUP_LABELS[perspective] || GROUP_LABELS.self

  return RELATION_ORDER.map((relation) => {
    const items = available.filter((playlist) => playlist.relation === relation && matches(playlist))
    const collapse = relation === 'others' && !expandOthers && !needle && items.length > previewCount
    return {
      relation,
      label: labels[relation],
      items: collapse ? items.slice(0, previewCount) : items,
      hiddenCount: collapse ? items.length - previewCount : 0,
    }
  }).filter((group) => group.items.length > 0)
}

/** "by you" for your own playlists, otherwise "by <owner>". */
export function ownerLabel(playlist, perspective = 'self') {
  return playlist.relation === 'yours' && perspective === 'self' ? 'by you' : `by ${playlist.ownerName}`
}

export function itemCountLabel(count) {
  return count === 1 ? '1 item' : `${count} items`
}

export function initialsOf(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

// A steady color per person, from shades that keep white initials readable
const AVATAR_COLORS = [
  'bg-indigo-600', 'bg-teal-700', 'bg-amber-700', 'bg-sky-700', 'bg-rose-700', 'bg-violet-700',
  'bg-emerald-700', 'bg-yellow-700', 'bg-pink-800', 'bg-blue-700', 'bg-lime-700',
]

export function avatarColor(key) {
  let hash = 0
  for (const char of String(key || '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}
