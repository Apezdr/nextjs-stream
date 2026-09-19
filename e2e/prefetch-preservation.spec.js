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
const DETAILS_HEADING = '.media-details-page h1'

async function firstHref(page, selector) {
  const link = page.locator(selector).first()
  await expect(link).toBeVisible()
  return { link, href: await link.getAttribute('href') }
}

test.describe('forced-prefetch links keep the destination title ready', () => {
  test('TV grid card -> show page', async ({ page }) => {
    await page.goto('/list/tv')
    const { link, href } = await firstHref(page, 'a.group[href^="/list/tv/"]')
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

test.describe('landing page', () => {
  test('"View media catalog" -> /list has the site navigation ready', async ({ page }) => {
    await page.goto('/')
    const link = page.getByRole('link', { name: 'View media catalog' })
    await expect(link).toBeVisible()
    await instant(page, async () => {
      await link.click()
      await page.waitForURL((url) => url.pathname === '/list')
      await expect(page.getByRole('navigation').first()).toBeVisible()
    })
  })
})
