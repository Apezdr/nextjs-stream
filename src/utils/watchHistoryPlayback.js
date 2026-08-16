export function buildWatchHistoryLibraryHref(item) {
  if (!item?.link || !['movie', 'tv'].includes(item.type)) return null
  // `link` is already encoded upstream and includes season/episode for TV.
  return `/list/${item.type}/${item.link}`
}

export function buildWatchHistoryPlaybackHref(item) {
  if (!item?.link || !['movie', 'tv'].includes(item.type)) return null

  const playbackTime = Number(item.playbackTime)
  const start = Number.isFinite(playbackTime) && playbackTime > 0
    ? Math.floor(playbackTime)
    : 0

  return `/list/${item.type}/${item.link}/play?start=${start}`
}

export function buildWatchHistoryAdminEditHref(item) {
  const id = item?._id || item?.id || item?.showId
  if (!id || !['movie', 'tv'].includes(item?.type)) return null

  const encodedId = encodeURIComponent(String(id))
  if (item.type === 'movie') return `/admin/media/movies/${encodedId}`

  const params = new URLSearchParams()
  if (Number.isInteger(Number(item.seasonNumber))) {
    params.set('season', String(Number(item.seasonNumber)))
  }
  if (Number.isInteger(Number(item.episodeNumber))) {
    params.set('episode', String(Number(item.episodeNumber)))
  }
  const query = params.toString()
  return `/admin/media/tv/${encodedId}${query ? `?${query}` : ''}`
}

export function formatPlaybackPosition(seconds) {
  const value = Number(seconds)
  if (!Number.isFinite(value) || value < 0) return '00:00'
  const totalSeconds = Math.floor(value)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60
  const tail = `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${tail}` : tail
}