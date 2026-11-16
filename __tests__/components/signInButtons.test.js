/**
 * The sign-in buttons drop the positions this browser mirrored.
 *
 * The mirror's keys name a title, not a user, and only "View as" and the
 * Sign Out button clear it. A session that expired, or a sign-out from
 * another button, left the last account's positions in the browser; the next
 * account to sign in read them as its bars and resume points, and the player
 * saved them into its history. Every surface a signed-out visitor signs in
 * from (the landing page, /auth/signin, a page's sign-in wall) renders these
 * buttons, so the mirror is cleared when they appear.
 */

import { render, screen } from '@testing-library/react'

jest.mock('@src/lib/auth-client', () => ({ authClient: { signIn: { social: jest.fn() } } }))
jest.mock('react-google-button', () => ({ __esModule: true, default: () => <button type="button">Google</button> }))
jest.mock('react-social-login-buttons', () => ({
  DiscordLoginButton: () => <button type="button">Discord</button>,
  FacebookLoginButton: () => <button type="button">Facebook</button>,
}))

const SignInButtons = require('@components/SignInButtons').default

const MIRRORED = ['mid:0123456789abcdef', 'https://files.example/movies/film.mp4', 'http://files.example/tv/s01e01.mp4']
const position = JSON.stringify({ playbackTime: 1800, lastUpdated: '2026-11-10T20:00:00.000Z' })
const mirroredKeys = () => MIRRORED.filter((key) => window.localStorage.getItem(key) !== null)

beforeEach(() => {
  window.localStorage.clear()
  for (const key of MIRRORED) window.localStorage.setItem(key, position)
  window.localStorage.setItem('player-volume', '0.5')
})

afterEach(() => jest.restoreAllMocks())

it('clears the mirror when the buttons appear, and nothing else the browser stored', () => {
  render(<SignInButtons enabledProviders={{ google: true, discord: true }} />)

  expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument()
  expect(mirroredKeys()).toEqual([])
  expect(window.localStorage.getItem('player-volume')).toBe('0.5')
})

it('clears it with no provider configured too: the surface is still a signed-out one', () => {
  render(<SignInButtons enabledProviders={{}} />)

  expect(screen.getByText('No authentication providers configured')).toBeInTheDocument()
  expect(mirroredKeys()).toEqual([])
})

it('still renders when the browser’s storage cannot be read', () => {
  jest.spyOn(Storage.prototype, 'key').mockImplementation(() => {
    throw new Error('storage disabled')
  })

  render(<SignInButtons enabledProviders={{ google: true }} />)

  expect(screen.getByRole('button', { name: 'Google' })).toBeInTheDocument()
})
