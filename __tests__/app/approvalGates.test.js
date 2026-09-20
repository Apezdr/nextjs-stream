/**
 * The approved-account check on the media routes.
 *
 * It used to live in the tv/ and movie/ subtree layouts. A layout that awaits
 * the session keeps every page beneath it out of the prerendered shell, so the
 * check moved into the pages: SessionGate for the browse and info pages, an
 * inline redirect in the player pages. That trades one chokepoint for a rule
 * every page has to follow, and the last test here is what enforces the rule:
 * a new page under those folders fails it until it has a gate.
 */

import fs from 'fs'
import path from 'path'

const mockRedirect = jest.fn((url) => {
  // next/navigation's redirect throws to stop rendering; mirror that
  const error = new Error('NEXT_REDIRECT')
  error.url = url
  throw error
})
jest.mock('next/navigation', () => ({ redirect: (url) => mockRedirect(url) }))

// 'use cache: private' is a build-time directive; under jest it is an inert string
jest.mock('next/cache', () => ({ cacheLife: jest.fn() }))

const mockGetSession = jest.fn()
jest.mock('@src/lib/cachedAuth', () => ({ getSession: () => mockGetSession() }))

jest.mock('@src/components/MediaPages/DynamicPage/guards/AuthGuard', () => ({
  __esModule: true,
  default: (props) => ({ type: 'AuthGuard', props }),
}))

const SessionGate = require('@src/components/MediaPages/DynamicPage/guards/SessionGate').default

const callbackUrl = ({ title }) => `/list/tv/${title}`

beforeEach(() => {
  mockRedirect.mockClear()
  mockGetSession.mockReset()
})

describe('SessionGate', () => {
  it('redirects an unapproved account and never builds the page content', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1', approved: false } })
    const children = jest.fn()

    await expect(
      SessionGate({ params: Promise.resolve({ title: 'Preacher' }), callbackUrl, children })
    ).rejects.toThrow('NEXT_REDIRECT')

    expect(mockRedirect).toHaveBeenCalledWith('/auth/error?error=APPROVAL_PENDING')
    expect(children).not.toHaveBeenCalled()
  })

  it('hands a signed-out visitor to the sign-in page and never builds the page content', async () => {
    mockGetSession.mockResolvedValue(null)
    const children = jest.fn()

    const result = await SessionGate({ params: Promise.resolve({ title: 'Preacher' }), callbackUrl, children })

    expect(children).not.toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
    expect(result.props.session).toBeNull()
    expect(result.props.callbackUrl).toBe('/list/tv/Preacher')
    expect(result.props.children).toBeNull()
  })

  it('builds the content for an approved account, with the session and the resolved params', async () => {
    mockGetSession.mockResolvedValue({
      session: { token: 'secret', expiresAt: new Date() },
      user: { id: 'u1', approved: true, limitedAccess: undefined, email: 'someone@example.com', createdAt: new Date() },
    })
    const children = jest.fn(() => 'content')

    const result = await SessionGate({ params: Promise.resolve({ title: 'Preacher' }), callbackUrl, children })

    // Only what the gate needs crosses the cache boundary: no token, no email, no Dates
    expect(children).toHaveBeenCalledWith({
      session: { user: { id: 'u1', approved: true, limitedAccess: false } },
      params: { title: 'Preacher' },
    })
    expect(result.props.children).toBe('content')
  })

  it('treats an account with no approved flag as approved, as the layouts did', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1' } })
    const children = jest.fn(() => 'content')
    await SessionGate({ callbackUrl: () => '/list/tv', children })
    expect(children).toHaveBeenCalled()
    expect(mockRedirect).not.toHaveBeenCalled()
  })
})

describe('every page under list/tv and list/movie has an approval gate', () => {
  const listDir = path.join(process.cwd(), 'src/app/(styled)/list')

  function pagesUnder(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return pagesUnder(full)
      return /^page\.(js|jsx|ts|tsx)$/.test(entry.name) ? [full] : []
    })
  }

  const pages = [...pagesUnder(path.join(listDir, 'tv')), ...pagesUnder(path.join(listDir, 'movie'))]

  it('finds the pages it is meant to guard', () => {
    expect(pages.length).toBeGreaterThanOrEqual(8)
  })

  it.each(pages.map((p) => [path.relative(listDir, p).replace(/\\/g, '/'), p]))('%s', (_name, file) => {
    const source = fs.readFileSync(file, 'utf8')
    const usesGate = /<SessionGate[\s>]/.test(source)
    const redirectsInline = /approved === false/.test(source) && source.includes("redirect('/auth/error?error=APPROVAL_PENDING')")
    const usesWrapper = /export default withApprovedUser\(/.test(source)
    expect(usesGate || redirectsInline || usesWrapper).toBe(true)
  })
})
