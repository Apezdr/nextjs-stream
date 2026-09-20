/**
 * The movie, show and browse-page skeletons.
 *
 * Each one is its route's Suspense fallback and therefore its prerendered
 * shell: what a link has ready before the click. They are only convincing if
 * they keep the real page's frame, so these tests pin the shared classes to the
 * component each skeleton mirrors, and pin each skeleton to its route.
 */

import fs from 'fs'
import path from 'path'
import { render, screen } from '@testing-library/react'

const read = (file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

const FRAME = 'media-details-page relative mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:px-8'

describe('MoviePageSkeleton', () => {
  const MoviePageSkeleton = require('@components/MediaPages/details/MoviePageSkeleton').default
  const HERO = 'mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-6 sm:mt-10 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-x-8 lg:grid-cols-[220px_minmax(0,1fr)]'

  it('announces itself and holds the same frame and hero grid as the movie page', () => {
    render(<MoviePageSkeleton />)
    const status = screen.getByRole('status', { name: 'Loading movie' })
    const page = read('src/components/MediaPages/MovieDetailsComponent.js')
    expect(status).toHaveClass(...FRAME.split(' '))
    expect(page).toContain(FRAME)
    expect(status.querySelector('header')).toHaveClass(...HERO.split(' '))
    expect(page).toContain(HERO)
  })

  it('is the fallback on the movie route and its view', () => {
    expect(read('src/app/(styled)/list/movie/[title]/page.js')).toContain('fallback={<MoviePageSkeleton />}')
    expect(read('src/components/MediaPages/DynamicPage/views/MovieDetailsView.js')).toContain('fallback={<MoviePageSkeleton />}')
  })
})

describe('ShowPageSkeleton', () => {
  const ShowPageSkeleton = require('@components/MediaPages/details/ShowPageSkeleton').default
  const HERO = 'mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-5 gap-y-6 sm:mt-10 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-x-8 lg:grid-cols-[minmax(0,1fr)_230px] lg:gap-x-10'
  const SEASONS_GRID = 'grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4'

  it('announces itself and holds the same frame, hero grid and seasons grid as the show page', () => {
    render(<ShowPageSkeleton />)
    const status = screen.getByRole('status', { name: 'Loading show' })
    const page = read('src/components/MediaPages/TVShowSeasonsListComponent.js')
    expect(status).toHaveClass(...FRAME.split(' '))
    expect(page).toContain(FRAME)
    expect(status.querySelector('header')).toHaveClass(...HERO.split(' '))
    expect(page).toContain(HERO)
    expect(status.querySelector('ul')).toHaveClass(...SEASONS_GRID.split(' '))
    expect(page).toContain(SEASONS_GRID)
  })

  it('is the fallback on the show route and its view', () => {
    expect(read('src/app/(styled)/list/tv/[title]/page.js')).toContain('fallback={<ShowPageSkeleton />}')
    expect(read('src/components/MediaPages/DynamicPage/views/TVShowView.js')).toContain('fallback={<ShowPageSkeleton />}')
  })
})

describe('MediaListPageSkeleton', () => {
  const MediaListPageSkeleton = require('@components/MediaPages/MediaListPageSkeleton').default
  const PAGE = 'flex min-h-screen flex-col items-center justify-between xl:p-24 bg-[#060916e8]'
  const GRID = 'grid grid-cols-1 gap-x-4 gap-y-8 sm:gap-x-6 sm:grid-cols-2 xl:grid-cols-4 xl:gap-x-8'

  it('holds the same page frame and grid as both browse views', () => {
    render(<MediaListPageSkeleton />)
    const status = screen.getByRole('status', { name: 'Loading library' })
    expect(status).toHaveClass(...PAGE.split(' '))
    expect(status.querySelector('ul')).toHaveClass(...GRID.split(' '))
    for (const view of ['TVListView', 'MovieListView']) {
      const source = read(`src/components/MediaPages/DynamicPage/views/${view}.js`)
      expect(source).toContain(PAGE)
      expect(source).toContain(GRID)
    }
  })

  it('is the fallback on both browse routes', () => {
    expect(read('src/app/(styled)/list/tv/page.js')).toContain('fallback={<MediaListPageSkeleton />}')
    expect(read('src/app/(styled)/list/movie/page.js')).toContain('fallback={<MediaListPageSkeleton />}')
  })
})
