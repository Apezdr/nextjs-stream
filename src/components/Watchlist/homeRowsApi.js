// Calls to the home screen rows routes (src/app/api/authenticated/home-rows)

async function send(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return data
}

const ROWS = '/api/authenticated/home-rows'
const PEOPLE = '/api/authenticated/home-rows/people'

export const homeRowsApi = {
  /** Your rows and the playlists you could add; someone else's for an admin. */
  load: (userId) => send(userId ? `${ROWS}?userId=${encodeURIComponent(userId)}` : ROWS),

  /** Replace the rows, in order. */
  save: (rows, userId) => send(ROWS, { method: 'PUT', body: JSON.stringify(userId ? { rows, userId } : { rows }) }),

  /** Admin: everyone, with how many rows they have. */
  people: () => send(PEOPLE),

  /** Admin: everyone, with where one playlist stands on their home screen. */
  playlistPeople: (playlistId) => send(`${PEOPLE}?playlistId=${encodeURIComponent(playlistId)}`),

  /** Admin: add a playlist to, or remove it from, people's home screens. */
  change: (body) => send(PEOPLE, { method: 'POST', body: JSON.stringify(body) }),
}
