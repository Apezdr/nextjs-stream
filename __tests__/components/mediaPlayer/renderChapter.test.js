/**
 * @jest-environment jsdom
 *
 * A chapter's frame goes through the image optimizer, and falls back to the
 * frame's own URL when the optimizer fails (it gives up on a slow source
 * after a few seconds, and an uncached frame is cut from the video on demand).
 */

import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('@components/MediaPlayer/videojs', () => ({
  __esModule: true,
  Menu: { Item: ({ children, onClick }) => <button onClick={onClick}>{children}</button> },
}))

import RenderChapter from '@components/MediaPlayer/chapter/renderChapter'

const FRAMES = 'https://files.example.com/node/frame/movie/Some%20Film/'

function renderChapter(props = {}) {
  return render(
    <RenderChapter
      label="Opening"
      startTimeText="5:07"
      durationText="3:10"
      isActive={false}
      onSelect={() => {}}
      chapterThumbnailURL={FRAMES}
      {...props}
    />
  )
}

describe('RenderChapter frame', () => {
  it('asks the optimizer for the frame at the chapter start', () => {
    renderChapter()
    const img = screen.getByAltText('Chapter Thumbnail')
    const src = new URL(img.getAttribute('src'), 'http://localhost')
    expect(src.pathname).toBe('/_next/image')
    expect(src.searchParams.get('url')).toBe(`${FRAMES}00:05:07`)
    // 1x and 2x of the 92 px box, from the configured size list.
    expect(img.getAttribute('srcset')).toMatch(/w=96&q=75 1x, .*w=256&q=75 2x/)
  })

  it('falls back to the frame URL itself when the optimizer fails', () => {
    renderChapter()
    fireEvent.error(screen.getByAltText('Chapter Thumbnail'))
    const img = screen.getByAltText('Chapter Thumbnail')
    expect(img.getAttribute('src')).toBe(`${FRAMES}00:05:07`)
    expect(img.getAttribute('srcset')).toBeNull()
  })

  it('does not loop when the frame URL fails too', () => {
    renderChapter()
    fireEvent.error(screen.getByAltText('Chapter Thumbnail'))
    fireEvent.error(screen.getByAltText('Chapter Thumbnail'))
    expect(screen.getByAltText('Chapter Thumbnail').getAttribute('src')).toBe(`${FRAMES}00:05:07`)
  })

  it('renders no image without a frame endpoint', () => {
    renderChapter({ chapterThumbnailURL: undefined })
    expect(screen.queryByAltText('Chapter Thumbnail')).toBeNull()
  })
})
