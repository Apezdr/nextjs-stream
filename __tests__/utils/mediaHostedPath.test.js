import {
  rebaseHostedMediaUrl,
  rebaseMovieHostedPaths,
  validateHostedFolderName,
} from '@src/utils/admin/mediaHostedPath'

describe('hosted media paths', () => {
  test('rebases only the encoded movie folder segment', () => {
    expect(rebaseHostedMediaUrl(
      'https://media.example.test/media/movies/%23Alive/video.mp4?token=kept',
      'movies',
      '#Alive',
      'Alive (2020)'
    )).toBe('https://media.example.test/media/movies/Alive%20(2020)/video.mp4?token=kept')

    expect(rebaseHostedMediaUrl(
      'https://image.tmdb.org/t/p/original/poster.jpg',
      'movies',
      '#Alive',
      'Alive (2020)'
    )).toBe('https://image.tmdb.org/t/p/original/poster.jpg')
  })

  test('rebases movie assets and caption URLs together', () => {
    expect(rebaseMovieHostedPaths({
      videoURL: '/media/movies/Old%20Folder/video.mp4',
      posterURL: '/media/movies/Old%20Folder/poster.jpg',
      captionURLs: {
        en: { url: '/media/movies/Old%20Folder/captions/en.vtt', label: 'English' },
      },
    }, 'Old Folder', 'New Folder')).toEqual({
      videoURL: '/media/movies/New%20Folder/video.mp4',
      posterURL: '/media/movies/New%20Folder/poster.jpg',
      captionURLs: {
        en: { url: '/media/movies/New%20Folder/captions/en.vtt', label: 'English' },
      },
    })
  })

  test.each(['', '..', 'folder/name', 'folder\\name', `bad${String.fromCharCode(0)}name`])(
    'rejects unsafe folder name %p',
    (value) => expect(validateHostedFolderName(value).valid).toBe(false)
  )
})