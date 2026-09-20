// What each navigation has ready BEFORE the click.
//
// With Partial Prefetching every link gets its route's shared shell (the page
// skeleton) for free, and a link that asks for more gets its own cached content
// too: <Link prefetch={true}> outright, IntentPrefetchLink once someone shows
// intent. Each test pins what one kind of link is meant to have ready, so a
// change that quietly turns an instant navigation back into a wait fails here.
//
// Inside instant() the page is held at its prefetched UI: anything that would
// stream in after the click stays hidden until the callback returns.
//
// Titles are read from the page, not hard-coded, so the suite runs against
// whatever is in the library.
const { instant } = require('@next/playwright')
const { test, expect } = require('./fixtures')

// Every media info page (movie, show, season, episode) has this frame and one h1
// (:visible because Next keeps pages you navigated away from mounted but hidden)
const DETAILS_FRAME = '.media-details-page:visible'
const DETAILS_HEADING = `${DETAILS_FRAME} h1`

// A prefetch starts when its link scrolls into view and takes a moment to land.
// Someone reading the page gives it that moment; a test clicking at once does
// not, and a held navigation with nothing prefetched never commits. So let the
// network settle first.
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
}

/**
 * Do `trigger`, then wait until the router has fetched `pathname` with a FULL
 * prefetch (the link's own content, not just the route shell).
 *
 * settle() is not enough for links whose full prefetch starts late: a link
 * that only exists once a card opens, or an IntentPrefetchLink, which waits for
 * the pointer to rest on it. The network can be idle before the request is even
 * made. A full prefetch is recognisable on the wire: it carries the router's
 * prefetch header but no segment header (shell prefetches are per segment).
 */
async function fullPrefetchOf(page, pathname, trigger) {
  const seen = []
  const onResponse = (res) => {
    const headers = res.request().headers()
    if (res.url().includes('_rsc=') && headers['next-router-prefetch'] && !headers['next-router-segment-prefetch']) {
      seen.push(new URL(res.url()).pathname)
    }
  }
  page.on('response', onResponse)
  await trigger()
  await expect.poll(() => seen.includes(pathname), { timeout: 15_000 }).toBe(true)
  page.off('response', onResponse)
  // The response has started; its body streams. Playwright never reports these
  // requests as finished (measured: 'requestfinished' did not fire in 15 s), so
  // give the body a fixed moment. A person takes longer than this to click.
  await page.waitForTimeout(2000)
  await settle(page)
}

const pathOf = (page, href) => new URL(href, page.url()).pathname

/** The first show in the library, then its first season and that season's first episode. */
async function firstEpisode(page) {
  await page.goto('/list/tv')
  const card = page.locator('a.group[href^="/list/tv/"]').first()
  await expect(card).toBeVisible()
  const showHref = await card.getAttribute('href')
  await page.goto(showHref)
  const season = page.locator(`${DETAILS_FRAME} a[href^="${showHref}/"]:not([href$="/play"])`).first()
  await expect(season).toBeVisible()
  const seasonHref = (await season.getAttribute('href')).split('/').slice(0, 5).join('/')
  await page.goto(seasonHref)
  const episode = page.locator(`${DETAILS_FRAME} a[href^="${seasonHref}/"]:not([href$="/play"])`).first()
  await expect(episode).toBeVisible()
  return { showHref, seasonHref, episodeHref: await episode.getAttribute('href') }
}

