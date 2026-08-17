const MAX_FOLDER_NAME_LENGTH = 255

function containsControlOrSeparator(value) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f || character === '/' || character === '\\'
  })
}

export function validateHostedFolderName(value) {
  const folder = typeof value === 'string' ? value.trim() : ''
  if (!folder) return { valid: false, message: 'Hosted folder is required.' }
  if (folder.length > MAX_FOLDER_NAME_LENGTH) {
    return { valid: false, message: `Hosted folder must be ${MAX_FOLDER_NAME_LENGTH} characters or fewer.` }
  }
  if (folder === '.' || folder === '..' || containsControlOrSeparator(folder)) {
    return { valid: false, message: 'Hosted folder must be a single folder name without slashes or control characters.' }
  }
  return { valid: true, folder }
}

export function rebaseHostedMediaUrl(value, mediaDirectory, previousFolder, nextFolder) {
  if (typeof value !== 'string' || !value.trim()) return value

  const wasAbsolute = /^[a-z][a-z\d+.-]*:/i.test(value)
  const wasProtocolRelative = value.startsWith('//')
  let url
  try {
    url = new URL(value, 'https://media-path.invalid')
  } catch {
    return value
  }

  const segments = url.pathname.split('/')
  const directoryIndex = segments.findIndex((segment) => segment === mediaDirectory)
  if (directoryIndex < 0 || directoryIndex + 1 >= segments.length) return value

  let decodedFolder
  try {
    decodedFolder = decodeURIComponent(segments[directoryIndex + 1])
  } catch {
    return value
  }
  if (decodedFolder !== previousFolder) return value

  segments[directoryIndex + 1] = encodeURIComponent(nextFolder)
  url.pathname = segments.join('/')

  if (wasAbsolute) return url.toString()
  if (wasProtocolRelative) return `//${url.host}${url.pathname}${url.search}${url.hash}`
  return `${url.pathname}${url.search}${url.hash}`
}

export function rebaseMovieHostedPaths(movie, previousFolder, nextFolder) {
  const rebased = {}
  for (const field of ['videoURL', 'posterURL', 'backdrop', 'logo', 'chapterURL']) {
    if (!(field in movie)) continue
    rebased[field] = rebaseHostedMediaUrl(movie[field], 'movies', previousFolder, nextFolder)
  }

  if (movie.captionURLs && typeof movie.captionURLs === 'object') {
    rebased.captionURLs = Object.fromEntries(
      Object.entries(movie.captionURLs).map(([language, caption]) => {
        if (typeof caption === 'string') {
          return [language, rebaseHostedMediaUrl(caption, 'movies', previousFolder, nextFolder)]
        }
        if (!caption || typeof caption !== 'object' || typeof caption.url !== 'string') {
          return [language, caption]
        }
        return [language, {
          ...caption,
          url: rebaseHostedMediaUrl(caption.url, 'movies', previousFolder, nextFolder),
        }]
      })
    )
  }

  return rebased
}