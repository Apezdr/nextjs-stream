import { auth } from '@src/lib/auth'
import { getFullImageUrl } from '@src/utils'
import clientPromise from '@src/lib/mongodb'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { getRecentlyWatchedForUser, fetchRecentlyAdded } from '@src/utils/auth_database'
import { ObjectId } from 'mongodb'

export async function getRequestedMediaTrailer(type, title, season = null, episode = null) {
  const client = await clientPromise
  const collection = type === 'movie' ? 'Movies' : 'TV'

  if (type === 'movie') {
    // Fetch movie
    const projection = { _id: 0 }
    const DBmovie = await client
      .db('Media')
      .collection(collection)
      .findOne({ title: title }, { projection })

    if (DBmovie.metadata && DBmovie.metadata.trailer_url) {
      DBmovie.videoURL =
        DBmovie && DBmovie.metadata.trailer_url ? DBmovie.metadata.trailer_url : null
      DBmovie.captionURLs = null
      DBmovie.chapterURL = null
    } else {
      DBmovie.videoURL = null
      DBmovie.captionURLs = null
      DBmovie.chapterURL = null
    }
    return DBmovie
  } else if (type === 'tv') {
    const DBtvShow = await getTvShowData(client, collection, title, season, episode)
    await processBlurhashes(DBtvShow)

    if (DBtvShow.metadata && DBtvShow.metadata.trailer_url) {
      // Fetch YouTube trailer
      DBtvShow.videoURL = DBtvShow.metadata.trailer_url
      DBtvShow.captionURLs = null
      DBtvShow.chapterURL = null
    } else {
      DBtvShow.videoURL = null
      DBtvShow.captionURLs = null
      DBtvShow.chapterURL = null
    }

    return DBtvShow
  }

  return null
}

export async function getRequestedMedia({
  type,
  title = null,
  season = null,
  episode = null,
  id = null,
}) {
  const client = await clientPromise
  const collection = type === 'movie' ? 'Movies' : 'TV'

  if (type === 'movie') {
    // Fetch movie
    const projection = { _id: 0 }
    const query = {}
    if (title) query.title = title
    if (id) query._id = new ObjectId(id)

    if (!title && !id) return null

    const DBmovie = await client.db('Media').collection(collection).findOne(query, { projection })
    await processBlurhashes(DBmovie, type)

    return { type: type, ...DBmovie }
  } else if (type === 'tv') {
    const DBtvShow = await getTvShowData(client, collection, title, season, episode, id)
    await processBlurhashes(DBtvShow, type)
    return { type: type, ...DBtvShow }
  }

  return null
}