// Grid cards, season tiles, episode rows and trail links prefetch their full
// destination on INTENT (the pointer resting on them, focus, touch), not on
// sight: a full prefetch costs a server render per link, and a grid shows
// hundreds. So these tests rest the pointer first, the way a person does.
test.describe('links that prefetch on intent have the destination ready', () => {
  test('TV grid card -> show page', async ({ page }) => {
    await page.goto('/list/tv')
    const link = page.locator('a.group[href^="/list/tv/"]').first()
    await expect(link).toBeVisible()
    await settle(page)
    const href = await link.getAttribute('href')
    await fullPrefetchOf(page, pathOf(page, href), () => link.hover())
    await instant(page, async () => {
      await link.click()
      await page.waitForURL((url) => url.pathname === pathOf(page, href))
      await expect(page.locator(DETAILS_HEADING)).toBeVisible()
    })
  })

  test('Movie grid card -> movie page', async ({ page }) => {
    await page.goto('/list/movie')
    // The grid links are relative ("movie/<title>")
    const link = page.locator('a.group[href*="movie/"]').first()
    await expect(link).toBeVisible()
    await settle(page)
    const target = pathOf(page, await link.getAttribute('href'))
    await fullPrefetchOf(page, target, () => link.hover())
    await instant(page, async () => {
      await link.click()
      await page.waitForURL((url) => url.pathname === target)
      await expect(page.locator(DETAILS_HEADING)).toBeVisible()
    })
  })

  test('Season tile -> season page', async ({ page }) => {
    const { showHref } = await firstEpisode(page)
    await page.goto(showHref)
    const tile = page.locator(`${DETAILS_FRAME} a[href^="${showHref}/"]:not([href$="/play"])`).first()
    await expect(tile).toBeVisible()
    await settle(page)
    const target = pathOf(page, await tile.getAttribute('href'))
    await tile.scrollIntoViewIfNeeded()
    await fullPrefetchOf(page, target, () => tile.hover())
    await instant(page, async () => {
      await tile.click()
      await page.waitForURL((url) => url.pathname === target)
      await expect(page.locator(DETAILS_HEADING)).toBeVisible()
      // The season's own content, not just its skeleton: an episode row links onward
      await expect(page.locator(`${DETAILS_FRAME} a[href^="${target}/"]`).first()).toBeVisible()
    })
  })
})

test.describe('links that always prefetch in full have the destination ready', () => {
  test('Banner "View Details" -> movie page', async ({ page }) => {
    await page.goto('/list')
    const link = page.locator('a[href^="/list/movie/"]:has-text("View Details")').first()
    await expect(link).toBeVisible()
    await settle(page)
    const href = await link.getAttribute('href')
    await instant(page, async () => {
      await link.click()
      await page.waitForURL((url) => url.pathname === href)
      await expect(page.locator(DETAILS_HEADING)).toBeVisible()
    })
  })

  // A rail card expands into the hover card after resting under the pointer
  // for a second; "View Details" inside it uses prefetch={true}. One such link
  // exists at a time, and only for something already being looked at. It works
  // because the card's links navigate natively: when its click handler used
  // router.push, the same navigation had only the skeleton ready.
  test('Hover card "View Details" -> details page', async ({ page }) => {
    await page.goto('/list')
    // Peeking cards at the rail's edges are dimmed and do not expand
    const card = page.locator('.card[role="button"]:not(.opacity-50)').first()
    await expect(card).toBeVisible()
    await settle(page)
    await card.scrollIntoViewIfNeeded()
    // The banner has a "View Details" too; the hover card's is the blue one
    const link = page.locator('a.bg-blue-600:has-text("View Details")').first()
    let target
    const seen = []
    const onResponse = (res) => {
      const headers = res.request().headers()
      if (res.url().includes('_rsc=') && headers['next-router-prefetch'] && !headers['next-router-segment-prefetch']) {
        seen.push(new URL(res.url()).pathname)
      }
    }
    page.on('response', onResponse)
    await card.hover()
    await expect(link).toBeVisible({ timeout: 10_000 })
    target = pathOf(page, await link.getAttribute('href'))
    await expect.poll(() => seen.includes(target), { timeout: 15_000 }).toBe(true)
    page.off('response', onResponse)
    await page.waitForTimeout(2000)
    await settle(page)
    await instant(page, async () => {
      await link.click()
      await page.waitForURL((url) => url.pathname === target)
      await expect(page.locator(DETAILS_HEADING)).toBeVisible()
    })
  })

  // The reason Partial Prefetching was adopted: switching episodes used to blank
  // the page and refill it. The prev/next cards use prefetch={true}, so the
  // neighbour's own title is ready before the click, not only its skeleton.
  test('Next episode card -> the next episode, title ready', async ({ page }) => {
    const { episodeHref } = await firstEpisode(page)
    await page.goto(episodeHref)

    const next = page.getByRole('link', { name: /^Next episode:/ })
    await expect(page.locator(DETAILS_HEADING)).toBeVisible()
    test.skip((await next.count()) === 0, 'this season has a single episode')
    const nextHref = await next.getAttribute('href')
    const label = await next.getAttribute('aria-label') // "Next episode: Episode 2, <title>"
    const nextTitle = label.replace(/^Next episode: Episode \d+, /, '')
    const currentHref = new URL(page.url()).pathname
    await next.scrollIntoViewIfNeeded()
    await settle(page)

    await instant(page, async () => {
      await next.click()
      await page.waitForURL((url) => url.pathname === nextHref)
      const frame = page.locator(DETAILS_FRAME)
      // The page shows the part of a title before a colon as the heading and
      // the rest as a subtitle (and a show can reuse the first part for every
      // episode), so look for each part rather than comparing headings.
      for (const part of nextTitle.split(':').map((s) => s.trim()).filter(Boolean)) {
        await expect(frame.getByText(part, { exact: false }).first()).toBeVisible()
      }
      // Only the NEW episode's content links back to the one we came from
      await expect(frame.locator(`a[href="${currentHref}"][aria-label^="Previous episode:"]`)).toBeVisible()
    })
  })
})

