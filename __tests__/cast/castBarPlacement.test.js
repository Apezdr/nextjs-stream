/**
 * Where the casting chip is allowed to appear.
 *
 * The interesting case is two watch pages that look identical to a route
 * matcher: the one whose title is on the television, where the player already
 * shows a casting overlay and owns the cast button, and any other one, where
 * the user is watching something locally and a way back to the TV is the whole
 * point. Only the recorded route tells them apart.
 */

jest.mock('@components/MediaPlayer/videojs', () => ({
  __esModule: true,
  CastEnterIcon: () => null,
}))

import { castBarPlacement } from '@src/components/Cast/CastSessionBar'

const MOVIE = '/list/movie/Some%20Film/play'
const OTHER_MOVIE = '/list/movie/Another%20Film/play'
const EPISODE = '/list/tv/Some%20Show/1/2/play'
const BROWSE = '/list'

describe('castBarPlacement', () => {
  describe('with a recorded route', () => {
    it('stays off the casting title’s own page', () => {
      expect(castBarPlacement(MOVIE, MOVIE).visible).toBe(false)
      expect(castBarPlacement(EPISODE, EPISODE).visible).toBe(false)
    })

    it('appears on a DIFFERENT watch page, which is the point of the feature', () => {
      const placement = castBarPlacement(OTHER_MOVIE, MOVIE)
      expect(placement.visible).toBe(true)
      // Bottom-right would sit on the player's fullscreen button.
      expect(placement.anchor).toBe('top-4 right-4')
    })

    it('appears while casting a movie and watching an episode, and vice versa', () => {
      expect(castBarPlacement(EPISODE, MOVIE).visible).toBe(true)
      expect(castBarPlacement(MOVIE, EPISODE).visible).toBe(true)
    })

    it('appears on ordinary pages, out of the way at the bottom', () => {
      const placement = castBarPlacement(BROWSE, MOVIE)
      expect(placement.visible).toBe(true)
      expect(placement.anchor).toBe('bottom-4 right-4')
    })
  })

  describe('without a recorded route', () => {
    it('keeps off every watch page, since it cannot tell which one is casting', () => {
      expect(castBarPlacement(MOVIE, null).visible).toBe(false)
      expect(castBarPlacement(EPISODE, null).visible).toBe(false)
    })

    it('still appears everywhere else', () => {
      expect(castBarPlacement(BROWSE, null).visible).toBe(true)
      expect(castBarPlacement('/watchlist', null).visible).toBe(true)
      expect(castBarPlacement('/', null).visible).toBe(true)
    })
  })

  describe('route matching', () => {
    it('does not mistake a title page for its watch page', () => {
      // /list/movie/X is the detail page; only /play is the player.
      expect(castBarPlacement('/list/movie/Some%20Film', null).anchor).toBe('bottom-4 right-4')
      expect(castBarPlacement('/list/tv/Some%20Show/1/2', null).anchor).toBe('bottom-4 right-4')
    })

    it('treats a missing pathname as an ordinary page rather than throwing', () => {
      expect(() => castBarPlacement(null, MOVIE)).not.toThrow()
      expect(castBarPlacement(null, MOVIE).visible).toBe(true)
      expect(castBarPlacement(undefined, null).visible).toBe(true)
    })
  })

  it('slides in from whichever edge it is anchored to', () => {
    expect(castBarPlacement(BROWSE, MOVIE).offset).toBeGreaterThan(0)
    expect(castBarPlacement(OTHER_MOVIE, MOVIE).offset).toBeLessThan(0)
  })
})
