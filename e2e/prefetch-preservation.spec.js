// What the app's forced-prefetch links have ready BEFORE the click.
//
// These links use <Link prefetch={true}>, which today downloads the whole
// destination. Partial Prefetching changes that to the route's shared shell
// plus whatever cached, link-specific content can be resolved early. The
// assertions below are the part of each destination we chose to keep ready;
// they must pass with Partial Prefetching OFF first (the baseline), and then
// stay unchanged while each destination is adopted.
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
const DETAILS_HEADING = '.media-details-page:visible h1'

// A prefetch starts when its link scrolls into view and takes a moment to land.
// Someone reading the page gives it that moment; a test clicking at once does
// not, and a held navigation with nothing prefetched never commits. So let the
// network settle first.
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
}

async function firstHref(page, selector) {
  const link = page.locator(selector).first()
  await expect(link).toBeVisible()
  await settle(page)
  return { link, href: await link.getAttribute('href') }
}

// Grid cards prefetch their full destination on INTENT (hover, focus, touch),
// not on sight: a full prefetch costs a server render per link, and a grid shows
// hundreds. So the two grid tests hover first, the way a pointer does before a
// click. (Decided 2026-09-19. Before that the cards used prefetch={true}
// outright and the same assertions passed without the hover.)
async function showIntent(page, link) {
  await link.hover()
  await settle(page)
}

test.describe('forced-prefetch links keep the destination title ready', () => {
  test('TV grid card -> show page', async ({ page }) => {
    await page.goto('/list/tv')
    const { link, href } = await firstHref(page, 'a.group[href^="/list/tv/"]')
    await showIntent(page, link)
    await instant(page, async () => {
      await link.click()
      await page.waitForURL((url) => url.pathname === href)
      await expect(page.locator(DETAILS_HEADING)).toBeVisible()
    })
  })

  test('Movie grid card -> movie page', async ({ page }) => {
    await page.goto('/list/movie')
    // The grid links are relative ("movie/<title>"), so match on the resolved path
    const link = page.locator('a.group[href*="movie/"]').first()
    await expect(link).toBeVisible()
    await settle(page)
    await showIntent(page, link)
    await instant(page, async () => {
      await link.click()
      await page.waitForURL((url) => /^\/list\/movie\/[^/]+$/.test(url.pathname))
      await expect(page.locator(DETAILS_HEADING)).toBeVisible()
    })
  })

  test('Banner "View Details" -> movie page', async ({ page }) => {
    await page.goto('/list')
    const { link, href } = await firstHref(page, 'a[href^="/list/movie/"]:has-text("View Details")')
    await instant(page, async () => {
      await link.click()
      await page.waitForURL((url) => url.pathname === href)
      await expect(page.locator(DETAILS_HEADING)).toBeVisible()
    })
  })

  // The hover card opens from a rail item after a delay and its markup has not
  // been exercised under Playwright yet; write this one with the rig running.
  test.fixme('Hover card "View Details" -> details page', async () => {})
})

test.describe('stepping between episodes', () => {
  // The reason Partial Prefetching was adopted: switching episodes used to blank
  // the page and refill it. The prev/next cards use prefetch={true}, so the
  // neighbour's own title is ready before the click, not only its skeleton.
  test('Next episode card -> the next episode, title ready', async ({ page }) => {
    await page.goto('/list/tv')
    const card = page.locator('a.group[href^="/list/tv/"]').first()
    await expect(card).toBeVisible()
    const showHref = await card.getAttribute('href')
    await page.goto(showHref)
    const season = page.locator(`a[href^="${showHref}/"]`).first()
    await expect(season).toBeVisible()
    const seasonHref = (await season.getAttribute('href')).split('/').slice(0, 5).join('/')
    await page.goto(seasonHref)
    const episode = page.locator(`a[href^="${seasonHref}/"]:not([href$="/play"])`).first()
    await expect(episode).toBeVisible()
    await page.goto(await episode.getAttribute('href'))

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
      const frame = page.locator('.media-details-page:visible')
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

test.describe('landing page', () => {
  // Not part of the baseline. Measured with Partial Prefetching off: from "/"
  // Next fetches only /list's route tree plus a streamed full prefetch that
  // cannot commit while the navigation is held, so today this link has NOTHING
  // ready before the click (unheld, it commits in ~250 ms and then streams).
  // There is no legacy UI to preserve; this becomes a target once /list has a
  // real shell, and the fixme comes off then.
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
})
