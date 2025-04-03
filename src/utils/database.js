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

    if (DBmovie?.metadata?.cast) {
      DBmovie.cast = DBmovie.metadata.cast
    }

    return { type: type, ...DBmovie }
  } else if (type === 'tv') {
    const DBtvShow = await getTvShowData(client, collection, title, season, episode, id)
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
      const episodeData = handleEpisode(tvShow, seasonObj, seasonNumber, episodeNumber)
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
    // Handle Cast
    if (tvShow.metadata.cast) {
      // Initialize a Map to store unique guest stars by their ID
      const compiledGuestStarsMap = new Map();

      // Iterate over each season
      for (const seasonObj of tvShow.seasons) {
        if (seasonObj.metadata.episodes) {
          // Iterate over each episode in the season
          for (const episode of seasonObj.metadata.episodes) {
            if (episode?.guest_stars && Array.isArray(episode?.guest_stars)) {
              // Iterate over each guest star in the episode
              for (const castMember of episode.guest_stars) {
                // Add the guest star to the Map if not already present
                if (!compiledGuestStarsMap.has(castMember.id)) {
                  compiledGuestStarsMap.set(castMember.id, castMember);
                }
              }
            }
          }
        }
      }

      // Convert the Map values to an array of unique guest stars
      const uniqueGuestStars = Array.from(compiledGuestStarsMap.values());

      // Combine the main cast with the unique guest stars
      // Using spread operator within an array to concatenate
      tvShow.cast = [
        ...(tvShow.metadata.cast || []), // Main cast
        ...uniqueGuestStars             // Guest stars
      ];

      // Optional: If you want to ensure all cast members are unique based on ID
      // (In case there are overlapping IDs between main cast and guest stars)
      const uniqueCastMap = new Map();
      tvShow.cast.forEach(castMember => {
        if (!uniqueCastMap.has(castMember.id)) {
          uniqueCastMap.set(castMember.id, castMember);
        }
      });
      tvShow.cast = Array.from(uniqueCastMap.values());
    }
    return tvShow
  }
}
function handleEpisode(tvShow, seasonObj, seasonNumber, episodeNumber) {
  const seasonMetadata = seasonObj.metadata ?? {
    episodes: [],
  }
  const episodeMetadata = seasonMetadata?.episodes?.find(
    (ep) => ep?.episode_number === episodeNumber
  )
  const episodeObj = seasonObj.episodes?.find((ep) => ep.episodeNumber === episodeNumber)

  //if (episodeObj && !episodeMetadata) return episodeObj
  if (!episodeObj && !episodeMetadata) return null

  episodeObj.title = tvShow.title
  episodeObj.logo = tvShow.logo
  episodeObj.metadata = { ...episodeObj.metadata, ...episodeMetadata }
  episodeObj.metadata.backdrop_path = episodeObj.metadata.backdrop_path || tvShow.backdrop
  episodeObj.posterURL = seasonObj.season_poster || tvShow.posterURL || tvShow.metadata.poster_path
  episodeObj.posterBlurhash = seasonObj.seasonPosterBlurhash || tvShow.posterBlurhash || null
  episodeObj.seasonNumber = seasonNumber
  episodeObj.episodeNumber = episodeNumber

  // For the info page
  if (tvShow.thumbnail) episodeObj.thumbnail = tvShow.thumbnail
  if (tvShow.backdrop) episodeObj.backdrop = tvShow.backdrop
  if (tvShow.backdropSource) episodeObj.backdropSource = tvShow.backdropSource
  if (tvShow.backdropBlurhash) {
    episodeObj.backdropBlurhash = tvShow.backdropBlurhash
    episodeObj.backdropBlurhashSource = tvShow.backdropBlurhashSource
  }
  if (episodeObj.thumbnail) episodeObj.backdrop = episodeObj.thumbnail
  if (episodeObj.thumbnailSource) episodeObj.backdropSource = episodeObj.thumbnailSource
  if (episodeObj.thumbnailBlurhash) {
    episodeObj.backdropBlurhash = episodeObj.thumbnailBlurhash
    episodeObj.backdropBlurhashSource = episodeObj.thumbnailBlurhashSource
  }
  
  // Handle Cast
  // if (tvShow.metadata.cast || episodeObj.metadata.guest_stars) {
  if (tvShow.metadata.cast) {
    // Merge cast from tvShow.metadata.cast and episodeObj.metadata.guest_stars
    // Filter out duplicates based on the id property
    // episodeObj.cast = [
    //   ...(tvShow.metadata.cast || []),
    //   ...(episodeObj.metadata.guest_stars || [])
    // ].filter((item, index, self) =>
    //   index === self.findIndex((t) => (
    //     t.id === item.id
    //   ))
    // )
    const guestStars = episodeObj.metadata?.guest_stars || [];
    const mainCast = tvShow.metadata.cast || [];

    // Create a map of guest stars for quick lookup
    const guestStarsMap = new Map(guestStars.map(star => [star.id, star]));

    // Filter out guest stars from the main cast
    const filteredMainCast = mainCast.filter(castMember => !guestStarsMap.has(castMember.id));

    // Combine filtered main cast with guest stars
    episodeObj.cast = filteredMainCast;
  }

  if (seasonObj.seasonPosterBlurhashSource) {
    episodeObj.posterBlurhashSource = seasonObj.seasonPosterBlurhashSource
  } else if (tvShow.posterBlurhash) {
    episodeObj.posterBlurhashSource = tvShow.posterBlurhash
  }

  if (tvShow?.metadata?.rating) {
    episodeObj.metadata.rating = tvShow.metadata.rating
  }

  if (tvShow?.metadata?.trailer_url) {
    episodeObj.metadata.trailer_url = tvShow.metadata.trailer_url
  }

  const nextAvailableEpisode = seasonMetadata?.episodes?.find(
    (ep) => ep?.episode_number > episodeNumber
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
