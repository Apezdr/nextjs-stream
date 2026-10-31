/**
 * The image a card for one episode shows, and the blurhash that goes with it:
 * the episode's own thumbnail and its blurhash when it has a thumbnail, the
 * show's poster and the poster's blurhash otherwise. Never one's image with
 * the other's blur: a card paints the blurhash while its image loads, and the
 * popup it opens starts from the same pair before its own fetch lands.
 *
 * An episode thumbnail without a blurhash gets none, rather than the show
 * poster's.
 *
 * @param {{ thumbnail?: string|null, thumbnailBlurhash?: string|null }|null|undefined} episode
 * @param {{ posterURL?: string|null, posterBlurhash?: string|null }|null|undefined} show
 * @returns {{ posterURL: string|null, posterBlurhash: string|null, thumbnail: string|null }}
 *   `thumbnail` is set only when the card shows the episode's own image
 */
export function episodeCardImage(episode, show) {
  if (episode?.thumbnail) {
    return { posterURL: episode.thumbnail, posterBlurhash: episode.thumbnailBlurhash || null, thumbnail: episode.thumbnail }
  }
  return { posterURL: show?.posterURL || null, posterBlurhash: show?.posterBlurhash || null, thumbnail: null }
}