async function getTvShowData(client, collection, title, season, episode, id) {
  const projection = { _id: 0 }
  const query = {}
  if (title) query.title = title
  if (id) query._id = new ObjectId(id)

  if (!title && !id) return null

  const tvShow = await client.db('Media').collection(collection).findOne(query, { projection })

  if (!tvShow) return null

  if (season) {
    const seasonNumber = parseInt(season.replace('Season ', ''))
    const seasonObj = tvShow.seasons.find((s) => s.seasonNumber === seasonNumber)

    if (!seasonObj) return null
    if (!seasonObj.metadata) seasonObj.metadata = {}
    seasonObj.metadata.backdrop_path = seasonObj.metadata.backdrop_path || tvShow.backdrop

    if (episode) {
      const episodeNumber = parseInt(episode.replace('Episode ', ''))
      const episodeData = handleEpisode(tvShow, seasonObj, episodeNumber)
      return episodeData
    } else {
      // Handle season-specific logic
      seasonObj.posterURL =
        seasonObj.posterURL ||
        seasonObj.season_poster ||
        tvShow.posterURL ||
        getFullImageUrl(tvShow.metadata.poster_path)
      seasonObj.title = tvShow.title
      seasonObj.metadata.tvOverview = tvShow.metadata.overview
      if (tvShow.metadata.trailer_url) seasonObj.metadata.trailer_url = tvShow.metadata.trailer_url
      return seasonObj
    }
  } else {
    // Return the entire TV show if no season is specified
    await processBlurhashes(tvShow)
    return tvShow
  }
}
function handleEpisode(tvShow, seasonObj, episodeNumber) {
  const episodeMetadata = seasonObj.metadata.episodes?.find(
    (ep) => ep.episode_number === episodeNumber
  )
  const episodeObj = seasonObj.episodes?.find((ep) => ep.episodeNumber === episodeNumber)

  if (episodeObj && !episodeMetadata) return episodeObj
  if (!episodeObj || !episodeMetadata) return null

  episodeObj.title = tvShow.title
  episodeObj.logo = tvShow.logo
  episodeObj.metadata = { ...episodeObj.metadata, ...episodeMetadata }
  episodeObj.metadata.backdrop_path = episodeObj.metadata.backdrop_path || tvShow.backdrop
  episodeObj.posterURL = seasonObj.season_poster || tvShow.posterURL || tvShow.metadata.poster_path
  episodeObj.posterBlurhash = seasonObj.seasonPosterBlurhash || tvShow.posterBlurhash || null

  if (seasonObj.seasonPosterBlurhashSource) {
    episodeObj.blurhashSource = seasonObj.seasonPosterBlurhashSource
  } else if (tvShow.posterBlurhash) {
    episodeObj.blurhashSource = tvShow.posterBlurhash
  }

  if (tvShow?.metadata?.rating) {
    episodeObj.metadata.rating = tvShow.metadata.rating
  }

  if (tvShow?.metadata?.trailer_url) {
    episodeObj.metadata.trailer_url = tvShow.metadata.trailer_url
  }

  const nextAvailableEpisode = seasonObj.metadata.episodes?.find(
    (ep) => ep.episode_number > episodeNumber
  )
  if (nextAvailableEpisode) {
    episodeObj.hasNextEpisode = true
    episodeObj.nextEpisodeThumbnail = nextAvailableEpisode.still_path
    episodeObj.nextEpisodeTitle = nextAvailableEpisode.name
    episodeObj.nextEpisodeNumber = nextAvailableEpisode.episode_number
  } else {
    episodeObj.hasNextEpisode = false
  }

  return episodeObj
}

async function processBlurhashes(media, type) {
  if (media?.posterBlurhash) {
    if (media.posterBlurhash.startsWith('http')) {
      media.posterBlurhash = await fetchMetadataMultiServer(
        media.blurhashSource,
        media.posterBlurhash,
        'blurhash',
        type,
        media.title
      )
    }
  }

  if (media?.backdropBlurhash) {
    if (media.backdropBlurhash.startsWith('http')) {
      media.backdropBlurhash = await fetchMetadataMultiServer(
        media.backdropBlurhashSource,
        media.backdropBlurhash,
        'blurhash',
        type,
        media.title
      )
    }
  }
}

export async function getAvailableMedia({ type = 'all' } = {}) {
  const client = await clientPromise
  let moviesCount, tvprogramsCount
  let returnValue = {}
  const db = client.db('Media')

  if (type === 'movie' || type === 'all') {
    moviesCount = await db.collection('Movies').countDocuments()
    returnValue.moviesCount = moviesCount
  }

  if (type === 'tv' || type === 'all') {
    tvprogramsCount = await db.collection('TV').countDocuments()
    returnValue.tvprogramsCount = tvprogramsCount
  }

  if (type === 'recently-added' || type === 'all') {
    const [movies, tvShows] = await Promise.all([
      fetchRecentlyAdded({ db: db, collectionName: 'Movies', countOnly: true }),
      fetchRecentlyAdded({ db: db, collectionName: 'TV', countOnly: true }),
    ])

    returnValue.recentlyaddedCount = movies + tvShows
  }

  if (type === 'recently-watched' || type === 'all') {
    const session = await auth()
    const watched = await getRecentlyWatchedForUser({ userId: session.user?.id, countOnly: true })

    returnValue.recentlywatchedCount = watched
  }

  return returnValue
}

export async function getLastUpdatedTimestamp({ type, title = '' }) {
  const client = await clientPromise
  const collectionName = type === 'tv' ? 'MediaUpdatesTV' : 'MediaUpdatesMovie'

  const lastUpdatedDoc = await client
    .db('Media')
    .collection(collectionName)
    .find({ title })
    .sort({ _id: -1 })
    .limit(1)
    .toArray()

  return lastUpdatedDoc[0]?.lastUpdated.toISOString() || new Date().toISOString()
}
