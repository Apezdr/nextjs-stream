/**
 * An episode card's image and its blurhash are one pair: the episode's own
 * thumbnail with its blurhash, or the show's poster with the poster's.
 */

import { episodeCardImage } from '@src/utils/media/episodeCardImage'

const show = { posterURL: 'https://files.test/tv/Show/show_poster.jpg', posterBlurhash: 'SHOW-POSTER-BLUR' }

test('an episode with a thumbnail shows it, with its own blurhash', () => {
  const episode = { thumbnail: 'https://files.test/tv/Show/Season 1/01 - Thumbnail.jpg', thumbnailBlurhash: 'THUMB-BLUR' }
  expect(episodeCardImage(episode, show)).toEqual({
    posterURL: episode.thumbnail,
    posterBlurhash: 'THUMB-BLUR',
    thumbnail: episode.thumbnail,
  })
})

test("a thumbnail without a blurhash gets none, never the show poster's", () => {
  const episode = { thumbnail: 'https://files.test/tv/Show/Season 1/01 - Thumbnail.jpg' }
  expect(episodeCardImage(episode, show).posterBlurhash).toBeNull()
})

test("an episode without a thumbnail shows the show's poster, with the poster's blurhash, and claims no thumbnail", () => {
  expect(episodeCardImage({ thumbnail: null }, show)).toEqual({ ...show, thumbnail: null })
  expect(episodeCardImage(null, show)).toEqual({ ...show, thumbnail: null })
})
