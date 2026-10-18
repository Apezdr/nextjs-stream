/**
 * The who-has-what map the sync ranks field ownership on:
 * `fieldAvailability[mediaType][originalTitle][leafPath] = [serverId, ...]`.
 *
 * A server is listed for a leaf path when its payload HAS A VALUE there. A
 * leaf that is null, undefined or an empty string is not a value and is not
 * recorded. It used to be: a file server publishes a show's `poster`, `logo`,
 * `backdrop` and `metadata` as explicit keys whether or not the folder has
 * them, so the main server "reported" a logo it did not have. That
 *
 *  - kept a lower-priority server's real logo (or metadata) from ever being
 *    written, because a higher-priority server was listed for the field; and
 *  - kept a removed logo in the database for good, because the field was
 *    never absent on every server.
 *
 * `false` and `0` are values and are recorded.
 */

function hasValue(value) {
  return value !== null && value !== undefined && value !== ''
}

/**
 * Record every leaf of one server's payload for one title.
 *
 * @param {Object} mediaData - The server's payload for the title (or a part of it)
 * @param {string} currentPath - Path of `mediaData` within the payload ('' at the top)
 * @param {string} serverId - The server the payload came from
 * @param {Object} availabilityMap - The title's map, added to in place
 */
export function collectFieldAvailability(mediaData, currentPath, serverId, availabilityMap) {
  for (const key in mediaData) {
    if (!Object.prototype.hasOwnProperty.call(mediaData, key)) continue

    const value = mediaData[key]
    let newPath = currentPath ? `${currentPath}.${key}` : key

    if (Array.isArray(value)) {
      if (key === 'fileNames') {
        continue
      } else if (key === 'audio' || key === 'video') {
        value.forEach((item, index) => {
          const trackType = item.codec || index
          const arrayPath = `${newPath}.${trackType}`
          collectFieldAvailability(item, arrayPath, serverId, availabilityMap)
        })
      } else {
        value.forEach((item, index) => {
          if (item && typeof item === 'object') {
            let identifier = item.name || item.id || index
            const arrayPath = `${newPath}.${identifier}`
            collectFieldAvailability(item, arrayPath, serverId, availabilityMap)
          }
        })
      }
    } else if (typeof value === 'object' && value !== null) {
      collectFieldAvailability(value, newPath, serverId, availabilityMap)
    } else if (hasValue(value)) {
      if (!availabilityMap[newPath]) {
        availabilityMap[newPath] = []
      }
      if (!availabilityMap[newPath].includes(serverId)) {
        availabilityMap[newPath].push(serverId)
      }
    }
  }
}

/**
 * Builds the per-server who-has-what maps for a sync pass:
 * `{ movies: { [originalTitle]: map }, tv: { [originalTitle]: map } }`.
 * Yields to the event loop every 50 titles (see below).
 *
 * @param {Object} fileServers - Fetched payloads by server id
 * @returns {Promise<{movies: Object, tv: Object}>}
 */
export async function buildFieldAvailability(fileServers) {
  // Initialize field-level availability maps
  const fieldAvailability = {
    movies: {},
    tv: {},
  }

  // Build availability maps per server.
  // The collectFieldAvailability recursion over the full library is the
  // single largest synchronous block in a sync tick — with no yields it
  // starves every in-flight request for its whole duration (observed as
  // multi-second slow-request bursts aligned to sync starts). Yield to the
  // event loop every N titles so concurrent requests keep getting turns.
  const FIELD_AVAILABILITY_YIELD_EVERY = 50
  const fieldAvailabilityStart = performance.now()
  let titlesSinceYield = 0
  const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve))

  for (const [serverId, fileServer] of Object.entries(fileServers)) {
    // For Movies - add null check to avoid errors on undefined
    if (fileServer.movies) {
      for (const [movieTitle, movieData] of Object.entries(fileServer.movies)) {
        if (!fieldAvailability.movies[movieTitle]) {
          fieldAvailability.movies[movieTitle] = {}
        }

        collectFieldAvailability(movieData, '', serverId, fieldAvailability.movies[movieTitle])

        if (++titlesSinceYield >= FIELD_AVAILABILITY_YIELD_EVERY) {
          titlesSinceYield = 0
          await yieldToEventLoop()
        }
      }
    }

    // For TV Shows - add null check to avoid errors on undefined
    if (fileServer.tv) {
      for (const [showTitle, showData] of Object.entries(fileServer.tv)) {
        if (!fieldAvailability.tv[showTitle]) {
          fieldAvailability.tv[showTitle] = {}
        }

        collectFieldAvailability(showData, '', serverId, fieldAvailability.tv[showTitle])

        if (++titlesSinceYield >= FIELD_AVAILABILITY_YIELD_EVERY) {
          titlesSinceYield = 0
          await yieldToEventLoop()
        }
      }
    }
  }

  console.log(
    `[SYNC PERF] fieldAvailability built in ${(performance.now() - fieldAvailabilityStart).toFixed(0)}ms ` +
    `(${Object.keys(fieldAvailability.movies).length} movies, ${Object.keys(fieldAvailability.tv).length} shows)`
  )

  return fieldAvailability
}
