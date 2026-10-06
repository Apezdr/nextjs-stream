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
