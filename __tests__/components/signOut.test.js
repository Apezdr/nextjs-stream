/**
 * Signing out must leave with a full page load.
 *
 * A client navigation keeps everything the browser was holding: the pages Next
 * keeps mounted but hidden, the router's cached page output, SWR responses.
 * After router.push('/') on sign-out, Back re-showed the previous member page
 * without a request. See src/utils/hardNavigate.js.
 *
 * And it must not leave the positions this browser mirrored behind: they are
 * keyed by title, not by user, so the next account to sign in here would
 * read them as its own.
 */

import fs from 'fs'
import path from 'path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHardNavigate = jest.fn()
jest.mock('@src/utils/hardNavigate', () => ({ hardNavigate: (href) => mockHardNavigate(href) }))

const mockSignOut = jest.fn()
jest.mock('@src/lib/auth-client', () => ({ authClient: { signOut: (options) => mockSignOut(options) } }))

const SignOutButton = require('@components/SignOutButton').default

// What the browser mirrors of the signed-in user's positions, and something it must keep
const MIRRORED = ['mid:0123456789abcdef', 'https://files.example/movies/film.mp4', 'http://files.example/tv/s01e01.mp4']
const position = JSON.stringify({ playbackTime: 1800, lastUpdated: '2026-11-10T20:00:00.000Z' })
const mirroredKeys = () => MIRRORED.filter((key) => window.localStorage.getItem(key) !== null)

beforeEach(() => {
  mockHardNavigate.mockReset()
  mockSignOut.mockReset()
  window.localStorage.clear()
  for (const key of MIRRORED) window.localStorage.setItem(key, position)
  window.localStorage.setItem('player-volume', '0.5')
})

describe('SignOutButton', () => {
  it('leaves with a full page load once the session is gone', async () => {
    mockSignOut.mockImplementation(async ({ fetchOptions }) => fetchOptions.onSuccess())
    render(<SignOutButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    await waitFor(() => expect(mockHardNavigate).toHaveBeenCalledWith('/'))
  })

  it('stays put when signing out fails', async () => {
    mockSignOut.mockImplementation(async () => {})
    render(<SignOutButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled())
    expect(mockHardNavigate).not.toHaveBeenCalled()
  })

  it('drops the positions this browser mirrored before it leaves, and nothing else it stored', async () => {
    let mirroredWhenLeaving = null
    mockHardNavigate.mockImplementation(() => {
      mirroredWhenLeaving = mirroredKeys()
    })
    mockSignOut.mockImplementation(async ({ fetchOptions }) => fetchOptions.onSuccess())
    render(<SignOutButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    await waitFor(() => expect(mockHardNavigate).toHaveBeenCalled())

    expect(mirroredWhenLeaving).toEqual([])
    expect(window.localStorage.getItem('player-volume')).toBe('0.5')
  })

  it('keeps them when signing out fails: the same account is still signed in', async () => {
    mockSignOut.mockImplementation(async () => {})
    render(<SignOutButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Sign Out' }))
    await waitFor(() => expect(mockSignOut).toHaveBeenCalled())

    expect(mirroredKeys()).toEqual(MIRRORED)
  })
})

describe('every place that signs out', () => {
  const srcDir = path.join(process.cwd(), 'src')

  function sourceFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      return /\.(js|jsx|ts|tsx)$/.test(entry.name) ? [full] : []
    })
  }

  // The call, up to the end of its options object: the success handler lives in there
  const SIGN_OUT_CALL = /authClient\.signOut\(\{[\s\S]*?\n\s*\}\)/g

  const callers = sourceFiles(srcDir)
    .map((file) => ({ file, calls: fs.readFileSync(file, 'utf8').match(SIGN_OUT_CALL) || [] }))
    .filter(({ calls }) => calls.length > 0)

  it('finds the sign-out call sites', () => {
    expect(callers.length).toBeGreaterThanOrEqual(3)
  })

  it.each(callers.map(({ file, calls }) => [path.relative(srcDir, file).replace(/\\/g, '/'), calls]))(
    '%s navigates with hardNavigate, never the router',
    (_name, calls) => {
      for (const call of calls) {
        expect(call).toContain('hardNavigate(')
        expect(call).not.toMatch(/router\.(push|replace)\(/)
      }
    }
  )
})
