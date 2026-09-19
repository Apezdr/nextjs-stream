// Router behaviour that has broken before and that framework upgrades touch.
//
// - Rapid back/forward once wedged the client router in production (clicks were
//   dropped, the URL stopped updating) when staleTimes was set; see the comment
//   in next.config.js. Any change to client-side route caching has to pass this.
// - Stepping to a neighbouring episode keeps the viewer's place on the page
//   (EpisodeNav links use scroll={false}).
const { test, expect } = require('./fixtures')

// :visible matters: Next keeps pages you navigated away from mounted but hidden,
// so after a few steps there are several info-page headings in the DOM.
const DETAILS_HEADING = '.media-details-page:visible h1'

async function openFirstShow(page) {
  await page.goto('/list/tv')
  const card = page.locator('a.group[href^="/list/tv/"]').first()
  await expect(card).toBeVisible()
  const showHref = await card.getAttribute('href')
  await card.click()
  await page.waitForURL((url) => url.pathname === showHref)
  await expect(page.locator(DETAILS_HEADING)).toBeVisible()
  return showHref
}

test('rapid back/forward does not wedge the router', async ({ page }) => {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))

  const showHref = await openFirstShow(page)

  // Hammer history without waiting for anything to settle
  for (let i = 0; i < 8; i++) {
    await page.goBack({ waitUntil: 'commit' })
    await page.goForward({ waitUntil: 'commit' })
  }
  await page.waitForURL((url) => url.pathname === showHref)
  await expect(page.locator(DETAILS_HEADING)).toBeVisible()

  // The wedge showed as dropped clicks: a link click after the hammering must still navigate
  // (The breadcrumb, not the top navigation: the fixed system-status banner can
  // sit over the navigation bar and swallow the click.)
  await page.locator('.media-details-page:visible a[href="/list/tv"]').first().click()
  await page.waitForURL((url) => url.pathname === '/list/tv', { timeout: 15_000 })
  await page.goBack()
  await page.waitForURL((url) => url.pathname === showHref, { timeout: 15_000 })

  expect(errors).toEqual([])
})

test('stepping to the next episode keeps the scroll position', async ({ page }) => {
  // A short window, so the prev/next row is always below the fold
  await page.setViewportSize({ width: 1280, height: 480 })
  const showHref = await openFirstShow(page)

  // Show -> first season with a tile -> first episode row
  const season = page.locator(`a[href^="${showHref}/"]`).first()
  await expect(season).toBeVisible()
  const seasonHref = (await season.getAttribute('href')).split('/').slice(0, 5).join('/')
  await page.goto(seasonHref)
  const episode = page.locator(`a[href^="${seasonHref}/"]:not([href$="/play"])`).first()
  await expect(episode).toBeVisible()
  await episode.click()
  await page.waitForURL((url) => url.pathname.startsWith(`${seasonHref}/`))
  await expect(page.locator(DETAILS_HEADING)).toBeVisible()

  const next = page.getByRole('link', { name: /^Next episode:/ })
  test.skip((await next.count()) === 0, 'this season has a single episode')
  await next.scrollIntoViewIfNeeded()
  const before = await page.evaluate(() => window.scrollY)
  test.skip(before < 50, 'page is too short to scroll on this viewport')

  const from = page.url()
  await next.click()
  await page.waitForURL((url) => url.href !== from)
  await expect(page.locator(DETAILS_HEADING)).toBeVisible()
  const after = await page.evaluate(() => window.scrollY)
  expect(after).toBeGreaterThan(0)
  expect(Math.abs(after - before)).toBeLessThan(200)
})
