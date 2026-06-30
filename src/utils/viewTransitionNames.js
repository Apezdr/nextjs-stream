const UNSAFE_CHARS = /[^a-zA-Z0-9_-]+/g

function slugify(value) {
  return String(value).replace(UNSAFE_CHARS, '_')
}

export function moviePosterName(title) {
  return `movie-poster-${slugify(title)}`
}

export function movieBackdropName(title) {
  return `movie-backdrop-${slugify(title)}`
}

export function movieLogoName(title) {
  return `movie-logo-${slugify(title)}`
}

export function tvPosterName(title) {
  return `tv-poster-${slugify(title)}`
}

export function tvShowBackdropName(title) {
  return `tv-show-backdrop-${slugify(title)}`
}

export function tvSeasonPosterName(showTitle, seasonNumber) {
  return `tv-season-poster-${slugify(showTitle)}-${slugify(seasonNumber)}`
}

export function tvEpisodePosterName(showTitle, seasonNumber, episodeNumber) {
  return `tv-episode-poster-${slugify(showTitle)}-${slugify(seasonNumber)}-${slugify(episodeNumber)}`
}