// Default links: the route's shell, which is the page's skeleton.
test.describe('default links land on the page skeleton', () => {
  // From "/" nothing of /list used to be ready before the click (measured with
  // Partial Prefetching off: the navigation could not commit while held).
  test('"View media catalog" -> /list has the catalog skeleton ready', async ({ page }) => {
    await page.goto('/')
    const link = page.getByRole('link', { name: 'View media catalog' })
    await expect(link).toBeVisible()
    await settle(page)
    await instant(page, async () => {
      await link.click()
      await page.waitForURL((url) => url.pathname === '/list')
      // The skeleton's row labels are static text in /list's prerendered shell.
      // (The navigation bar is NOT expected here: it depends on the session,
      // and the session is only cached for 30 s, below the 5 minutes the
      // shared shell requires. It streams in right after.)
      await expect(page.getByText('Recently Added').first()).toBeVisible()
    })
  })

  // The most-clicked link in the app. The player routes had no shell at all, so
  // the click did nothing visible until the server had answered.
  // (fixtures.js refuses every write, so opening the player records nothing.)
  test('Play -> the player frame is there at once', async ({ page }) => {
    const { episodeHref } = await firstEpisode(page)
    await page.goto(episodeHref)
    const play = page.locator(`${DETAILS_FRAME} a[href$="/play"]`).first()
    await expect(play).toBeVisible()
    await settle(page)
    await instant(page, async () => {
      await play.click()
      await page.waitForURL((url) => url.pathname.endsWith('/play'))
      await expect(page.getByRole('status', { name: 'Loading player' })).toBeVisible()
    })
  })
})

// A hard load, before any JavaScript: the root template once server-rendered
// every page at opacity 0 and the prerendered shell stayed invisible until
// hydration. Read the HTML the server sends, the way a browser first sees it.
test.describe('server-rendered pages are visible without JavaScript', () => {
  for (const path of ['/', '/list']) {
    test(`${path} is not sent hidden`, async ({ page }) => {
      const html = await (await page.request.get(path)).text()
      const mains = html.match(/<main\b[^>]*>/g) || []
      expect(mains.length).toBeGreaterThan(0)
      for (const tag of mains) expect(tag).not.toMatch(/opacity\s*:\s*0/)
    })
  }
})
