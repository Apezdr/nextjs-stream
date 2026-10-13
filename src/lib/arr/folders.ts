// src/lib/arr/folders.ts
// Folder names. The folder a title lands in becomes its originalTitle: the key
// in every file-server path and media URL, for good. So the dialog shows the
// exact name before anything is created, the add sends that path explicitly,
// and a name another title already uses is refused rather than shared on disk.
// No server-only import: the dialog checks a typed name with the same rules.

export interface RadarrNaming {
  movieFolderFormat: string
  replaceIllegalCharacters: boolean
  /** delete | dash | spaceDash | spaceDashSpace | smart */
  colonReplacementFormat: string
}

/** Radarr's FileNameBuilder BadCharacters / GoodCharacters, pairwise. */
const ILLEGAL_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['\\', '+'],
  ['/', '+'],
  ['<', ''],
  ['>', ''],
  ['?', '!'],
  ['*', '-'],
  ['|', ''],
  ['"', ''],
]

function replaceColons(value: string, format: string): string {
  switch (format) {
    case 'smart':
      return value.replace(/: /g, ' - ').replace(/:/g, '-')
    case 'dash':
      return value.replace(/:/g, '-')
    case 'spaceDash':
      return value.replace(/:/g, ' -')
    case 'spaceDashSpace':
      return value.replace(/:/g, ' - ')
    default: // delete
      return value.replace(/:/g, '')
  }
}

/** Radarr's CleanFileName, which every token's value passes through. */
export function cleanTokenValue(
  value: string,
  naming: Pick<RadarrNaming, 'replaceIllegalCharacters' | 'colonReplacementFormat'>
): string {
  let result = value
  if (naming.replaceIllegalCharacters) {
    result = replaceColons(result, naming.colonReplacementFormat)
    for (const [bad, good] of ILLEGAL_REPLACEMENTS) result = result.split(bad).join(good)
  } else {
    result = result.replace(/[\\/<>?*|":]/g, '')
  }
  return result.replace(/^[ .]+/, '').replace(/ +$/, '')
}

/** Radarr's CleanFolderName: a run of one separator becomes one, then spaces and dots come off both ends. */
function cleanFolderName(name: string): string {
  return name.replace(/([- ._])\1+/g, '$1').replace(/^[ .]+|[ .]+$/g, '')
}

/** Radarr's {Movie TitleThe}: "The Matrix" → "Matrix, The". */
function titleThe(title: string): string {
  const match = /^(The|An|A) (.*?)((?: *\([^)]+\))*)$/i.exec(title)
  return match ? `${match[2]}, ${match[1]}${match[3]}` : title
}

/**
 * The folder Radarr would create for a movie, or null when the folder format
 * uses a token this can't reproduce exactly. Radarr's lookup doesn't return
 * one (folderName is empty until the movie is added), and the add sends this
 * path as-is, so a guess would be worse than no preview.
 */
export function predictRadarrFolder(movie: { title: string; year: number | null }, naming: RadarrNaming): string | null {
  const format = naming.movieFolderFormat ?? ''
  if (!movie.title || !format.trim() || /[\\/]/.test(format)) return null
  const tokens: Record<string, string> = {
    '{Movie Title}': movie.title,
    '{Movie TitleThe}': titleThe(movie.title),
    '{Release Year}': movie.year ? String(movie.year) : '',
  }
  let unsupported = false
  const replaced = format.replace(/\{[^}]*\}/g, (token) => {
    if (!(token in tokens)) {
      unsupported = true
      return ''
    }
    return cleanTokenValue(tokens[token], naming)
  })
  if (unsupported) return null
  return cleanFolderName(replaced) || null
}

const ILLEGAL_FOLDER_CHARACTERS = /[\\/:*?"<>|]/
const MAX_FOLDER_LENGTH = 180

/** Why a typed folder name can't be used, or null when it can. */
export function folderNameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a folder name.'
  if (ILLEGAL_FOLDER_CHARACTERS.test(name) || [...name].some((char) => char.charCodeAt(0) < 32)) {
    return 'A folder name can’t contain \\ / : * ? " < > | or control characters.'
  }
  if (name !== name.trim() || name.startsWith('.') || name.endsWith('.')) {
    return 'A folder name can’t start or end with a space or a dot.'
  }
  if (name.length > MAX_FOLDER_LENGTH) return `Keep the folder name under ${MAX_FOLDER_LENGTH} characters.`
  return null
}

/** A folder's full path under a root folder, in the root folder's own separator style. */
export function joinRootFolder(rootFolderPath: string, folder: string): string {
  const separator = rootFolderPath.includes('\\') && !rootFolderPath.includes('/') ? '\\' : '/'
  return `${rootFolderPath.replace(/[\\/]+$/, '')}${separator}${folder}`
}

/** The last segment of a path: the folder an arr title lives in. */
export function folderOf(path: string | null | undefined): string | null {
  if (!path) return null
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || null
}
