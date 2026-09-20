/**
 * Signing out must leave with a full page load.
 *
 * A client navigation keeps everything the browser was holding: the pages Next
 * keeps mounted but hidden, the router's cached page output, SWR responses.
 * After router.push('/') on sign-out, Back re-showed the previous member page
 * without a request. See src/utils/hardNavigate.js.
 */

import fs from 'fs'
import path from 'path'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockHardNavigate = jest.fn()
jest.mock('@src/utils/hardNavigate', () => ({ hardNavigate: (href) => mockHardNavigate(href) }))

const mockSignOut = jest.fn()
jest.mock('@src/lib/auth-client', () => ({ authClient: { signOut: (options) => mockSignOut(options) } }))

const SignOutButton = require('@components/SignOutButton').default

beforeEach(() => {
  mockHardNavigate.mockClear()
  mockSignOut.mockReset()
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
